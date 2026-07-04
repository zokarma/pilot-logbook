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
