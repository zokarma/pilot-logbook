// Scan-extraction schema + heuristic parser for the native OCR pipeline.
//
// The iOS Scan plugin (ios/App/App/ScanPlugin.swift) returns raw OCR pages
// (VisionKit document camera → Vision text recognition) and, on Apple
// Intelligence devices (iOS 26+), an optional Foundation-Models structured
// extraction. This module turns either into ScannedFlight / ScannedDocument
// candidates carrying per-field confidence 0..1 — targeting the REAL Flight /
// PilotDocument field names (src/lib/types.ts), never invented ones.
//
// RULE (from the build plan): scans are never auto-saved. The UI pre-fills a
// confirm sheet, highlights low-confidence fields, and the pilot approves.
//
// Pure and framework-free like the rest of src/lib. The synonym seeds mirror
// the CSV import heuristics in importMap.ts.

import { DayNight } from "./types";
import { parseAnyDate } from "./csv";
import { DOC_TYPES } from "./documents";

export interface ConfidentField<T> {
  value: T;
  confidence: number; // 0..1
}
type CF<T> = ConfidentField<T>;

export interface ScannedFlight {
  date?: CF<string>; // "YYYY-MM-DD"
  aircraftType?: CF<string>;
  registration?: CF<string>;
  loggedRole?: CF<string>;
  from?: CF<string>;
  to?: CF<string>;
  takeoff?: CF<DayNight>;
  landing?: CF<DayNight>;
  se?: CF<number>;
  me?: CF<number>;
  xc?: CF<number>;
  dayHours?: CF<number>;
  nightHours?: CF<number>;
  ifrActual?: CF<number>;
  ifrSim?: CF<number>;
  notes?: CF<string>;
  // Crew as scanned names; the confirm UI maps them onto Pilot profiles.
  pic?: CF<string>;
  sic?: CF<string>;
  overall: number;
  source: string; // the OCR line(s) this flight came from
}

export interface ScannedDocument {
  type?: CF<string>; // a DOC_TYPES value (or free text)
  number?: CF<string>;
  issueDate?: CF<string>;
  examDate?: CF<string>;
  expiryDate?: CF<string>;
  overall: number;
  source: string;
}

// Shape returned by the native plugin.
export interface OcrLine { text: string; confidence: number }
export interface OcrPage { text: string; lines: OcrLine[] }
export interface ScanPluginResult {
  pages: OcrPage[];
  // Foundation-Models extraction (iOS 26 Apple Intelligence), when available.
  fmFlights?: FmFlight[];
  fmDocument?: FmDocument;
}
// FM output carries no confidences — those are assigned in combine*() below.
export interface FmFlight {
  date?: string; aircraftType?: string; registration?: string;
  loggedRole?: string; from?: string; to?: string;
  se?: number; me?: number; xc?: number; dayHours?: number; nightHours?: number;
  ifrActual?: number; ifrSim?: number; notes?: string; pic?: string; sic?: string;
}
export interface FmDocument {
  type?: string; number?: string; issueDate?: string; examDate?: string; expiryDate?: string;
}

/* ------------------------------ tokens ------------------------------ */

const RE_REG = /\b(C-?[FGI][A-Z]{3}|N[0-9]{1,5}[A-Z]{0,2})\b/; // Canadian + N-number
const RE_ICAO = /\b(C[A-Z0-9]{3}|K[A-Z]{3})\b/g; // Canadian/US ICAO
const RE_HOURS = /\b([0-9]{1,2}[.,][0-9])\b/g; // decimal tenths, logbook style
const RE_TYPE = /\b(C-?1[5-9][0-9]|C-?2[0-9]{2}|PA-?[0-9]{2}|DA-?[0-9]{2}|BE-?[0-9]{2}|DHC-?[0-9]|CRJ-?[0-9]{3}|B7[0-9]{2}|A2[0-9]{2}|A3[0-9]{2}|PC-?12|SR2[02])\b/;

const ROLE_WORDS: [RegExp, string][] = [
  [/\b(pic|p1|capt|captain|self)\b/i, "Captain"],
  [/\b(sic|p2|fo|firstofficer|first officer|co-?pilot)\b/i, "First Officer"],
  [/\b(dual received|dual rec)\b/i, "Dual Received"],
  [/\b(dual given|instructor|instr)\b/i, "Dual Given"],
  [/\bdual\b/i, "Dual"],
  [/\b(student|stud)\b/i, "Student"],
];

const clampConf = (n: number) => Math.max(0, Math.min(1, n));

// csv.parseAnyDate returns a [y, m, d] tuple; scans want "YYYY-MM-DD".
function parseDateStr(s: string): string | null {
  const t = parseAnyDate(s);
  if (!t) return null;
  const [y, m, d] = t;
  if (!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function field<T>(value: T, confidence: number): CF<T> {
  return { value, confidence: clampConf(confidence) };
}

// Mean confidence of the fields that are present.
function overallOf(fields: (CF<unknown> | undefined)[]): number {
  const present = fields.filter((f): f is CF<unknown> => !!f);
  if (!present.length) return 0;
  return clampConf(present.reduce((s, f) => s + f.confidence, 0) / present.length);
}

/* ------------------------- flights (logbook page) ------------------------- */

// A logbook/journey-log page is one flight per line (roughly). A line becomes
// a candidate when it contains a parseable date; everything else on the line
// fills in around it with pattern-based confidence.
export function parseFlightsFromOcr(pages: OcrPage[]): ScannedFlight[] {
  const out: ScannedFlight[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      const f = parseFlightLine(line.text, line.confidence);
      if (f) out.push(f);
    }
  }
  return out;
}

function parseFlightLine(raw: string, ocrConf: number): ScannedFlight | null {
  const text = raw.trim();
  if (text.length < 6) return null;

  // Date anchors the row. Try whole segments first, then token windows.
  let date: string | null = null;
  const tokens = text.split(/\s+/);
  for (let w = 3; w >= 1 && !date; w--) {
    for (let i = 0; i + w <= tokens.length && !date; i++) {
      date = parseDateStr(tokens.slice(i, i + w).join(" "));
    }
  }
  if (!date) return null;

  const f: ScannedFlight = { overall: 0, source: raw };
  // OCR line confidence scales everything on the line.
  const base = clampConf(0.35 + 0.65 * ocrConf);

  f.date = field(date, 0.9 * base);

  const reg = text.match(RE_REG);
  if (reg) {
    const norm = reg[1].startsWith("C") && !reg[1].includes("-")
      ? "C-" + reg[1].slice(1)
      : reg[1];
    f.registration = field(norm.toUpperCase(), 0.9 * base);
  }

  const type = text.match(RE_TYPE);
  if (type) f.aircraftType = field(type[1].replace("-", "").toUpperCase(), 0.7 * base);

  const icaos = [...text.matchAll(RE_ICAO)].map((m) => m[1].toUpperCase())
    // registration fragments like "C-GABC" can false-positive as ICAO codes
    .filter((c) => !f.registration || !f.registration.value.replace("-", "").includes(c));
  if (icaos.length >= 2) {
    f.from = field(icaos[0], 0.8 * base);
    f.to = field(icaos[1], 0.8 * base);
  } else if (icaos.length === 1) {
    f.from = field(icaos[0], 0.45 * base);
  }

  for (const [re, role] of ROLE_WORDS) {
    if (re.test(text)) { f.loggedRole = field(role, 0.6 * base); break; }
  }

  if (/\bnight\b/i.test(text)) {
    f.takeoff = field("Night" as DayNight, 0.5 * base);
    f.landing = field("Night" as DayNight, 0.5 * base);
  }

  // Hour columns OCR as bare decimals with no headers attached; without
  // positional information the first decimal is *probably* the block/total
  // time. Assign conservatively and let the confirm sheet sort it out.
  const hours = [...text.matchAll(RE_HOURS)]
    .map((m) => parseFloat(m[1].replace(",", ".")))
    .filter((n) => n > 0 && n <= 24);
  if (hours.length) {
    f.se = field(hours[0], 0.4 * base);
    if (/\b(xc|x-c|cross)\b/i.test(text) && hours.length > 1) {
      f.xc = field(hours[1], 0.45 * base);
    }
  }

  f.overall = overallOf([f.date, f.registration, f.aircraftType, f.from, f.to, f.se]);
  // A date alone isn't a flight; require one more aviation signal.
  if (!f.registration && !f.from && !f.aircraftType && !f.se) return null;
  return f;
}

/* ------------------------- documents (licence/medical) ------------------------- */

const DOC_KEYWORDS: [RegExp, string][] = [
  [/student pilot permit/i, "Student Pilot Permit (SPP)"],
  [/private pilot/i, "Private Pilot Licence (PPL)"],
  [/commercial pilot/i, "Commercial Pilot Licence (CPL)"],
  [/airline transport/i, "Airline Transport Pilot Licence (ATPL)"],
  [/(category|cat\.?)\s*1/i, "Category 1 Medical"],
  [/(category|cat\.?)\s*3/i, "Category 3 Medical"],
  [/(category|cat\.?)\s*4/i, "Category 4 Medical"],
  [/medical certificate/i, "Category 3 Medical"],
  [/restricted operator/i, "Restricted Operator Certificate (Aeronautical)"],
  [/radio( telephone)? operator/i, "Radio Operator Certificate"],
  [/instrument rating/i, "Instrument Rating"],
  [/multi-?engine/i, "Multi-Engine Rating"],
  [/instructor rating/i, "Instructor Rating"],
];

// Labeled-date extraction: "<label words> ... <date>" on the same OCR line.
const DATE_LABELS: { keys: RegExp; field: "issueDate" | "examDate" | "expiryDate" }[] = [
  { keys: /(expiry|expires?|valid (to|until)|vru)/i, field: "expiryDate" },
  { keys: /(exam|examination|medical date)/i, field: "examDate" },
  { keys: /(issue[d]?|date of issue|doi)/i, field: "issueDate" },
];

export function parseDocumentFromOcr(pages: OcrPage[]): ScannedDocument | null {
  const allText = pages.map((p) => p.text).join("\n");
  if (!allText.trim()) return null;
  const lines = pages.flatMap((p) => p.lines);
  const doc: ScannedDocument = { overall: 0, source: allText.slice(0, 400) };

  for (const [re, type] of DOC_KEYWORDS) {
    if (re.test(allText)) {
      const known = DOC_TYPES.some((d) => d.value === type);
      doc.type = field(type, known ? 0.85 : 0.5);
      break;
    }
  }

  // Licence/permit number: prefer one near a "no./number/licence" label.
  for (const line of lines) {
    const m = line.text.match(/(licen[cs]e|permit|certificate|document)?\s*(no\.?|number|#)?\s*:?\s*\b([A-Z]{0,3}-?\d{5,8})\b/i);
    if (m && (m[1] || m[2])) {
      doc.number = field(m[3].toUpperCase(), 0.8 * clampConf(0.35 + 0.65 * line.confidence));
      break;
    }
  }

  // Labeled dates first; fall back to chronological guessing.
  const unlabeled: string[] = [];
  for (const line of lines) {
    const d = parseDateStr(line.text.replace(/[^\dA-Za-z ,./-]/g, " ")) ||
      firstDateIn(line.text);
    if (!d) continue;
    const label = DATE_LABELS.find((l) => l.keys.test(line.text));
    if (label && !doc[label.field]) {
      doc[label.field] = field(d, 0.85 * clampConf(0.35 + 0.65 * line.confidence));
    } else {
      unlabeled.push(d);
    }
  }
  if (!doc.issueDate && !doc.expiryDate && unlabeled.length >= 2) {
    const sorted = [...unlabeled].sort();
    doc.issueDate = field(sorted[0], 0.4);
    doc.expiryDate = field(sorted[sorted.length - 1], 0.4);
  } else if (!doc.issueDate && unlabeled.length === 1) {
    doc.issueDate = field(unlabeled[0], 0.35);
  }
  // Medicals key off the exam date; a lone issue date on a medical is
  // almost certainly the exam date.
  if (doc.type?.value.includes("Medical") && !doc.examDate && doc.issueDate) {
    doc.examDate = { ...doc.issueDate };
  }

  doc.overall = overallOf([doc.type, doc.number, doc.issueDate, doc.examDate, doc.expiryDate]);
  return doc.type || doc.number || doc.issueDate || doc.expiryDate ? doc : null;
}

function firstDateIn(text: string): string | null {
  const tokens = text.split(/\s+/);
  for (let w = 3; w >= 1; w--) {
    for (let i = 0; i + w <= tokens.length; i++) {
      const d = parseDateStr(tokens.slice(i, i + w).join(" "));
      if (d) return d;
    }
  }
  return null;
}

/* --------------------- combine FM + heuristic candidates --------------------- */
// Foundation-Models output is generally better at reading messy layouts but
// carries no confidences: FM-only fields get 0.75; where the heuristic parser
// AGREES the field is promoted to 0.95; heuristic-only fields keep their own
// confidence. Disagreements keep the FM value at 0.55 — visibly "check me".

function combineField<T>(fm: T | undefined, heur: CF<T> | undefined): CF<T> | undefined {
  if (fm === undefined || fm === null || (typeof fm === "string" && !fm.trim())) return heur;
  if (!heur) return field(fm, 0.75);
  const same = typeof fm === "string" && typeof heur.value === "string"
    ? fm.trim().toUpperCase() === heur.value.trim().toUpperCase()
    : fm === heur.value;
  return same ? field(heur.value, 0.95) : field(fm, 0.55);
}

export function combineFlights(fm: FmFlight[] | undefined, heur: ScannedFlight[]): ScannedFlight[] {
  if (!fm?.length) return heur;
  // Match FM flights to heuristic rows by date+registration, else by order.
  const used = new Set<number>();
  return fm.map((m, idx) => {
    let hIdx = heur.findIndex((h, i) => !used.has(i) && h.date?.value === m.date &&
      (!m.registration || h.registration?.value === m.registration?.toUpperCase()));
    if (hIdx < 0) hIdx = heur.findIndex((_, i) => !used.has(i) && i === idx);
    const h = hIdx >= 0 ? heur[hIdx] : undefined;
    if (hIdx >= 0) used.add(hIdx);
    const f: ScannedFlight = {
      overall: 0,
      source: h?.source ?? "(Apple Intelligence extraction)",
      date: combineField(m.date, h?.date),
      aircraftType: combineField(m.aircraftType, h?.aircraftType),
      registration: combineField(m.registration?.toUpperCase(), h?.registration),
      loggedRole: combineField(m.loggedRole, h?.loggedRole),
      from: combineField(m.from?.toUpperCase(), h?.from),
      to: combineField(m.to?.toUpperCase(), h?.to),
      se: combineField(m.se, h?.se),
      me: combineField(m.me, h?.me),
      xc: combineField(m.xc, h?.xc),
      dayHours: combineField(m.dayHours, h?.dayHours),
      nightHours: combineField(m.nightHours, h?.nightHours),
      ifrActual: combineField(m.ifrActual, h?.ifrActual),
      ifrSim: combineField(m.ifrSim, h?.ifrSim),
      notes: combineField(m.notes, h?.notes),
      pic: combineField(m.pic, h?.pic),
      sic: combineField(m.sic, h?.sic),
      takeoff: h?.takeoff,
      landing: h?.landing,
    };
    f.overall = overallOf([f.date, f.registration, f.aircraftType, f.from, f.to, f.se, f.me]);
    return f;
    // Heuristic rows no FM flight claimed still surface for review.
  }).concat(heur.filter((_, i) => !used.has(i)));
}

export function combineDocument(fm: FmDocument | undefined, heur: ScannedDocument | null): ScannedDocument | null {
  if (!fm) return heur;
  const doc: ScannedDocument = {
    overall: 0,
    source: heur?.source ?? "(Apple Intelligence extraction)",
    type: combineField(fm.type, heur?.type),
    number: combineField(fm.number, heur?.number),
    issueDate: combineField(fm.issueDate, heur?.issueDate),
    examDate: combineField(fm.examDate, heur?.examDate),
    expiryDate: combineField(fm.expiryDate, heur?.expiryDate),
  };
  doc.overall = overallOf([doc.type, doc.number, doc.issueDate, doc.examDate, doc.expiryDate]);
  return doc.type || doc.number || doc.issueDate || doc.expiryDate ? doc : heur;
}

// Confidence below this ⇒ the confirm UI highlights the field for review.
export const LOW_CONFIDENCE = 0.7;
