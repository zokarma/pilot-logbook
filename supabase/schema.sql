-- Pilot Logbook — Supabase schema (Supabase Auth + RLS edition).
--
-- The app uses Supabase Auth (email/password) and talks to the database from
-- the browser with the PUBLIC anon/publishable key. Row Level Security ensures
-- each user can only read/write their own row. No service-role/secret key is
-- used anywhere.
--
-- Run once in Supabase → SQL Editor → New query → Run.
-- NOTE: this drops the earlier service-role tables (they hold no real data).
-- Safe to re-run.

drop table if exists plb_users cascade;
drop table if exists plb_bug_reports cascade;
drop table if exists plb_app_state cascade;

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
create table plb_app_state (
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
-- The ONE place premium lives. It must NOT go in plb_app_state: that row is
-- user-writable under RLS, so a user could grant themselves premium. This
-- table is read-your-own only, with NO client write policy — only the billing
-- webhook (running with the service-role key, which bypasses RLS) grants or
-- revokes premium. See supabase/functions/stripe-webhook + src/lib/entitlement.ts.
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
