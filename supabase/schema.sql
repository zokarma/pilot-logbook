-- Pilot Logbook — Supabase schema (Supabase Auth + RLS edition).
--
-- The app uses Supabase Auth (email/password) and talks to the database from
-- the browser with the PUBLIC anon/publishable key. Row Level Security ensures
-- each user can only read/write their own row. No service-role/secret key is
-- used anywhere.
--
-- ============================================================================
-- ⚠️  STOP — READ THIS BEFORE RUNNING THE WHOLE FILE  ⚠️
-- ============================================================================
-- This file is idempotent and SAFE to run in full on an existing database:
-- `plb_app_state` (every pilot's entire logbook) is created with
-- `create table if not exists`, so re-running LEAVES EXISTING DATA UNTOUCHED.
--
-- The destructive `drop table … plb_app_state` that used to live here has been
-- REMOVED. Do NOT re-add it: on a live database it would delete every user's
-- logbook — a legal flight record — with no recovery. If you ever need a true
-- from-scratch reset (empty project only), do it deliberately and manually.
--
-- The two legacy service-role tables below never held real data, so dropping
-- them is harmless; they're kept only to clean up old projects.
--
-- Run once in Supabase → SQL Editor → New query → Run. Safe to re-run.
-- ============================================================================

-- Legacy cleanup only — these never held real user data. (plb_app_state is
-- intentionally NOT dropped here; see the warning above.)
drop table if exists plb_users cascade;
drop table if exists plb_bug_reports cascade;

-- One row per user: the whole logbook (flights, duty, pilots, bug reports, …)
-- as JSON, owned by the Supabase Auth user.
--
-- The `data` JSONB blob (shape defined in src/lib/types.ts → AppData) also holds
-- the account holder's profile and their aviation documents. There is no
-- separate relational table for these: the app is a single-blob client with an
-- offline mirror, so keeping them in `data` inherits the same RLS scoping,
-- offline resilience and sync path as everything else. Concurrent writers are
-- reconciled CLIENT-side: before writing, the app three-way merges its state
-- against this row per entity (src/lib/merge.ts) and uses `updated_at` as an
-- optimistic-concurrency token (conditional UPDATE … WHERE updated_at = seen),
-- so two devices editing offline no longer overwrite each other. Shape:
--
--   data.profile = {
--     firstName, lastName, displayName?, role,
--     dateOfBirth?,   -- "YYYY-MM-DD", drives medical expiry math
--     pilotId?,       -- the primary Pilot profile representing this account
--     onboarded       -- bool: has the first-time setup wizard completed
--   }
--
--   data.documents = [{
--     id, type, number?, issueDate?, examDate?,
--     expiryDate?,    -- "YYYY-MM-DD"; empty when expiryMode = 'none'
--     expiryMode,     -- 'auto' | 'manual' | 'none'
--     notes?, createdAt, updatedAt
--   }, …]
--
-- Each document belongs to exactly one user by virtue of living in that user's
-- row (enforced by the RLS policies below).
-- `if not exists`: on a live database this is a no-op that preserves every
-- existing logbook. See the warning at the top of this file.
create table if not exists plb_app_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table plb_app_state enable row level security;

-- Each user may only touch the row whose user_id matches their auth uid.
drop policy if exists "app_state_select_own" on plb_app_state;
drop policy if exists "app_state_insert_own" on plb_app_state;
drop policy if exists "app_state_update_own" on plb_app_state;
drop policy if exists "app_state_delete_own" on plb_app_state;

create policy "app_state_select_own" on plb_app_state
  for select using (auth.uid() = user_id);
create policy "app_state_insert_own" on plb_app_state
  for insert with check (auth.uid() = user_id);
create policy "app_state_update_own" on plb_app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "app_state_delete_own" on plb_app_state
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- Billing entitlements — premium subscription state (server-authoritative)
-- ============================================================================
-- The ONE place premium lives, and the ONLY billing table the app reads. It
-- must NOT go in plb_app_state: that row is user-writable under RLS, so a user
-- could grant themselves premium. This table is read-your-own only, with NO
-- client write policy — only the billing webhook (running with the
-- service-role key, which bypasses RLS) grants or revokes premium.
--
-- It is DERIVED: the webhook records each Stripe subscription in
-- plb_subscriptions (below) and then recomputes this row as the best
-- entitlement across them. Think of it as a materialized view the client and
-- scan-extract read. See supabase/functions/stripe-webhook +
-- src/lib/entitlement.ts (`pickEffectiveEntitlement`).
--
-- Safe to re-run.
create table if not exists plb_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null default 'free',        -- 'free' | 'pro' | 'professional'
  status text not null default 'inactive',  -- 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive'
  source text,                              -- 'stripe' (later: 'apple' | 'google')
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,           -- entitlement valid through this instant
  updated_at timestamptz not null default now()
);
create index if not exists plb_entitlements_customer_idx
  on plb_entitlements (stripe_customer_id);

alter table plb_entitlements enable row level security;

-- Read-your-own only. Deliberately NO insert/update/delete policy: the
-- anon/authenticated client can never write entitlement.
drop policy if exists "entitlements_select_own" on plb_entitlements;
create policy "entitlements_select_own" on plb_entitlements
  for select using (auth.uid() = user_id);

-- ============================================================================
-- Billing subscriptions — one row per Stripe subscription (the source rows)
-- ============================================================================
-- plb_entitlements holds ONE row per user, so it can only ever represent one
-- subscription. That made it a slot any inbound event could claim: whichever
-- subscription wrote last owned the account's billing identity, and a cancel
-- on that subscription revoked the user's premium even if a different,
-- still-paying subscription of theirs existed. It also mishandled the
-- legitimate window where a user briefly holds two active subscriptions
-- (an upgrade creates a new one before the old is cancelled) — the second
-- overwrote the first, and the first's renewal events then resolved to nobody.
--
-- Keying by subscription instead makes each subscription independent. The
-- webhook writes one row here per Stripe event, then recomputes the user's
-- plb_entitlements row as the BEST grant across their rows. A subscription can
-- therefore only ever ADD access; cancelling one removes only its own row and
-- cannot revoke a grant another subscription is still paying for.
--
-- Same trust model as plb_entitlements: read-your-own, no client write policy,
-- service-role webhook is the only writer.
--
-- Safe to re-run.
create table if not exists plb_subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  tier text not null default 'free',        -- 'free' | 'pro' | 'professional'
  status text not null default 'inactive',  -- 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive'
  source text,                              -- 'stripe' (later: 'apple' | 'google')
  stripe_customer_id text,
  current_period_end timestamptz,           -- this subscription's paid-through instant
  updated_at timestamptz not null default now()
);
create index if not exists plb_subscriptions_user_idx
  on plb_subscriptions (user_id);
create index if not exists plb_subscriptions_customer_idx
  on plb_subscriptions (stripe_customer_id);

alter table plb_subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on plb_subscriptions;
create policy "subscriptions_select_own" on plb_subscriptions
  for select using (auth.uid() = user_id);

-- Backfill from the pre-split model so existing subscribers keep their grant
-- and keep resolving by customer id. Idempotent: `on conflict do nothing`
-- means a re-run never clobbers a row the webhook has since updated.
insert into plb_subscriptions (
  stripe_subscription_id, user_id, tier, status, source,
  stripe_customer_id, current_period_end, updated_at
)
select
  stripe_subscription_id, user_id, tier, status, source,
  stripe_customer_id, current_period_end, updated_at
from plb_entitlements
where stripe_subscription_id is not null
on conflict (stripe_subscription_id) do nothing;
