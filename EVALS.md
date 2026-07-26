# Feature Evals — Pilot Logbook

Behavioral evaluations of every core feature, ranked most- to least-important.
The suites live in `evals/` and run against the real `src/lib` code (which is
pure and framework-free, so no app boot is needed):

```
npx tsx evals/run.ts        # seconds, no network; exits non-zero on a failed check
```

- **check** = hard assertion. A failing check is a defect in the app, kept red
  on purpose until the underlying bug is fixed.
- **probe** = recorded behavior worth knowing (design limits, domain-accuracy
  gaps, promises the build hasn't caught up to). Probes never fail the run.

---

## Last run: 2026-07-26 — 506/506 checks green, 33 probes across 21 suites

Every feature now has a suite. This run added five: **#3 offline mirror & local
auth**, **#17 flight columns**, **#19 checkout links**, **#20 plan promises vs
product truth**, and **#21 bug-report error capture** — closing the last gaps in
pure-module coverage (`clientStore`, `hash`, `flightColumns`, `checkout`, `seo`,
`recentErrors`) and re-ranking all 21 suites into one honest importance order.

**The logbook itself is in good shape.** Everything that touches flight data —
merge, migration, expiry math, import, scan, currency, PDF — is green, and all
three historical defects (D1–D3) stay regression-guarded by the checks that
caught them.

**The gap this run found is commercial, not aeronautical.** The new #20 suite
compares what `/pricing` and the structured data *sell* against what the code
*enforces*: **all five of the Professional tier's differentiators are unbuilt or
unenforced** (roster import, company reports, advanced analytics, priority
support — plus unlimited scanning, which isn't metered on any tier), and the FAQ
that Google and the AI answer engines quote gets the device tiering backwards.
Details in findings **F16–F21**. Nothing here is a code bug — it's a promise the
build hasn't kept, and it's the highest-value thing on this page.

| # | Feature | Suite | Result | Why it ranks here |
|---|---------|-------|--------|-------------------|
| 1 | Sync merge engine (`merge.ts`) | `merge.eval.ts` | ✅ 30/30 | Silent data loss on a legal record is the worst possible failure |
| 2 | Data migration (`migrate.ts`) | `migrate.eval.ts` | ✅ 24/24 | Runs on every load for every user; a bad upgrade corrupts everyone at once |
| 3 | Offline mirror & local auth (`clientStore.ts`, `hash.ts`) | `clientStore.eval.ts` | ✅ 48/48 | The mirror is what a cold offline launch renders and the ancestor every merge needs — and it's the one thing keeping screenshots out of the cloud |
| 4 | TC document expiry math (`documents.ts`) | `documents.eval.ts` | ✅ 29/29 | A wrong expiry can tell a pilot an invalid medical is valid |
| 5 | CSV import/export (`csv.ts`) | `csv.eval.ts` | ✅ 31/31 | The de-facto backup/restore path; row corruption multiplies |
| 6 | CSV Import Wizard (`importMap.ts`) | `importMap.eval.ts` | ✅ 50/50 | The live bulk-import path a new user meets on day one |
| 7 | OCR scan parser (`scan.ts`) | `scan.eval.ts` | ✅ 42/42 | Newest data-entry path; heuristic accuracy + honest confidence flagging |
| 8 | Currency math (`currency.ts`) | `currency.eval.ts` | ✅ 24/24 | Overstated recency is legal exposure in the cockpit |
| 9 | Pilot dedupe & merge (`pilots.ts`) | `pilots.eval.ts` | ✅ 17/17 | Destructive ops that rewrite flight references |
| 10 | IDs & flight mirrors (`id.ts`, `logbook.ts`) | `core.eval.ts` | ✅ 12/12 | Duplicate ids / drifting mirrors corrupt everything downstream |
| 11 | Entitlement logic (`entitlement.ts`) | `entitlement.eval.ts` | ✅ 29/29 | Wrongly locking out a paying pilot — or granting premium from a junk row |
| 12 | Dashboard duty & CARs gauges (`dashboard.ts`) | `dashboard.eval.ts` | ✅ 16/16 | Compliance display — windows and rest math must not mislead |
| 13 | CARs duty limits (`dutyLimits.ts`) | `dutyLimits.eval.ts` | ✅ 14/14 | The caps behind those gauges; must degrade safely for legacy profiles |
| 14 | PDF export model (`pdf.ts`) | `pdf.eval.ts` | ✅ 19/19 | Totals on a document handed to examiners and insurers |
| 15 | Fleet manager (`aircraft.ts`) | `fleet.eval.ts` | ✅ 18/18 | Custom types feed every flight picker |
| 16 | Registration lookup (`logbook.ts`) | `logbook.eval.ts` | ✅ 11/11 | Tail→type autofill on the flight form |
| 17 | Flight table columns (`flightColumns.ts`) | `flightColumns.eval.ts` | ✅ 18/18 | A bad normalization renders an empty table — the logbook *looks* lost |
| 18 | Airport DB (`airports.ts`) | `airports.eval.ts` | ✅ 10/10 | Map support; wrong coords are cosmetic but visible |
| 19 | Checkout links (`checkout.ts`) | `checkout.eval.ts` | ✅ 7/7 | A cross-wired or reference-less link takes money without granting the plan |
| 20 | Plan promises vs product truth (`seo.ts` + pricing copy) | `claims.eval.ts` | ✅ 42/42 | What a buying pilot — and every AI answer engine — is told the app does |
| 21 | Bug-report error capture (`recentErrors.ts`) | `recentErrors.eval.ts` | ✅ 15/15 | Diagnostics only; must stay bounded and never throw from a handler |

---

## What each suite verifies

1. **Sync merge** — offline adds union; deletes propagate via base with
   **edit-beats-delete** both ways; newer-stamp wins for flights/pilots/duty; no
   base degrades to a lossless union; unknown top-level keys survive;
   `stampChanges` stamps exactly the changed entities; `deepEqual` is key-order
   and `undefined`-insensitive; `sameStamp` equates `Z` and `+00:00`.
2. **Migration** — null input → complete empty state with the wizard armed;
   `year/month/day` → zero-padded `date`; `civilIdent` → `registration`;
   free-text crew promoted to real pilots with case-insensitive reuse;
   `duty: true` upgraded; flightColumns normalized (full-garbage → defaults);
   existing users get a synthesized onboarded profile; `migrate(migrate(x)) =
   migrate(x)`.
3. **Offline mirror & local auth** — mirror round-trips and is per-user; corrupt
   mirror/base/last-user JSON reads as `null` instead of throwing (a cold boot
   survives a damaged store); a full/disabled store never throws out of
   `saveCache`; a legacy base is **migrated on load** so newly added fields don't
   look locally-edited in the next merge; the remembered-user record drives
   mirror-first boot and clears on sign-out; **screenshots are blanked before any
   cloud write, without mutating in-memory state, and re-attach losslessly from
   the local cache**; local signup/login store a per-user-salted SHA-256 (never
   plaintext, never the legacy digest), refuse duplicate usernames and wrong
   passwords, and upgrade legacy unsalted djb2 records in place only after a
   correct password.
4. **TC document expiry** — month arithmetic clamps end-of-month (incl. leap
   years); the age boundary counts the birthday itself; the full medical validity
   table (Cat 1/3/4 × <40/40+) including an exam on the 40th birthday; the
   end-of-month extension (D3); IR/CRM/DG issue-based expiries; missing DOB/exam
   yields `""` rather than a wrong date; status boundaries at 0/60/61 days;
   manual docs untouched by recalc.
5. **CSV import/export** — RFC-4180 parsing (quoted commas/quotes/newlines,
   CRLF); the full date matrix incl. D/M day>12 disambiguation and the 49/50
   two-digit-year split; flat round-trip fidelity **including re-importing the
   app's own export** (D2); structured TC import: 3-row header flattening,
   Year + "May 5" dates, SE day/night + XC sums, owner-as-PIC → Captain
   re-pointing, owner-in-student-column → Student, every row owned by the current
   pilot; skip accounting and the no-date error message.
6. **Import Wizard** — header→field proposal across naming conventions, the
   shape veto that rejects an implausible mapping, saved templates, and the
   `planImport` → `applyMappedImport` pipeline (row skips, owner crew slot,
   totals).
7. **OCR scan parser** — TC page-header (month/year) context carried across
   pages; header lines never become flights; `CGABC` → `C-GABC`, N-numbers,
   K-ICAOs; aircraft types never misread as airports; ME types route hours to
   `me`; role keywords incl. the "Instructor <name> is not Dual Given" guard;
   fragment x-positions keep left-column numbers out of the hour fields; low OCR
   confidence lands under `LOW_CONFIDENCE` so the sheet flags it; document
   parsing (PPL + Cat 1 medical, labeled dates, chronological fallback flagged
   for review); the FM combiner's 0.95/0.75/0.55 agree/only/disagree ladder; the
   cloud-extraction sanitizers (`sanitizeFmFlights`/`sanitizeFmDocument`).
   Golden-set field accuracy: **29/29 (100%)** on clean synthetic lines.
8. **Currency math** — TC day/night passenger recency and IFR 6h+6 approaches
   over calendar-month windows; user rules (day windows, per-type scope); a
   flight with no counts = one takeoff + one landing classified by its
   `takeoff`/`landing`; lapse dates anchor to the threshold-crossing event.
9. **Pilot dedupe & merge** — initial+surname dup keys cluster `Ben/B./b pearce`
   and nothing else; merge re-points `pilotId/picId/sicId/socId` + text mirrors,
   back-fills empty employee/licence numbers, follows `currentPilotId`; delete
   clears references (never reassigns history); ref counting counts flights.
10. **IDs & mirrors** — 200,000 `uid()` mints with zero collisions (the bulk-CSV
    scenario the counter exists for); mirror re-derivation (y/m/d, uppercased
    reg/route, `civilIdent`, crew names from ids, `updated_at`); legacy date
    fallbacks; per-pilot filtered, newest-first view.
11. **Entitlement** — lapsed/canceled/expired reads free; the `GRACE_DAYS`
    offline window keeps a paying pilot in; `trialing`/`past_due` grant;
    `entitlementFromRow` collapses unknown tiers/statuses and malformed rows to
    free (junk can never grant premium); `hasFeature` respects the tier ladder.
12. **Dashboard gauges** — today's entry drives the daily gauge; the weekly
    window is exactly trailing 7 days (−6 in, −7 out); caps clamp at 100%; the
    CARs 28-day window (−27 in, −28 out) is scoped to the current pilot; rest gap
    22:00→08:00 = 10h; past-midnight duty rolls its end forward; overlapping
    entries are skipped rather than reported as negative rest.
13. **Duty limits** — 703/704/705 flight-time, FDP and rest caps; the 60-vs-70h
    7-day option; legacy profiles default to the conservative 705 set.
14. **PDF model** — TC-style page chunking with page/forward/grand totals that
    reconcile, plus the summary block (career totals, hours by type, currency,
    documents).
15. **Fleet** — built-ins merged with the user's fleet, deduped by
    `normalizeAircraftCode` (built-ins win), sorted, blank codes skipped;
    `aircraftName` resolves across both and falls back to the raw code.
16. **Registration lookup** — a short-form tail resolves to the *most recent*
    type flown on it; hyphen/case-insensitive; 2–3 character input and ambiguous
    suffixes resolve to `null` rather than guess.
17. **Flight columns** — unknown keys dropped, duplicates collapsed, the pilot's
    order preserved, and every degenerate input (null, non-array, empty,
    all-unknown) falls back to the full default set rather than an empty table;
    the fallback is a fresh array, so a user's edit can't mutate the module
    constant.
18. **Airport DB** — real coordinates/labels for known fields; unknown codes
    resolve to `null` (never a fabricated position); pilot-placed airports extend
    and shadow the built-ins; junk coords ignored; every DB entry has sane
    lat/lon.
19. **Checkout links** — every tier × period resolves to its own distinct
    Payment Link (no cross-wiring), an unconfigured plan degrades to
    `/login?next=/pricing` rather than `undefined` in the href, and
    `startCheckout` is prerender-safe.
20. **Plan promises** — the JSON-LD blocks are well-formed and hole-free; the
    offer band, currency and per-plan prices match `PLANS`; the prices in the
    structured data match the ones rendered on `/pricing`, the landing page and
    the meta description; the annual copy ($8.33 / $100 / "save $20") is
    arithmetically self-consistent; the comparison table's tiering matches
    `FEATURE_MIN_TIER` for every feature the app actually gates.
21. **Error capture** — install is window-safe and idempotent; window errors and
    both rejection shapes are captured; messages and source locations truncate at
    500 chars; the buffer caps at 20 keeping the newest; callers get a copy.

---

## Defects found and FIXED

### D1 · HIGH — Duty entries ignored their `updatedAt` in conflict resolution ✅ FIXED
`merge.ts` · regression-guarded by `duty: both devices converge on the newer value`

`mergeDuty` wrapped each entry as `{ key, entry }` before calling
`mergeById(…, "updatedAt")`, but the stamp comparator read `updatedAt` off that
**wrapper**, where it never existed. Both sides always looked unstamped, so ties
always kept local, and two devices editing the same duty day **never converged**
— the server held one device's value while the other kept displaying its own.
Flights/pilots/documents were unaffected (their stamps live on the entity).

**Fix applied:** `mergeDuty` now hoists `updatedAt` onto the wrapper and strips
it from the inner entry, so `mergeById`/`pickNewer` see the stamp; the entry's
stamp is restored on unwrap.

### D2 · HIGH — The app could not re-import its own CSV export ✅ FIXED
`csv.ts` · regression-guarded by `the app can re-import its OWN export (backup round-trip)`

`toCSV` writes a header containing **"Single Engine"**, and
`detectStructuredLogbook` treated any early row containing that phrase as a
structured Transport-Canada logbook. The app's own flat export therefore routed
into `importStructuredLogbook` and died with *"Couldn't find a Date column in
this logbook."* The same misdetection fed the live Import Wizard's suggested
mappings.

**Fix applied:** `detectStructuredLogbook` now skips a "Single Engine" row that
is itself a usable flat header (one carrying a standalone `Date`, or
`Year`+`Month`+`Day`). Backup round-trip re-imports cleanly.

### D3 · MED (domain fidelity) — TC's end-of-month rule wasn't modeled ✅ FIXED
`documents.ts` · regression-guarded by the medical-validity checks in suite #4

CARs validity runs to the **first day of the month after** the anniversary; the
app anchored to the same day-of-month, showing renewals up to ~30 days early.
`computeAutoExpiry` now extends medicals to the end of the month the period ends
in. (The Instrument Rating still uses the same-day anchor — see F3.)

---

## Findings (probes) — decide, then fix or accept

Ordered by what they'd cost you, not by suite number.

### Commercial — the pitch is ahead of the build

- **F16 · HIGH — the Professional tier's headline features don't exist.**
  `rosterImport`, `companyReports`, `advancedAnalytics` and `prioritySupport` are
  declared in `FEATURE_MIN_TIER`, sold on `/pricing` (comparison table *and* the
  Professional spotlight, with copy like "pull your pairings straight in"), and
  referenced **nowhere** in `src/app` or `src/components` — comments excluded.
  With `aiScanUnlimited` unmetered too (F17), a Professional subscriber at
  $15/mo today gets the Duty page and nothing else beyond Pro. In total **9 of
  14 declared features have no enforcement site**; the genuinely wired set is
  `aiScan`, `docOcr`, `proPdf`, `advancedCurrency`, `dutyRest`. *Decide:* build
  them, or pull them from the tier until they ship.
- **F17 · HIGH — the scan allowance is not metered.** `/pricing` sells Pro as
  "Limited / month" and Professional as "Unlimited", and the FAQ offers "your
  first 10 pages free" — but no counter exists anywhere in the client.
  `ScanImport` gates on `has("aiScan")` alone, so Pro scanning is de-facto
  unlimited and `aiScanUnlimited` (the Professional differentiator) is inert.
  Either meter it server-side in `scan-extract` (the only place a client can't
  bypass) or stop selling a limit.
- **F18 · MED — the FAQ contradicts the entitlement matrix on devices.** The
  structured-data FAQ says *"Professional adds the native iPhone, iPad, and Mac
  apps"*, while `FEATURE_MIN_TIER.nativeApps` is `pro` and the comparison table
  gives Pro "All platforms". Google and the AI answer engines quote the FAQ, so
  the answer a prospect gets is the wrong one. Separately: the repo ships an
  iOS/iPadOS Capacitor target only — "Mac apps" holds only via "iPad apps on
  Apple silicon Macs".
- **F19 · MED — the 14-day trial exists only in copy and in Stripe.** Sold in
  seven places on `/pricing` plus the landing page. `entitlement.ts` honors a
  `trialing` status if Stripe sends one, but nothing in the client starts,
  counts down, or surfaces a trial. The promise holds only if **every** Payment
  Link is configured with a 14-day trial in the Stripe dashboard — an operator
  step no eval can watch. Add it to the billing runbook checklist.
- **F20 · LOW — the "encrypted" data-safety claim needs one qualifier.** True in
  transit and at rest in Supabase; the offline mirror (full logbook + bug-report
  screenshots) sits in plain localStorage, and local-only mode has no encryption
  at all. "Encrypted in transit and at rest in the cloud" is defensible as-is.
- **F21 · LOW — hero CTAs bypass checkout.** `START_HREF = "/login"`, so the
  most prominent "Start your 14-day free trial" buttons go to signup while only
  the plan-card buttons call `startCheckout()`. Deliberate (BILLING.md rule #1),
  worth re-confirming now that checkout is live.

### Data & auth

- **F1 · MED — equal-stamp conflicts don't converge.** `pickNewer` keeps local
  on a tie, so two clients that stamp the same millisecond each keep their own
  copy. *Improve:* deterministic tiebreak (serialized entity or device id).
- **F2 · MED — singleton both-changed conflicts silently keep local.** Profile /
  flightColumns / dashboardHidden edits from the other device are dropped with
  no surfacing. *Improve:* per-field stamps, or a sync-badge notice.
- **F14 · MED — an account created in an insecure context can be locked out
  (local-only mode).** `hashPassword` falls back to djb2 when `crypto.subtle` is
  missing (plain-http origin) but still writes a `salt`, so the record is
  indistinguishable from a real salted-SHA-256 one. Served later over
  https/localhost, the same password hashes with SHA-256 and **never matches** —
  "Incorrect password." forever. Reproduced by a probe in suite #3. Only affects
  the no-Supabase fallback. *Fix:* store the scheme (`alg: "djb2" | "sha256"`)
  and verify with the scheme that was used.
- **F15 · LOW — mirror eviction is invisible.** `loadCache`/`loadBase` can't tell
  "never synced" from "browser evicted the key". The next sync degrades to a
  base-less union (lossless), but a delete made offline on that device would
  resurrect.
- **F22 · LOW — `checkoutUrl` returns a bare link in local-only mode**, with no
  `client_reference_id`, so a purchase from a mis-deployed build can't be mapped
  to an account by `stripe-webhook`. Returning `/login?next=/pricing` in that
  branch makes it impossible.

### Domain fidelity

- **F3 · LOW — the Instrument Rating anchor is same-day, not first-of-month.**
  Same conservative direction as the medical rule that D3 fixed; the IR shows
  renewals up to ~30 days early.
- **F4 · LOW — Cat 1 40+ always gets 6 months.** The 6-month row applies to
  single-pilot air-transport ops; two-crew and private holders keep 12. Always-6
  is conservative. *Improve:* an ops-context toggle, or a note in the UI.
- **F5 · MED — CSV owner matching accepts 1–2 letter substrings.**
  `ownerRoleForRow` does bidirectional `includes()`: a bare initial `"K."`
  matches inside `"zohebkarmali"` and claims the row (wrong role, wrong `sicId`).
  *Improve:* require ≥3 characters, or match surname + initial explicitly.
- **F6 · LOW — no dedupe on CSV import.** Re-importing the same file doubles the
  logbook; the scan path flags duplicates, CSV doesn't. (Also on the TODO.)
- **F7 · LOW — ambiguous all-numeric dates assume M/D.** `05/06/2026` → May 6;
  Canadian D/M books get silently swapped where day ≤ 12. *Improve:* infer the
  file's convention from rows where day > 12 and apply it file-wide.
- **F8 · LOW — structured rows with night hours keep `takeoff/landing = "Day"`.**
  Mirrors disagree with the hour split until hand-edited.
- **F9 · LOW — importing into an empty account attributes the book to the first
  crew name.** The ownership pass trusts `currentPilotId`, which migration just
  set to the first *promoted crew member*. Onboarding-first (the real flow)
  avoids it; skipping the pass when no profile exists would close it.
- **F10 · MED — without OCR fragment positions, only the first decimal
  survives.** One value lands in `se`/`me`; day/night/IFR columns never populate.
  The confirm sheet is doing the real safety work. *Improve:* map x-bands to the
  TC column order; grow the golden set from real anonymized scans — **owner
  input wanted here**.
- **F11 · LOW — currency simplifications.** Takeoffs are assumed equal to
  landings; a flight's landings share its day/night classification; the CARs
  category/class split and sim credits aren't modeled. All labeled *reference
  only*.
- **F12 · LOW — duty hours are never derived from start/end.** A pilot logging
  times but not totals sees empty gauges.
- **F13 · LOW — `applyMerge(target ∈ sources)` deletes the target**, leaving
  flights pointing at a ghost id. The UI never offers it; a one-line filter
  would make it impossible.
- **F23 · LOW — empty-string ids block free-text crew promotion.** `migrateData`
  only promotes a text crew name when the id is `undefined`; `picId: ""` reads as
  "already resolved". That's consistent with `applyDeletePilot` (which clears to
  `""` deliberately), but it means **wizard imports never create pilot profiles
  for non-owner crew** — `planImport` pre-sets the ids to `""`, so only the
  owner's own slot gets a real id and everyone else survives as a text mirror.
  The legacy structured-CSV path does promote them, so the two importers disagree.
  Worth a comment in `migrate.ts` either way so the distinction isn't
  "fixed" by accident.

### Diagnostics & plumbing

- **F24 · LOW — the error buffer misses most real failures.** Only window
  `error` and `unhandledrejection` are captured: React errors caught by a
  boundary, `console.error`, and failed Supabase calls never reach it — so a
  sync failure a pilot reports arrives with an empty error list. It's also
  in-memory, so a crash that reloads the page clears its own evidence.
- **F25 · LOW — flight column keys are untyped display aliases.** `aircraft`,
  `reg`, `route`, `ifr` are resolved by `FlightTable`, not the type system;
  renaming a `Flight` field compiles clean and breaks only at render.

---

## Still needs testing

Ranked by risk. Nothing below is covered by `npx tsx evals/run.ts`.

1. **Supabase Edge Functions — zero automated coverage, highest server risk.**
   - `stripe-webhook` is the **only writer of `plb_entitlements`**: signature
     verification, the `STRIPE_PRICE_MAP` price→tier mapping, and the
     subscription lifecycle (upgrade, downgrade, cancel, payment failure,
     renewal) are all untested. A mapping typo silently sells the wrong tier.
     *Close it with:* Deno tests over a set of recorded Stripe event fixtures —
     they're pure JSON in, row out.
   - `scan-extract`: JWT rejection of anonymous callers, the premium check, the
     4-image cap, and "stores nothing".
   - `delete-account`: that a caller can only ever delete themselves.
2. **RLS policies (`supabase/schema.sql`).** The whole security model is
   `auth.uid() = user_id`, verified only by reading the DDL. A second test
   account and a few cross-user read/write attempts (or `pgTAP`) would prove it.
   Include `plb_entitlements` being read-only to its owner.
3. **`DataContext` orchestration** — the debounced push, the conditional
   `UPDATE … eq(updated_at, seen)` retry loop, `ready` gating, and mirror-first
   offline boot. The merge *math* is suite #1; the *choreography* around it is
   untested. *Close it with:* an integration harness against a mocked Supabase
   client (`applySession` + `pushState` are the seams).
4. **Real-device iOS** (`ScanPlugin.swift`, widgets, deep links) — OCR quality
   on real pages, widget refresh, cold-launch `pilotlogbook://new-flight`.
   Everything downstream of OCR text is covered; the capture itself isn't. The
   on-device checklist in `TODO.md §2` is still the plan of record.
5. **Scan accuracy on real logbooks.** The golden set is 29/29 on *synthetic,
   clean* lines — a regression floor, not a claim about real scans (F10).
   Anonymized photos of real pages would turn it into a real accuracy number.
6. **UI flows** — `FlightTable` bulk edit + range select, the Columns panel, the
   onboarding wizard, the scan confirm sheet, the Import Wizard end-to-end.
   *Close it with:* Playwright against the static export (`out/`) — no server
   needed, the export is plain files.
7. **The signed-in checkout URL** (`client_reference_id` + `prefilled_email`,
   `?`/`&` separator) — needs a live session, so it's manual in Stripe test mode
   today. Dependency-injecting the Supabase client into `checkoutUrl` would make
   it eval-able.
8. **Live-mode Stripe.** Test mode is verified end-to-end; live mode is pending
   incorporation (BILLING.md). One real purchase per plan, per period, before
   announcing.
9. **`cloudScan.ts` transport** — the `functions.invoke` error-unwrapping path
   and the fallback to on-device results. The response *sanitizers* are covered
   (suite #7); the network wrapper isn't.
10. **`pdfRender.ts`** — the jsPDF/autotable drawing layer. `buildPdfModel` (the
    numbers) is covered by suite #14; pagination and layout of the rendered file
    are eyeball-only.
11. **Accessibility, print CSS, and light-mode contrast** — never evaluated.

## Suggested cadence

Run `npx tsx evals/run.ts` before every release (seconds, no network; it exits
non-zero if any check fails). When a finding gets fixed, flip its probe into a
hard check in the same commit — that's how D1, D2 and D3 became permanent
regression tests. When a feature is added, add its suite in the same PR and
place it in the ranking by asking the question this file is built on: *what does
it cost the pilot if this is wrong?*
