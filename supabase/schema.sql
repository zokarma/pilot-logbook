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
-- separate relational table for these: the app is a single-blob, last-write-wins
-- client with an offline mirror, so keeping them in `data` inherits the same RLS
-- scoping, offline resilience and sync path as everything else. Shape:
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
