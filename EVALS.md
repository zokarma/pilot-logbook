# Feature Evals — Pilot Logbook

Behavioral evaluations of every core feature, ranked most- to least-important.
The suites live in `evals/` and run against the real `src/lib` code (which is
pure and framework-free, so no app boot is needed):

```
npx tsx evals/run.ts
```

- **check** = hard assertion. A failing check is a defect in the app, kept red
  on purpose until the underlying bug is fixed.
- **probe** = recorded behavior worth knowing (design limits, domain-accuracy
  gaps, guard-rail assumptions). Probes never fail the run.

**Last run: 2026-07-18 — 281/281 checks passed, 17 probes across 13 suites. Suites: #10 Fleet manager (18), #11 Currency math (24), #12 PDF export model (15), #13 CARs duty limits (14); the scan suite carries cloud-extraction sanitizer checks (42). The TC medical end-of-month rule (finding F4) shipped and its checks were updated to lock it in; the dashboard suite now covers operation-type (703/704/705) caps.**

| # | Feature | Suite | Result | Why it ranks here |
|---|---------|-------|--------|-------------------|
| 1 | Sync merge engine (`merge.ts`) | `evals/merge.eval.ts` | ✅ 27/27 | Silent data loss on a legal record is the worst possible failure |
| 2 | Data migration (`migrate.ts`) | `evals/migrate.eval.ts` | ✅ 22/22 | Runs on every load for every user; a bad upgrade corrupts everyone at once |
| 3 | TC document expiry math (`documents.ts`) | `evals/documents.eval.ts` | ✅ 28/28 | A wrong expiry can tell a pilot an invalid medical is valid |
| 4 | CSV import/export (`csv.ts`) | `evals/csv.eval.ts` | ✅ 31/31 | The de-facto backup/restore path; row corruption multiplies |
| 5 | OCR scan parser (`scan.ts`) | `evals/scan.eval.ts` | ✅ 33/33 | Newest data-entry path; heuristic accuracy + honest confidence flagging |
| 6 | Pilot dedupe & merge (`pilots.ts`) | `evals/pilots.eval.ts` | ✅ 17/17 | Destructive ops that rewrite flight references |
| 7 | IDs & flight mirrors (`id.ts`, `logbook.ts`) | `evals/core.eval.ts` | ✅ 12/12 | Duplicate ids / drifting mirrors corrupt everything downstream |
| 8 | Dashboard duty & CARs gauges (`dashboard.ts`) | `evals/dashboard.eval.ts` | ✅ 11/11 | Compliance display — windows and rest math must not mislead |
| 9 | Airport DB (`airports.ts`) | `evals/airports.eval.ts` | ✅ 9/9 | Map support; wrong coords are cosmetic but visible |

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
stamp is restored on unwrap. Evals now assert both devices converge on the newer
value and the merged entry keeps its stamp.

### D2 · HIGH — The app could not re-import its own CSV export ✅ FIXED
`csv.ts` · regression-guarded by `the app can re-import its OWN export (backup round-trip)`

`toCSV` writes a header containing **"Single Engine"**, and
`detectStructuredLogbook` treated any early row containing that phrase as a
structured Transport-Canada logbook. The app's own flat export therefore routed
into `importStructuredLogbook`, `buildCombinedHeaders` mashed the header with the
first two *data* rows, no Date column was found, and the import died with
*"Couldn't find a Date column in this logbook."* The same misdetection fed the
live Import Wizard (`logger/page.tsx`), polluting its suggested mappings too.

**Fix applied:** `detectStructuredLogbook` now skips a "Single Engine" row that
is itself a usable flat header (one that also carries a standalone `Date`, or
`Year`+`Month`+`Day`, column) — a grouped TC logbook keeps its real field-name
header on a *lower* row, so genuine structured detection is unchanged. Backup
round-trip (`importCSV(toCSV(x))`) now re-imports cleanly.

---

## Findings by feature (probes — decide, then fix or accept)

### 1 · Sync merge engine — 27/27 (D1 fixed)
Verified: offline adds union; deletes propagate via base with **edit-beats-delete**
in both directions; newer-stamp wins for flights/pilots; no-base degrades to a
lossless union; unknown top-level keys survive; `stampChanges` stamps exactly the
changed entities; `deepEqual` is key-order/undefined-insensitive; `sameStamp`
equates `Z`/`+00:00`.

- **F1 · MED — equal-stamp conflicts don't converge.** `pickNewer` keeps local on
  a tie, so two clients that stamp the same millisecond each keep their own copy.
  *Improve:* deterministic tiebreak (compare serialized entity or device id) so
  both sides pick the same winner.
- **F2 · MED — singleton both-changed conflicts silently keep local.** Profile /
  flightColumns / dashboardHidden edits from the other device are dropped without
  any surfacing. *Improve:* per-field `updatedAt` stamps for singletons, or at
  least a sync-badge notice when a singleton conflict was discarded.

### 2 · Data migration — 22/22
Verified: null input → complete empty state with the wizard armed; `year/month/day`
→ zero-padded `date`; `civilIdent` → `registration`; free-text crew promoted to
real pilots with case-insensitive reuse (one profile for three spellings);
`duty: true` upgraded; flightColumns normalized with full-garbage fallback;
existing users get a synthesized onboarded profile (never re-onboarded);
`migrate(migrate(x)) = migrate(x)`.

- **F3 · LOW — `picId: ""` blocks promotion.** Only `undefined` triggers free-text
  promotion; an imported row with empty-string ids and a text name skips it.
  Consistent with `applyDeletePilot`, but worth a comment in `migrate.ts` so the
  distinction isn't "fixed" accidentally either way.

### 3 · TC document expiry math — 28/28
Verified: month arithmetic clamps end-of-month (incl. leap years); age boundary
counts the birthday itself; the full medical validity table (Cat 1/3/4 × <40/40+)
including exam-on-40th-birthday; IR/CRM/DG issue-based expiries; missing
DOB/exam yields "" rather than a wrong date; status boundaries at 0/60/61 days
and the expired path; manual docs untouched by recalc.

- **F4 · MED (domain fidelity) — TC's end-of-month rule isn't modeled.** CARs
  validity runs to the first day of the month after the anniversary; the app
  anchors to the same day-of-month, up to ~30 days **shorter** than the pilot is
  entitled to. Safe direction, but renewals show early. *Improve:* implement the
  end-of-month extension in `computeAutoExpiry` (medicals and the IR), with the
  eval dates updated to the regulatory examples.
- **F5 · LOW — Cat 1 40+ always gets 6 months.** The 6-month row applies to
  single-pilot air-transport ops; two-crew and private holders keep 12. Always-6
  is conservative. *Improve:* an ops-context toggle on the profile, or a note in
  the Documents UI.

### 4 · CSV import/export — 31/31 (D2 fixed)
Verified: RFC-4180 parsing (quoted commas/quotes/newlines, CRLF); the full date
matrix incl. D/M-day>12 disambiguation and the 49/50 two-digit-year split; flat
round-trip fidelity for dates, gnarly notes, night flags, hours, registration,
role (once the detector defect is bypassed); structured TC import: 3-row header
flattening, Year+"May 5" dates, SE day/night + XC sums, owner-as-PIC → Captain
re-pointing, owner-in-student-column → Student with `sicId` = owner, every row
owned by the current pilot; skip accounting and the no-date error message.

- **F6 · MED — owner matching accepts 1–2 letter substrings.** `ownerRoleForRow`
  does bidirectional `includes()`: a bare initial `"K."` in a crew column matches
  inside `"zohebkarmali"` and claims the row (wrong role, wrong `sicId`).
  *Improve:* require a minimum match length (≥3) or match surname + initial
  patterns explicitly.
- **F7 · LOW — no dedupe on CSV import.** Re-importing the same file doubles the
  logbook; the scan path flags duplicates but CSV doesn't. *Improve:* reuse the
  scan duplicate detector (date+registration+route) in the import preview.
- **F8 · LOW — ambiguous all-numeric dates assume M/D.** `05/06/2026` → May 6;
  Canadian D/M books get silently swapped where day ≤ 12. *Improve:* detect the
  file's convention from rows where day > 12 and apply it file-wide, or ask in
  the wizard.
- **F9 · LOW — structured rows with night hours keep `takeoff/landing = "Day"`.**
  Mirrors disagree with the hour split until hand-edited.
- **F10 · LOW — importing into an empty account attributes the book to the first
  crew name.** The post-import ownership pass trusts `currentPilotId`, which
  migration just set to the first *promoted crew member*. Onboarding-first (the
  real flow) avoids it; a guard (skip ownership pass when no profile exists)
  would close it.

### 5 · OCR scan parser — 33/33
Verified: TC page-header (month/year) context + day-only rows, carried across
pages; header lines don't become flights; full-date rows at high confidence;
`CGABC` → `C-GABC` normalization; N-numbers + K-ICAOs; aircraft types never
misread as airports; ME types route hours to `me`; role keywords incl. the
"Instructor <name> is not Dual Given" guard; night flag; fragment x-positions
keep left-column numbers out of the hour fields; low OCR confidence lands under
`LOW_CONFIDENCE` so the confirm sheet flags it; document parsing (PPL + Cat 1
medical, labeled dates, licence numbers only near labels, chronological
fallback flagged for review, lone medical issue date → exam date); the FM
combiner's 0.95/0.75/0.55 agree/only/disagree ladder, with unclaimed heuristic
rows surfacing. Golden-set field accuracy: **29/29 (100%)** on clean synthetic
lines.

- **F11 · MED — without fragment positions, only the first decimal survives.**
  One value lands in `se`/`me`; day/night/IFR columns are never populated. The
  confirm sheet is doing the real safety work. *Improve:* when frags exist, map
  x-bands to the known TC column order instead of taking `hours[0]`; grow the
  golden set from real (anonymized) scans — **owner input wanted here**.
- Note: the 100% golden-set score is on synthetic, clean OCR lines — it's a
  regression floor, not a claim about real-world scans.

### 6 · Pilot dedupe & merge — 17/17
Verified: initial+surname dup keys cluster `Ben/B./b pearce` and nothing else;
merge re-points `pilotId/picId/sicId/socId` + text mirrors, back-fills empty
employee/licence numbers, removes sources, follows `currentPilotId`; delete
clears references to null/"" (never reassigns history) and falls back
`currentPilotId`; ref counting counts flights, not slots.

- **F12 · LOW — `applyMerge(target ∈ sources)` deletes the target** and leaves
  flights pointing at a ghost id. UI never offers it; a one-line
  `sourceIds = sourceIds.filter(id => id !== targetId)` makes it impossible.

### 7 · IDs & flight mirrors — 12/12
Verified: 200,000 `uid()` mints with zero collisions (the bulk-CSV scenario the
counter exists for); mirror re-derivation (y/m/d from date, uppercased
reg/route, `civilIdent`, crew names from ids, `updated_at` stamped); legacy
date fallbacks; per-pilot filtered + newest-first view.

### 8 · Dashboard duty & CARs gauges — 11/11
Verified: daily gauge reads today's entry; weekly window is exactly trailing 7
days (−6 in, −7 out); caps clamp at 100%; CARs 28-day window (−27 in, −28 out)
scoped to the current pilot; rest gap 22:00→08:00 = 10h; past-midnight duty
rolls its end forward (10h, not 34h); overlapping entries are skipped rather
than reported as negative rest; empty state is honest.

- **F13 · LOW — hours are never derived from start/end.** A pilot logging times
  but not totals sees empty gauges. *Improve:* fall back to `end − start`
  (with the same past-midnight rollover) when `hours` is absent.

### 9 · Airport DB — 9/9
Verified: real coordinates and labels for known fields; unknown codes fall back
deterministically (no map jitter between renders); every one of the DB entries
has sane lat/lon; the autocomplete list covers the DB and is pre-sorted.

---

## Not covered by these evals (and how to close the gap)

- **`importMap.ts` (the live Import Wizard mapping engine, 529 lines)** — the
  biggest untested pure module. Next suite to write; D2 above already implicates
  the wizard's header input.
- **`DataContext` orchestration** (debounce, conditional UPDATE retry loop,
  mirror-first boot) — React + Supabase; needs an integration harness with a
  mocked Supabase client rather than pure evals.
- **Native Swift side** (`ScanPlugin.swift` OCR quality, widgets, deep links) —
  device-only. The scan evals cover everything from OCR text onward; real
  anonymized logbook scans would let the golden set measure true accuracy.
- **UI flows** (FlightTable bulk edit, onboarding, confirm sheet) — Playwright
  against the static export would cover these.

## Suggested cadence

Run `npx tsx evals/run.ts` before every release (it's seconds, no network).
The run is fully green today; the D1/D2 checks now double as regression tests.
When another finding (F-series probe) is fixed, flip its probe into a hard check
in the same commit.
