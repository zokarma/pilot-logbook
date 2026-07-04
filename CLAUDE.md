# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pilot logbook web app — flight logging, dashboard, route map, duty tracker, pilot profiles (with de-duplication/merge), CSV import/export, and bug reporting.

It is a **Next.js 15 (App Router) + TypeScript** app. The data layer is **Supabase Auth + Row Level Security**: the browser talks to Supabase directly with the **public anon key** (there is no service-role/secret key), and RLS scopes every row to its owner. A localStorage mirror provides offline resilience and holds bug-report screenshots. When Supabase env vars are absent the app runs **local-only** (auth + data entirely in the browser).

> `index.html` is the original single-file version, kept for reference. It's superseded by the Next.js app and can be deleted.

## Commands

```
npm install
cp .env.example .env.local   # add NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (both public)
npm run dev      # http://localhost:8090  (preview config: "Pilot Logbook")
npm run build    # production build + full type check — run this to verify changes
npm run lint
```

There is no unit-test tooling. Verify with `npm run build` (type errors surface here) and the preview tools.

## Architecture

### Data flow
- **`src/context/DataContext.tsx` is the single client-side state owner.** In cloud mode it subscribes to Supabase Auth (`onAuthStateChange`), loads the signed-in user's `plb_app_state` row (RLS-scoped), runs `migrateData`, and holds the whole `AppData` in React state. Components never fetch directly — they read `data` and call `mutate((draft) => …)` / `replace(next)`.
- Persistence is **last-write-wins**: every mutation writes the localStorage mirror immediately and debounces an `upsert` of the entire logbook to `plb_app_state`. Bug-report screenshots are stripped before the cloud write (`stripScreenshots`) and re-merged from the local cache on load (`mergeScreenshots`).
- **Local-only fallback:** when `supabaseConfigured()` is false (no `NEXT_PUBLIC_SUPABASE_*` env), auth and data use localStorage via `src/lib/clientStore.ts`. Keep both cloud and local paths working when touching auth or persistence.

### Auth & data (client-side, under RLS)
- **Supabase Auth (email/password)** — `login`/`signup`/`logout` in `DataContext` call `supabase.auth.*`. Signup with email-confirmation on returns `needsConfirmation` (the login page shows a "check your email" prompt). `src/lib/supabaseClient.ts` builds the browser client from the **public anon key** — safe to ship; RLS does the enforcing.
- **One table, `plb_app_state`** (`user_id uuid → auth.users`, `data jsonb`): the whole per-user logbook, including that user's (private) bug reports. Screenshots never leave the browser.
- **RLS policies** require `auth.uid() = user_id` for select/insert/update/delete. There is **no server `/api` layer and no service-role key.** The authoritative DDL is `supabase/schema.sql`.

### Framework-free logic (`src/lib`) — ported from the original app, keep it pure
- **`migrate.ts` is the compatibility spine.** `migrateData` runs on every load and upgrades legacy data: `year/month/day` → `date`, `civilIdent` → `registration`, promotes free-text PIC/SIC/SOC into real pilot profiles, back-fills `pilotId/picId/sicId/socId`. Extend it when adding/renaming fields rather than assuming stored data has them.
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
- Reference data and dedupe/CSV/migrate logic must stay pure and framework-free in `src/lib`.
- `*.csv` and `.claude/` are gitignored — CSV files are personal flight data and must never be committed.
