# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pilot logbook web app — flight logging, dashboard, route map, duty tracker, pilot profiles (with de-duplication/merge), CSV import/export, and bug reporting.

It is a **Next.js 15 (App Router) + TypeScript** app. Supabase is the **primary data store**, reached only through server-side API routes; a localStorage mirror provides offline resilience and holds bug-report screenshots. When Supabase env vars are absent the app runs **local-only** (auth + data entirely in the browser).

> `index.html` is the original single-file version, kept for reference. It's superseded by the Next.js app and can be deleted.

## Commands

```
npm install
cp .env.example .env.local   # add NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm run dev      # http://localhost:8090  (preview config: "Pilot Logbook")
npm run build    # production build + full type check — run this to verify changes
npm run lint
```

There is no unit-test tooling. Verify with `npm run build` (type errors surface here) and the preview tools.

## Architecture

### Data flow
- **`src/context/DataContext.tsx` is the single client-side state owner.** On login it loads `/api/state`, runs `migrateData`, and holds the whole `AppData` in React state. Components never fetch directly — they read `data` and call `mutate((draft) => …)` / `replace(next)`.
- Persistence is **last-write-wins**: every mutation writes the localStorage mirror immediately and debounces a `PUT /api/state` of the entire logbook. Bug reports go through `/api/bugs` (shared table) instead.
- **Local-only fallback:** if `/api/auth/session` reports `cloud:false`, auth and data use localStorage via `src/lib/clientStore.ts`. Keep both cloud and local paths working when touching auth or persistence.

### Server / API (`src/app/api`)
- `auth/{signup,login,logout,session}` — username/password gate. Passwords hashed with djb2 (`src/lib/hash.ts`). **This is a convenience gate, not real security** — don't build sensitive features on it. Session is a plain `plb_user` cookie (`src/lib/session.ts`).
- `state` — `GET` returns the merged logbook (state jsonb + shared bug rows); `PUT` upserts the whole logbook (bug reports stripped).
- `bugs` — upsert/delete in the shared `plb_bug_reports` table. **Screenshots are never sent to the server** (local blobs only).
- All routes use the service-role client (`src/lib/supabaseServer.ts`), which bypasses RLS, and return `503 cloud-not-configured` when env is missing — the client treats that as the cue to go local-only.
- Supabase schema (3 tables: `plb_users`, `plb_app_state`, `plb_bug_reports`) lives in `README.md` — that's the authoritative DDL.

### Framework-free logic (`src/lib`) — ported from the original app, keep it pure
- **`migrate.ts` is the compatibility spine.** `migrateData` runs on every load (server GET and client) and upgrades legacy data: `year/month/day` → `date`, `civilIdent` → `registration`, promotes free-text PIC/SIC/SOC into real pilot profiles, back-fills `pilotId/picId/sicId/socId`. Extend it when adding/renaming fields rather than assuming stored data has them.
- Flights carry both structured IDs and **backward-compatible text mirrors** (`pic/sic/soc`, `year/month/day`, `civilIdent`) used by CSV export — keep both in sync (see `FlightForm.tsx`).
- `csv.ts` — export + import. Import is the intricate part: `detectStructuredLogbook` branches between a flat CSV and a grouped/multi-header Transport-Canada-style logbook; `importCSV`/structured import are **pure** (take + return `AppData`) and the logger page clones data before calling them, then `replace()`s the result.
- `pilots.ts` — dedupe (`pilotDupKey`, `findDuplicateClusters`) and `applyMerge`/`applyDeletePilot` which re-point every flight reference before deleting a profile.
- `airports.ts` (Canadian ICAO DB + coord/label helpers), `aircraft.ts`, `logbook.ts` (pure `AppData` helpers: `flightsForCurrentPilot`, `pilotName`, hour totals, `dstr`).

### UI (`src/app`)
- **Dark "cockpit" theme** (matches the GitHub v0.6.1 redesign): slate-950 background with a cyan radial glow, cyan brand palette, `.card`/`.modal-card` surfaces and dark form controls defined in `globals.css`; brand palette in `tailwind.config.ts`.
- `(app)/` route group = the authenticated shell: a left **`Sidebar`** (icon nav, collapses to icons under the `lg` breakpoint) + sticky **`TopBar`** (title, sync badge, Report Bug, Log Out, and the "Logbook for:" pilot selector). `layout.tsx` guards auth + installs error capture. One page per tab: `logger`, `dashboard`, `routemap`, `duty`, `pilots`, `bugs`. `/login` is outside the group; `/` redirects to `/logger`.
- **Dashboard** (`dashboard/page.tsx` + `src/lib/dashboard.ts`) is the richest page: ring-gauge components, Flight Stats / Flight Time Breakdown / Active Duty / Panels / Recent Logs / CARs-Compliance sections, and a Customize panel backed by the per-user `dashboardHidden` metric list. CARs and active-duty math (`computeCars`, `computeActiveDuty`) live in `dashboard.ts`.
- Route Map uses Leaflet via dynamic `import("leaflet")` inside `useEffect` (it needs `window`), with `import "leaflet/dist/leaflet.css"`.
- Shared components in `src/components` (`Sidebar`, `TopBar`, `BugReporter`, `FlightForm`, `AirportDatalist`).

## Conventions
- `APP_VERSION` (`src/lib/types.ts`) is user-visible and attached to bug reports — bump it with meaningful releases.
- Reference data and dedupe/CSV/migrate logic must stay pure and framework-free in `src/lib` so both the server routes and client can call them.
- `*.csv` and `.claude/` are gitignored — CSV files are personal flight data and must never be committed.
