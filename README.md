# Pilot Logbook (Next.js)

A pilot logbook web app — flight logging, dashboard, route map, duty tracker,
currency/recency tracking, pilot profiles with de-duplication, a per-user fleet
manager, aviation-document tracking, CSV import/export, PDF export, logbook
scanning, and bug reporting.

It's a **Next.js / TypeScript** app using the App Router (one route per tab) and
**Supabase Auth + Row Level Security** as the data layer. The browser talks to
Supabase directly with the **public anon key** — there is **no
service-role/secret key anywhere**, and RLS guarantees each user can only
read/write their own row. A localStorage mirror provides offline resilience and
holds bug-report screenshots (which are never sent to the cloud).

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev                  # http://localhost:8090
```

### Environment

Both values are **public** and safe to expose in the browser and in your host —
the anon/publishable key respects RLS, and this app uses no secret key.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key (`sb_publishable_…` or legacy anon JWT) |

If these are **not** set, the app falls back to a **local-only mode**: auth and
data live entirely in the browser's localStorage (handy for a quick spin without
provisioning Supabase). No sync badge is shown in that mode.

## Supabase setup

1. **Run the schema** — Supabase → SQL Editor → paste [`supabase/schema.sql`](supabase/schema.sql) → Run.
   It creates a single `plb_app_state` table (one JSON row per user, keyed by
   `user_id → auth.users`) with RLS policies requiring `auth.uid() = user_id`
   for every select/insert/update/delete.
2. **Enable the Email provider** — Authentication → Sign In / Providers → Email.
   Decide whether to require **email confirmation**: with it on, new users must
   confirm before logging in (the app shows a "check your email" prompt); with it
   off, signup logs straight in. Confirmation emails use Supabase's built-in
   sender (rate-limited on the free tier) unless you configure custom SMTP.
3. **Set Site URL / redirect URLs** (Authentication → URL Configuration) to your
   dev (`http://localhost:8090`) and production origins — needed for confirmation
   and password-reset links.

## Architecture

- **`src/lib`** — framework-free logic: `types`, `airports`, `aircraft`, `hash`,
  `migrate` (the compatibility spine), `logbook` helpers, `csv` (export +
  flat/structured import), `pilots` (dedupe/merge), `dashboard` (CARs +
  active-duty math), `supabaseClient` (browser client, anon key), `clientStore`
  (localStorage mirror + local-only fallback).
- **`src/context/DataContext.tsx`** — the single client-side state owner. Uses
  Supabase Auth for the session, loads the user's `plb_app_state` row (RLS-scoped),
  applies `migrateData`, mirrors to localStorage, and upserts changes back
  (debounced, last-write-wins). Screenshots are stripped before the cloud write.
- **`src/app/(app)/*`** — one page per tab: `logger`, `dashboard`, `routemap`,
  `duty`, `pilots`, `bugs`, wrapped by an auth-guarded layout. There is no server
  `/api` layer — all data access is client-side under RLS.

### Deploying

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in your host's
environment (e.g. Vercel → Project → Settings → Environment Variables). Both are
public, so nothing sensitive lives in the repo or the host secrets.

### Notes / caveats

- Security rests on **RLS + Supabase Auth**: the anon key can only do what the
  policies allow, so a user can reach only their own row.
- Sync is **last-write-wins** per user.
- Bug reports are **private per user** (stored in that user's state JSON);
  screenshots stay local-only.
- `*.csv` files are personal flight data and are gitignored — never commit them.
