# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pilot logbook web app — flight logging, dashboard, route map, duty tracker, pilot profiles (with de-duplication/merge), aviation-document tracking (with Transport Canada expiry math), CSV import/export, a first-run onboarding wizard, and bug reporting.

It is a **Next.js 15 (App Router) + TypeScript** app that builds to a **static export** (`output: "export"` → `out/`). That same `out/` is served by Vercel as a static site and bundled into a native **iOS app via Capacitor** (`capacitor.config.ts`, `webDir: out`). Because it's a fully client-side static export, there are **no Next.js server/API routes**.

The data layer is **Supabase Auth + Row Level Security**: the browser talks to Supabase directly with the **public anon key**, and RLS scopes every row to its owner. A localStorage mirror provides offline resilience and holds bug-report screenshots. When Supabase env vars are absent the app runs **local-only** (auth + data entirely in the browser).

> `index.html` is the original single-file version, kept for reference. It's superseded by the Next.js app and can be deleted.

## Commands

```
npm install
cp .env.example .env.local   # add NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (both public)
npm run dev          # http://localhost:8090
npm run build        # static export to out/ + full type check — run this to verify changes
npm run lint
npm run build:mobile # next build && cap sync (refresh the iOS bundle)
```

There is no unit-test tooling. Verify with `npm run build` (type errors surface here) and the preview tools.

## Architecture

### Data flow
- **`src/context/DataContext.tsx` is the single client-side state owner.** In cloud mode it subscribes to Supabase Auth (`onAuthStateChange`), loads the signed-in user's `plb_app_state` row (RLS-scoped), runs `migrateData`, and holds the whole `AppData` in React state. Components never fetch directly — they read `data` and call `mutate((draft) => …)` / `replace(next)`.
- Persistence is **last-write-wins**: every mutation writes the localStorage mirror immediately and debounces an `upsert` of the entire logbook to `plb_app_state`. Bug-report screenshots are stripped before the cloud write (`stripScreenshots`) and re-merged from the local cache on load (`mergeScreenshots`).
- **`ready` gates the authed shell.** It must go back to `false` while a newly signed-in user's row loads; otherwise the layout renders the previous (empty) `data` and briefly flashes the onboarding wizard. `loadCloudState` restores it on every path.
- **Local-only fallback:** when `supabaseConfigured()` is false (no `NEXT_PUBLIC_SUPABASE_*` env), auth and data use localStorage via `src/lib/clientStore.ts`. Local passwords are salted **SHA-256** (legacy unsalted djb2 records are verified then upgraded in place). Keep both cloud and local paths working when touching auth or persistence.

### Auth & data (client-side, under RLS)
- **Supabase Auth (email/password)** — `login`/`signup`/`logout` in `DataContext` call `supabase.auth.*`. Signup with email-confirmation on returns `needsConfirmation` (the login page shows a "check your email" prompt). `src/lib/supabaseClient.ts` builds the browser client from the **public anon key** — safe to ship; RLS does the enforcing.
- **One table, `plb_app_state`** (`user_id uuid → auth.users`, `data jsonb`): the whole per-user logbook (flights, duty, pilots, profile, documents, and that user's private bug reports). Screenshots never leave the browser. Authoritative DDL is `supabase/schema.sql`; RLS policies require `auth.uid() = user_id` on select/insert/update/delete.
- **The one exception to "anon key only":** `supabase/functions/delete-account/` is a Supabase **Edge Function** that holds the service-role key *server-side* (App Store account-deletion requirement). It identifies the caller from their own JWT and deletes only that user (cascades to their row). The service-role key is never in the app bundle.

### Framework-free logic (`src/lib`) — keep it pure
- **`migrate.ts` is the compatibility spine.** `migrateData` runs on every load and upgrades legacy data: `year/month/day` → `date`, `civilIdent` → `registration`, promotes free-text PIC/SIC/SOC into real pilot profiles, back-fills `pilotId/picId/sicId/socId`, normalizes `flightColumns`, and synthesizes a `profile` for pre-onboarding users. Extend it when adding/renaming fields rather than assuming stored data has them.
- Flights carry both structured IDs and **backward-compatible text mirrors** (`pic/sic/soc`, `year/month/day`, `civilIdent`) used by CSV export — keep both in sync. `syncFlightMirrors` (in `logbook.ts`) re-derives them; call it inside a `mutate` draft after edits (see `FlightForm.tsx` / `FlightTable.tsx`).
- `csv.ts` — export + import. Import is the intricate part: `detectStructuredLogbook` branches between a flat CSV and a grouped/multi-header Transport-Canada-style logbook; `importCSV`/structured import are **pure** (take + return `AppData`) and the logger page clones data before calling them, then `replace()`s the result.
- `pilots.ts` — dedupe (`pilotDupKey`, `findDuplicateClusters`) and `applyMerge`/`applyDeletePilot` which re-point every flight reference before deleting a profile.
- `documents.ts` — aviation-document catalog (`DOC_TYPES`) plus **pure Transport Canada expiry math**: `computeAutoExpiry`/`medicalValidityMonths` (medical validity depends on age-at-exam), `documentStatus` (valid/expiring/expired).
- `flightColumns.ts` — canonical Logged-Flights column set + `normalizeFlightColumns` (the per-user visible/ordered subset lives in `AppData.flightColumns`).
- `id.ts` — `uid(prefix)` mints collision-safe ids (per-session counter + random suffix). Use it instead of `Date.now() + Math.random()`, which collides during bulk CSV imports.
- `airports.ts` (Canadian ICAO DB + coord/label helpers, deterministic fallback coords via `hash.ts`), `aircraft.ts`, `logbook.ts` (pure `AppData` helpers), `dashboard.ts`.

### UI (`src/app`)
- **Dark "cockpit" theme**: slate-950 background with a cyan radial glow, cyan brand palette, `.card`/`.modal-card` surfaces and dark form controls in `globals.css`; palette in `tailwind.config.ts`.
- `(app)/` route group = the authenticated shell: left **`Sidebar`** (icon nav, collapses to icons under `lg`; its exported `NAV` list is the single source of page labels) + sticky **`TopBar`** (heading shows the **current page name** derived from `NAV`, sync badge, current user, Report Bug, Log Out). `layout.tsx` guards auth, installs error capture, and **renders `Onboarding` in place of the shell until `data.profile.onboarded`**. One page per tab: `logger`, `dashboard`, `routemap`, `duty`, `documents`, `pilots`, `bugs`. `/login`, `/privacy` and the onboarding wizard render outside the shell; `/` redirects to `/logger`.
- **`FlightTable.tsx`** (logger page) is the densest component: inline "quick edit", checkbox range-select + bulk-edit, per-row delete, and a Columns panel that reorders/toggles `flightColumns`.
- **Dashboard** (`dashboard/page.tsx` + `dashboard.ts`): ring-gauge cards for Flight Stats / Breakdown / Active Duty / CARs-Compliance, an aircraft-hours panel, document-status list, and a Customize panel backed by the per-user `dashboardHidden` metric list. CARs and active-duty math (`computeCars`, `computeActiveDuty`) live in `dashboard.ts`.
- **Onboarding** (`Onboarding.tsx`) is the two-step first-run wizard (profile → documents) that creates the primary pilot and writes `profile`. `DocumentForm.tsx` is shared by it and the Documents page.
- Route Map uses Leaflet via dynamic `import("leaflet")` inside `useEffect` (needs `window`), with `import "leaflet/dist/leaflet.css"`. User-supplied airport codes are HTML-escaped before going into Leaflet popups.

## Conventions
- `APP_VERSION` (`src/lib/types.ts`, currently `0.7.1`) is user-visible and attached to bug reports — bump it with meaningful releases. (`package.json` version is separate and not kept in lockstep.)
- Reference data and dedupe/CSV/migrate/documents logic must stay pure and framework-free in `src/lib`.
- `*.csv` and `.claude/` are gitignored — CSV files are personal flight data and must never be committed.
