# Pilot Logbook (Next.js)

A pilot logbook web app — flight logging, dashboard, route map, duty tracker,
pilot profiles with de-duplication, CSV import/export, and bug reporting.

This is the **Next.js / TypeScript** rebuild of the original single-file
`index.html` app. It uses the App Router, one route per tab, and **Supabase as
the primary data store** accessed through server-side API routes. A localStorage
mirror provides offline resilience and holds bug-report screenshots (which are
never sent to the cloud).

> The legacy single-file version still lives in `index.html` for reference and
> can be deleted once you're happy with the Next.js app.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev                  # http://localhost:8090
```

### Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Used by `/api` routes; never exposed to the browser |

If these are **not** set, the app automatically falls back to a **local-only
mode**: auth and data live entirely in the browser's localStorage (handy for a
quick spin without provisioning Supabase). The header will not show a sync badge
in this mode.

## Supabase setup

Run once in the Supabase SQL Editor:

```sql
-- Auth (convenience gate for a personal tool — not a security boundary)
create table plb_users (
  username text primary key,
  password_hash text not null,
  created_at timestamptz default now()
);

-- Whole-logbook state per user (flights, duty, pilots, currentPilotId, …)
create table plb_app_state (
  username text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Bug reports, shared across users (screenshots are never stored here)
create table plb_bug_reports (
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

-- The API routes use the service-role key, which bypasses RLS. Keep RLS on so
-- nothing is reachable with the anon key.
alter table plb_users enable row level security;
alter table plb_app_state enable row level security;
alter table plb_bug_reports enable row level security;
```

## Architecture

- **`src/lib`** — framework-free logic ported from the original app: `types`,
  `airports`, `aircraft`, `hash`, `migrate` (the compatibility spine),
  `logbook` helpers, `csv` (export + flat/structured import), `pilots`
  (dedupe/merge).
- **`src/app/api`** — server routes backed by Supabase: `auth/*`, `state`
  (GET/PUT the whole logbook), `bugs` (shared table).
- **`src/context/DataContext.tsx`** — the single client-side state owner. Loads
  from `/api/state`, applies `migrateData`, mirrors to localStorage, and pushes
  changes back (debounced, last-write-wins).
- **`src/app/(app)/*`** — one page per tab: `logger`, `dashboard`, `routemap`,
  `duty`, `pilots`, `bugs`, wrapped by an auth-guarded layout.

### Notes / caveats

- Auth is a **convenience gate**, not real security — passwords are hashed with
  a non-cryptographic djb2 hash. Real server auth (e.g. Supabase Auth) is a
  sensible follow-up.
- Sync is **last-write-wins**, keyed by username.
- `*.csv` files are personal flight data and are gitignored — never commit them.
