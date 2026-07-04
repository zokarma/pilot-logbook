-- Pilot Logbook — Supabase schema.
-- Run once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run (uses IF NOT EXISTS / idempotent policies).

-- Auth gate (convenience only — passwords hashed with a non-cryptographic djb2 hash).
create table if not exists plb_users (
  username text primary key,
  password_hash text not null,
  created_at timestamptz default now()
);

-- Whole-logbook state per user (flights, duty, pilots, currentPilotId, …).
create table if not exists plb_app_state (
  username text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Bug reports, shared across users (screenshots are never stored here).
create table if not exists plb_bug_reports (
  id text primary key,
  username text,
  created_at timestamptz default now(),
  status text default 'open',
  severity text default 'medium',
  description text,
  steps text default '',
  tab text default '',
  url text default '',
  user_agent text default '',
  viewport text default '',
  app_version text default '',
  app_state jsonb,
  recent_errors jsonb
);

-- The /api routes use the service_role key, which bypasses RLS. Keep RLS enabled
-- so nothing is reachable with the public anon key.
alter table plb_users enable row level security;
alter table plb_app_state enable row level security;
alter table plb_bug_reports enable row level security;
