// Heuristic CSV column mapping for the import wizard. Pure and framework-free.
//
// The pipeline has three stages, kept strictly separate so the import itself
// stays deterministic and auditable ("AI/heuristics propose, code disposes"):
//
//   1. proposeMapping()   — suggest a target field per CSV column using exact
//                           / synonym / fuzzy header matching plus data-shape
//                           sniffing on sample values. Returns confidences so
//                           the wizard can highlight what needs review.
//   2. planImport()       — dry-run: turn rows + a *confirmed* mapping into
//                           Flight objects with per-row ok/skip status for the
//                           preview step. No AppData mutation.
//   3. applyMappedImport()— merge the planned flights into a working AppData
//                           copy, run migrateData, re-point owner rows, and
//                           remember the mapping as a reusable template.
//
// Phase 2 (AI-assisted mapping via an edge function) plugs in as an alternate
// proposal source for stage 1; stages 2-3 are unchanged by it.

import { AppData, Flight, ImportTemplate } from "./types";
import { migrateData } from "./migrate";
import { pilotName, findDuplicateFlights } from "./logbook";
import { parseAnyDate, expandTwoDigitYear, ownerRoleForRow } from "./csv";
import { uid } from "./id";
import { hashStr } from "./hash";

/* ---------------- target fields ---------------- */

export type FieldKind =
  | "date" | "year" | "month" | "dom" | "text" | "airport" | "name"
  | "hours" | "daynight" | "role";

export interface TargetField {
  key: string;
  label: string;   // shown in the wizard dropdowns
  group: string;   // optgroup in the dropdowns
  kind: FieldKind; // drives sample-compatibility checks + shape sniffing
  synonyms: string[]; // pre-normalized (lowercase, alphanumeric only)
}

// Note: keys `seDay`…`xcNight` and `total` are composite import targets (they
// fan out into se/me/xc/dayHours/nightHours), not Flight fields themselves.
export const TARGET_FIELDS: TargetField[] = [
  { key: "date", label: "Date", group: "Date", kind: "date",
    synonyms: ["date", "flightdate", "dateofflight", "dt", "flightday"] },
  { key: "year", label: "Year", group: "Date", kind: "year",
    synonyms: ["year", "yr"] },
  { key: "month", label: "Month", group: "Date", kind: "month",
    synonyms: ["month", "mo"] },
  { key: "day", label: "Day of Month", group: "Date", kind: "dom",
    synonyms: ["day", "dayofmonth", "dom"] },

  { key: "aircraftType", label: "Aircraft Type", group: "Aircraft", kind: "text",
    synonyms: ["aircrafttype", "type", "actype", "aircraft", "acfttype", "model",
      "aircraftmodel", "typedesignator", "equipment", "makeandmodel", "makemodel"] },
  { key: "registration", label: "Registration / Tail #", group: "Aircraft", kind: "text",
    synonyms: ["registration", "reg", "tailnumber", "tail", "ident", "civilident",
      "aircraftid", "acreg", "nnumber", "aircraftident", "aircraftregistration",
      "tailno", "acident", "callsign"] },

  { key: "pic", label: "PIC (name)", group: "Crew", kind: "name",
    synonyms: ["pic", "pilotincommand", "captain", "picname", "p1", "pilot1",
      "commander", "pilotname", "pilot"] },
  { key: "sic", label: "SIC / Student / FO (name)", group: "Crew", kind: "name",
    synonyms: ["sic", "student", "firstofficer", "fo", "copilot", "p2",
      "studentpassenger", "passenger", "sicname", "crew2", "secondpilot",
      "studentorpassenger"] },
  { key: "soc", label: "Third Crew (name)", group: "Crew", kind: "name",
    synonyms: ["soc", "secondofficer", "thirdcrew", "crew3", "observer", "p3"] },

  { key: "from", label: "From (ICAO)", group: "Route", kind: "airport",
    synonyms: ["from", "icaofrom", "departure", "origin", "dep", "routefrom",
      "departureairport", "fromairport", "out", "deptarturepoint", "departurepoint"] },
  { key: "to", label: "To (ICAO)", group: "Route", kind: "airport",
    synonyms: ["to", "icaoto", "arrival", "destination", "arr", "routeto",
      "arrivalairport", "toairport", "dest", "arrivalpoint"] },
  { key: "takeoff", label: "Takeoff (Day/Night)", group: "Route", kind: "daynight",
    synonyms: ["takeoff", "takeoffdaynight", "todaynight"] },
  { key: "landing", label: "Landing (Day/Night)", group: "Route", kind: "daynight",
    synonyms: ["landing", "ldg", "landingdaynight"] },

  { key: "se", label: "Single-Engine hrs", group: "Hours", kind: "hours",
    synonyms: ["se", "singleengine", "sel", "singleenginetime", "sehrs", "ses"] },
  { key: "me", label: "Multi-Engine hrs", group: "Hours", kind: "hours",
    synonyms: ["me", "multiengine", "mel", "multienginetime", "mehrs", "mes"] },
  { key: "xc", label: "Cross-Country hrs", group: "Hours", kind: "hours",
    synonyms: ["xc", "crosscountry", "xctime", "crosscountrytime", "xchrs"] },
  { key: "dayHours", label: "Day hrs", group: "Hours", kind: "hours",
    synonyms: ["dayhours", "daytime", "dayflying", "dayhrs"] },
  { key: "nightHours", label: "Night hrs", group: "Hours", kind: "hours",
    synonyms: ["nighthours", "night", "nighttime", "nightflying", "nighthrs"] },
  { key: "ifrActual", label: "IFR Actual hrs", group: "Hours", kind: "hours",
    synonyms: ["ifractual", "actualinstrument", "actualimc", "instrumentactual",
      "ifr", "actualinst", "imc", "actinst", "instrument"] },
  { key: "ifrSim", label: "IFR Simulated hrs", group: "Hours", kind: "hours",
    synonyms: ["ifrsim", "ifrsimulated", "simulatedinstrument", "hood",
      "simulatedimc", "siminst", "simulatedinst", "siminstrument"] },
  { key: "total", label: "Total Time (saved as Single-Engine)", group: "Hours", kind: "hours",
    synonyms: ["total", "totaltime", "duration", "totalduration", "blocktime",
      "block", "flighttime", "totalflighttime", "tt", "totalhrs", "totalhours"] },

  { key: "seDay", label: "Single-Engine · Day", group: "Grouped hours (paper logbooks)", kind: "hours",
    synonyms: ["singleengineday", "seday"] },
  { key: "seNight", label: "Single-Engine · Night", group: "Grouped hours (paper logbooks)", kind: "hours",
    synonyms: ["singleenginenight", "senight"] },
  { key: "meDay", label: "Multi-Engine · Day", group: "Grouped hours (paper logbooks)", kind: "hours",
    synonyms: ["multiengineday", "meday"] },
  { key: "meNight", label: "Multi-Engine · Night", group: "Grouped hours (paper logbooks)", kind: "hours",
    synonyms: ["multienginenight", "menight"] },
  { key: "xcDay", label: "Cross-Country · Day", group: "Grouped hours (paper logbooks)", kind: "hours",
    synonyms: ["crosscountryday", "xcday"] },
  { key: "xcNight", label: "Cross-Country · Night", group: "Grouped hours (paper logbooks)", kind: "hours",
    synonyms: ["crosscountrynight", "xcnight"] },

  { key: "loggedRole", label: "Logged Role", group: "Other", kind: "role",
    synonyms: ["loggedrole", "role", "function", "dutyposition", "capacity"] },
  { key: "notes", label: "Notes / Remarks", group: "Other", kind: "text",
    synonyms: ["notes", "remarks", "comments", "info", "remarksandendorsements", "memo"] },
];

const FIELD_BY_KEY: Record<string, TargetField> = Object.fromEntries(
  TARGET_FIELDS.map((f) => [f.key, f]),
);

export function targetField(key: string | null): TargetField | null {
  return key ? FIELD_BY_KEY[key] || null : null;
}

/* ---------------- header + value helpers ---------------- */

// "ICAO From " -> "icaofrom"
export function normHeader(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Hours cell -> number. Accepts decimals, "1:30" (h:mm) and "1,5" (comma decimal).
export function hoursVal(raw: string): number {
  const s = String(raw || "").trim();
  if (!s) return 0;
  const hm = s.match(/^(\d{1,3}):([0-5]\d)$/);
  if (hm) return +hm[1] + +hm[2] / 60;
  const n = parseFloat(s.replace(/^(\d+),(\d+)$/, "$1.$2"));
  return isNaN(n) ? 0 : n;
}

const isNumericish = (s: string) => /^-?\d+([.,:]\d+)?$/.test(s.trim());
const isDayNightish = (s: string) => /^(d|n|day|night)$/i.test(s.trim());
const isAirportish = (s: string) => /^[A-Za-z]{3,4}$/.test(s.trim());

// Would this column's sample values plausibly hold a field of this kind?
// Used to veto header matches that the data contradicts (e.g. a "PIC" column
// holding 1.5/2.0 is PIC *time*, not a crew name).
function samplesCompatible(kind: FieldKind, samples: string[]): boolean {
  if (!samples.length) return true; // nothing to contradict
  const frac = (pred: (s: string) => boolean) =>
    samples.filter(pred).length / samples.length;
  switch (kind) {
    case "name":
    case "text":
    case "role":
      return frac(isNumericish) < 0.5;
    case "hours":
      return frac((s) => isNumericish(s) && Math.abs(hoursVal(s)) <= 48) >= 0.5;
    case "date":
      return frac((s) => parseAnyDate(s, 2000) !== null) >= 0.5;
    case "daynight":
      return frac(isDayNightish) >= 0.5;
    case "airport":
      return frac(isAirportish) >= 0.5;
    case "year":
      return frac((s) => /^\d{2}$|^(19|20)\d{2}$/.test(s.trim())) >= 0.5;
    case "month":
      return frac((s) => { const n = parseInt(s, 10); return n >= 1 && n <= 12; }) >= 0.5;
    case "dom":
      return frac((s) => { const n = parseInt(s, 10); return n >= 1 && n <= 31; }) >= 0.5;
  }
}

// Dice coefficient on character bigrams — cheap fuzzy similarity for headers.
function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const ma = bigrams(a), mb = bigrams(b);
  let overlap = 0;
  ma.forEach((count, bg) => { overlap += Math.min(count, mb.get(bg) || 0); });
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

/* ---------------- stage 1: propose a mapping ---------------- */

export type MatchSource = "exact" | "synonym" | "fuzzy" | "shape" | "template" | "user" | "none";

export interface ColumnMapping {
  index: number;        // column index in the (flattened) header row
  header: string;       // original header text
  samples: string[];    // up to a few non-empty values, for display + sniffing
  field: string | null; // TARGET_FIELDS key, or null = don't import
  confidence: number;   // 0..1
  source: MatchSource;
}

export function collectSamples(rows: string[][], dataStart: number, col: number, max = 4): string[] {
  const out: string[] = [];
  for (let r = dataStart; r < rows.length && out.length < max; r++) {
    const v = (rows[r]?.[col] || "").trim();
    if (v) out.push(v);
  }
  return out;
}

interface Candidate { field: string; confidence: number; source: MatchSource }

function bestHeaderMatch(header: string, samples: string[]): Candidate | null {
  const h = normHeader(header);
  if (!h) return null;
  let best: Candidate | null = null;
  const consider = (field: TargetField, confidence: number, source: MatchSource) => {
    if (!samplesCompatible(field.kind, samples)) return;
    if (!best || confidence > best.confidence) best = { field: field.key, confidence, source };
  };
  for (const f of TARGET_FIELDS) {
    if (h === f.key.toLowerCase() || h === normHeader(f.label)) { consider(f, 1, "exact"); continue; }
    if (f.synonyms.includes(h)) { consider(f, 0.95, "synonym"); continue; }
    // Containment: "totalflighttimehrs" ⊃ "totalflighttime". Longer overlap =
    // better. Require ≥4 chars on the *contained* side so short synonyms
    // ("day", "me", "fo") don't match inside unrelated headers
    // ("DayLandings" must not become "Day of Month" — those come from the
    // exact-synonym lists instead).
    let cont = 0;
    for (const syn of f.synonyms) {
      const headerHasSyn = syn.length >= 4 && h.includes(syn);
      const synHasHeader = h.length >= 4 && syn.includes(h);
      if (headerHasSyn || synHasHeader) {
        cont = Math.max(cont, Math.min(syn.length, h.length) / Math.max(syn.length, h.length));
      }
    }
    if (cont > 0) { consider(f, 0.6 + 0.25 * cont, "fuzzy"); continue; }
    // Bigram similarity for typos / word-order changes.
    let sim = 0;
    for (const syn of f.synonyms) sim = Math.max(sim, diceSimilarity(h, syn));
    if (sim >= 0.75) consider(f, sim * 0.8, "fuzzy");
  }
  return best;
}

export function proposeMapping(headers: string[], rows: string[][], dataStart: number): ColumnMapping[] {
  const cols: ColumnMapping[] = headers.map((header, index) => {
    const samples = collectSamples(rows, dataStart, index);
    const match = header.trim() ? bestHeaderMatch(header, samples) : null;
    return {
      index, header: header.trim(), samples,
      field: match?.field ?? null,
      confidence: match?.confidence ?? 0,
      source: match?.source ?? "none",
    };
  });

  // Shape sniffing for still-unmatched columns. Only kinds whose shape is
  // unambiguous: dates, day/night flags, airport pairs. Hour columns all look
  // alike, so those stay unmapped for the user to resolve.
  const used = new Set(cols.filter((c) => c.field).map((c) => c.field as string));
  const assignShape = (c: ColumnMapping, field: string, confidence: number) => {
    if (used.has(field)) return;
    c.field = field; c.confidence = confidence; c.source = "shape";
    used.add(field);
  };
  for (const c of cols) {
    if (c.field || c.samples.length < 2) continue;
    const frac = (pred: (s: string) => boolean) =>
      c.samples.filter(pred).length / c.samples.length;
    if (!used.has("date") && frac((s) => parseAnyDate(s, 2000) !== null) >= 0.75 && !frac(isNumericish))
      { assignShape(c, "date", 0.6); continue; }
    if (frac(isDayNightish) >= 0.75)
      { assignShape(c, !used.has("takeoff") ? "takeoff" : "landing", 0.5); continue; }
    if (frac((s) => isAirportish(s) && !isDayNightish(s)) >= 0.75)
      { assignShape(c, !used.has("from") ? "from" : "to", 0.55); continue; }
  }

  // Enforce one column per target field: keep the highest-confidence claim.
  const byField = new Map<string, ColumnMapping>();
  for (const c of cols) {
    if (!c.field) continue;
    const cur = byField.get(c.field);
    if (!cur || c.confidence > cur.confidence) {
      if (cur) { cur.field = null; cur.confidence = 0; cur.source = "none"; }
      byField.set(c.field, c);
    } else {
      c.field = null; c.confidence = 0; c.source = "none";
    }
  }
  return cols;
}

/* ---------------- saved mapping templates ---------------- */

export function headerSignature(headers: string[]): string {
  return hashStr(headers.map(normHeader).join("|"));
}

export function findTemplate(data: AppData, headers: string[]): ImportTemplate | null {
  const sig = headerSignature(headers);
  return (data.importTemplates || []).find((t) => t.signature === sig) || null;
}

// Re-hydrate a saved template into a ColumnMapping list (headers must match
// the signature, so match by normalized header text).
export function applyTemplate(
  template: ImportTemplate, headers: string[], rows: string[][], dataStart: number,
): ColumnMapping[] {
  const byHeader = new Map(template.mapping.map((m) => [normHeader(m.header), m.field]));
  const seen = new Set<string>();
  return headers.map((header, index) => {
    let field = byHeader.get(normHeader(header)) ?? null;
    if (field && (seen.has(field) || !FIELD_BY_KEY[field])) field = null; // dupe/renamed field guard
    if (field) seen.add(field);
    return {
      index, header: header.trim(),
      samples: collectSamples(rows, dataStart, index),
      field, confidence: field ? 1 : 0,
      source: (field ? "template" : "none") as MatchSource,
    };
  });
}

/* ---------------- stage 2: dry-run plan ---------------- */

export interface RowPlan {
  row: number;              // index into `rows`
  ok: boolean;
  reason?: string;          // why skipped
  flight?: Flight;          // fully-built flight (ok rows only)
  ownerRole?: string | null;
}

export interface ImportPlan {
  rows: RowPlan[];
  added: number;
  skipped: number;
  roleCounts: { Captain: number; Student: number };
}

// Unique crew names appearing in name-mapped columns, most frequent first —
// feeds the "which name is you?" step.
export function collectCrewNames(rows: string[][], dataStart: number, mapping: ColumnMapping[]): string[] {
  const nameCols = mapping.filter((c) => {
    const f = targetField(c.field);
    return f?.kind === "name" && (f.key === "pic" || f.key === "sic");
  });
  const counts = new Map<string, number>();
  for (let r = dataStart; r < rows.length; r++) {
    for (const c of nameCols) {
      const v = (rows[r]?.[c.index] || "").trim();
      if (!v || isNumericish(v) || parseAnyDate(v)) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([name]) => name);
}

export function planImport(
  rows: string[][], dataStart: number, mapping: ColumnMapping[], ownerNames: string[],
): ImportPlan {
  const col: Record<string, number> = {};
  mapping.forEach((c) => { if (c.field) col[c.field] = c.index; });
  const get = (row: string[], f: string) =>
    col[f] != null ? (row[col[f]] || "").trim() : "";

  const plans: RowPlan[] = [];
  const roleCounts = { Captain: 0, Student: 0 };
  let added = 0, skipped = 0;

  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    const push = (p: RowPlan) => { plans.push(p); if (p.ok) added++; else skipped++; };

    // Date resolution: explicit date column (with year-column fallback for
    // paper logbooks that split them), else Year/Month/Day columns.
    let y = NaN, m = NaN, d = NaN;
    let fallbackYear: number | null = null;
    if (col.year != null) {
      const yr = parseInt(get(row, "year"), 10);
      const full = isNaN(yr) ? NaN : expandTwoDigitYear(yr);
      if (full >= 1900 && full <= 2200) fallbackYear = full;
    }
    if (col.date != null) {
      const raw = get(row, "date");
      if (!raw) { push({ row: r, ok: false, reason: "no date" }); continue; }
      const parsed = parseAnyDate(raw, fallbackYear);
      if (!parsed) { push({ row: r, ok: false, reason: `unreadable date "${raw.slice(0, 20)}"` }); continue; }
      [y, m, d] = parsed;
    } else {
      y = fallbackYear ?? NaN;
      m = parseInt(get(row, "month"), 10);
      d = parseInt(get(row, "day"), 10);
    }
    if (isNaN(y) || isNaN(m) || isNaN(d) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) {
      push({ row: r, ok: false, reason: "invalid date" });
      continue;
    }

    let se = hoursVal(get(row, "se"));
    let me = hoursVal(get(row, "me"));
    let xc = hoursVal(get(row, "xc"));
    let dayH = hoursVal(get(row, "dayHours"));
    let nightH = hoursVal(get(row, "nightHours"));
    // Grouped paper-logbook columns fan out into engine + day/night buckets.
    const seD = hoursVal(get(row, "seDay")), seN = hoursVal(get(row, "seNight"));
    const meD = hoursVal(get(row, "meDay")), meN = hoursVal(get(row, "meNight"));
    se += seD + seN; me += meD + meN;
    dayH += seD + meD; nightH += seN + meN;
    xc += hoursVal(get(row, "xcDay")) + hoursVal(get(row, "xcNight"));
    // "Total time" only counts when no engine-class hours were mapped/present.
    const total = hoursVal(get(row, "total"));
    if (total > 0 && se === 0 && me === 0) se = total;

    const picRaw = get(row, "pic"), sicRaw = get(row, "sic");
    const ownerRole = ownerRoleForRow(picRaw, sicRaw, ownerNames);
    const role = get(row, "loggedRole") || ownerRole || "Captain";
    if (role === "Captain" || role === "Student") {
      roleCounts[role as "Captain" | "Student"]++;
    }

    const reg = get(row, "registration").toUpperCase();
    const flight: Flight = {
      id: uid("f"),
      date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      year: y, month: m, day: d,
      aircraftType: get(row, "aircraftType"),
      registration: reg, civilIdent: reg,
      pilotId: null, // assigned on apply
      loggedRole: role,
      picId: "", sicId: "", socId: "",
      pic: picRaw, sic: sicRaw, soc: get(row, "soc"),
      from: get(row, "from").toUpperCase(), to: get(row, "to").toUpperCase(),
      takeoff: /^n/i.test(get(row, "takeoff")) ? "Night" : "Day",
      landing: /^n/i.test(get(row, "landing")) ? "Night" : "Day",
      se: +se.toFixed(2), me: +me.toFixed(2), xc: +xc.toFixed(2),
      dayHours: +dayH.toFixed(2), nightHours: +nightH.toFixed(2),
      ifrActual: +hoursVal(get(row, "ifrActual")).toFixed(2),
      ifrSim: +hoursVal(get(row, "ifrSim")).toFixed(2),
      notes: get(row, "notes"),
    };
    push({ row: r, ok: true, flight, ownerRole });
  }

  return { rows: plans, added, skipped, roleCounts };
}

// The mapping is importable when a full date can be derived.
export function mappingHasDate(mapping: ColumnMapping[]): boolean {
  const has = (f: string) => mapping.some((c) => c.field === f);
  return has("date") || (has("year") && has("month") && has("day"));
}

/* ---------------- stage 3: apply ---------------- */

export interface MappedImportResult {
  data: AppData;
  added: number;
  skipped: number;
  /** Rows that matched a flight already in the logbook and were not imported. */
  duplicates: number;
  roleCounts: { Captain: number; Student: number };
}

const MAX_TEMPLATES = 20;

export function applyMappedImport(
  data: AppData,          // a working copy — mutated in place (caller clones)
  rows: string[][],
  dataStart: number,
  mapping: ColumnMapping[],
  ownerNames: string[],
): MappedImportResult {
  const plan = planImport(rows, dataStart, mapping, ownerNames);

  // Drop rows that already exist in the logbook, so re-importing the same file
  // can't silently double it. Count-aware (see findDuplicateFlights): a leg
  // genuinely flown twice in a day still imports twice.
  const candidates = plan.rows.filter((p) => p.ok && p.flight).map((p) => p.flight!);
  const dupIdx = findDuplicateFlights(data.flights, candidates);
  const duplicates = dupIdx.size;
  candidates.forEach((fl, i) => { if (!dupIdx.has(i)) data.flights.push(fl); });
  const addedNew = candidates.length - duplicates;

  const migrated = migrateData(data); // back-fills picId/sicId from names, etc.

  // Imported flights belong to the logbook they were imported into; when the
  // owner identified themselves, also pin their crew slot to their profile.
  const myId = migrated.currentPilotId;
  // addedNew, NOT plan.added: skipped duplicates were never pushed, so using
  // the planned count would walk back past the new rows and re-pin flights the
  // pilot already had.
  if (addedNew && myId) {
    const start = migrated.flights.length - addedNew;
    for (let i = migrated.flights.length - 1; i >= Math.max(0, start); i--) {
      const fl = migrated.flights[i];
      fl.pilotId = myId;
      if (!ownerNames.length) continue;
      if (fl.loggedRole === "Student") {
        fl.sicId = myId;
        fl.sic = pilotName(migrated, myId);
      } else if (
        fl.loggedRole === "Captain" &&
        ownerRoleForRow(fl.pic || "", fl.sic || "", ownerNames) === "Captain"
      ) {
        fl.picId = myId;
        fl.pic = pilotName(migrated, myId);
      }
    }
  }

  // Remember this file shape so the next import with the same headers skips
  // straight to the preview.
  if (plan.added) {
    const headers = mapping.map((c) => c.header);
    const signature = headerSignature(headers);
    const entry: ImportTemplate = {
      id: uid("tpl"),
      signature,
      mapping: mapping.filter((c) => c.field).map((c) => ({ header: c.header, field: c.field as string })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const templates = (migrated.importTemplates || []).filter((t) => t.signature !== signature);
    templates.push(entry);
    migrated.importTemplates = templates.slice(-MAX_TEMPLATES);
  }

  // `added` reports what actually landed, so the UI never claims to have
  // imported rows it skipped as duplicates.
  return { data: migrated, added: addedNew, skipped: plan.skipped, duplicates, roleCounts: plan.roleCounts };
}
