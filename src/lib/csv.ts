// CSV export / import. Import is the most intricate area: parseCSV ->
// detectStructuredLogbook decides between a flat CSV and a grouped/multi-header
// "structured logbook" export. All import functions are pure — they take the
// current AppData, mutate a working copy, run migrateData, and return the result.

import { AppData, Flight } from "./types";
import { migrateData } from "./migrate";
import { num, pilotName } from "./logbook";
import { uid } from "./id";

export const CSV_FIELDS = [
  "date", "year", "month", "day", "aircraftType", "civilIdent", "pic", "sic",
  "soc", "from", "to", "takeoff", "landing", "se", "me", "xc", "dayHours",
  "nightHours", "ifrActual", "ifrSim", "loggedRole", "notes",
] as const;

export const CSV_HEADERS = [
  "Date", "Year", "Month", "Day", "Aircraft Type", "Registration", "PIC", "SIC",
  "SOC", "ICAO From", "ICAO To", "Takeoff", "Landing", "Single Engine",
  "Multi Engine", "Cross Country", "Day Hours", "Night Hours", "IFR Actual",
  "IFR Simulated", "Logged Role", "Notes",
];

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(flights: Flight[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(",")];
  flights.forEach((fl) =>
    lines.push(CSV_FIELDS.map((f) => csvCell((fl as unknown as Record<string, unknown>)[f])).join(",")),
  );
  return lines.join("\r\n");
}

// RFC-4180-ish parser: handles quoted fields, embedded commas/quotes/newlines, CRLF & LF.
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9,
  oct: 10, nov: 11, dec: 12,
};

// Two-digit year -> 4-digit: 00-49 = 20XX, 50-99 = 19XX (matches Excel default).
export function expandTwoDigitYear(y: string | number): number {
  const n = +y;
  if (n < 100) return n < 50 ? 2000 + n : 1900 + n;
  return n;
}

// Parse many common date string shapes into [y,m,d] or null.
export function parseAnyDate(input: string, fallbackYear?: number | null): [number, number, number] | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (mt) return [+mt[1], +mt[2], +mt[3]];

  mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (mt) {
    const a = +mt[1], b = +mt[2], y = +mt[3];
    if (a > 12) return [y, b, a];
    return [y, a, b];
  }
  mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (mt) {
    const a = +mt[1], b = +mt[2], y = expandTwoDigitYear(mt[3]);
    if (a > 12) return [y, b, a];
    return [y, a, b];
  }

  mt = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$/);
  if (mt) {
    const m = MONTH_ABBR[mt[2].slice(0, 3).toLowerCase()];
    if (m) return [expandTwoDigitYear(mt[3]), m, +mt[1]];
  }
  mt = s.match(/^([A-Za-z]{3,9})[-/\s,]+(\d{1,2})[-/\s,]+(\d{2,4})$/);
  if (mt) {
    const m = MONTH_ABBR[mt[1].slice(0, 3).toLowerCase()];
    if (m) return [expandTwoDigitYear(mt[3]), m, +mt[2]];
  }

  mt = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})$/);
  if (mt && fallbackYear) {
    const m = MONTH_ABBR[mt[2].slice(0, 3).toLowerCase()];
    if (m) return [fallbackYear, m, +mt[1]];
  }
  mt = s.match(/^([A-Za-z]{3,9})[-/\s](\d{1,2})$/);
  if (mt && fallbackYear) {
    const m = MONTH_ABBR[mt[1].slice(0, 3).toLowerCase()];
    if (m) return [fallbackYear, m, +mt[2]];
  }

  if (/[A-Za-z]/.test(s) && /\d{2,}/.test(s)) {
    const t = new Date(s);
    if (!isNaN(t.getTime())) {
      const y = t.getFullYear();
      if (y >= 1900 && y <= 2200) return [y, t.getMonth() + 1, t.getDate()];
    }
  }
  return null;
}

// --- Structured logbook (multi-row headers w/ Single/Multi/XC groups) ---

export function detectStructuredLogbook(rows: string[][]): number {
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    if (rows[i].some((c) => /single\s*engine/i.test(c || ""))) return i;
  }
  return -1;
}

function buildCombinedHeaders(rows: string[][], groupRowIdx: number): string[] {
  const h1 = rows[groupRowIdx] || [];
  const h2 = rows[groupRowIdx + 1] || [];
  const h3 = rows[groupRowIdx + 2] || [];
  const ncols = Math.max(h1.length, h2.length, h3.length);
  const h1Filled: string[] = [];
  let last1 = "";
  for (let i = 0; i < ncols; i++) {
    const v1 = (h1[i] || "").trim();
    const v2 = (h2[i] || "").trim();
    const v3 = (h3[i] || "").trim();
    if (v1) last1 = v1;
    h1Filled[i] = v2 || v3 ? last1 : v1;
  }
  const h2Filled: string[] = [];
  let last2 = "";
  for (let i = 0; i < ncols; i++) {
    const v2 = (h2[i] || "").trim();
    const v3 = (h3[i] || "").trim();
    if (v2) last2 = v2;
    h2Filled[i] = v3 ? last2 : v2;
  }
  const combined: string[] = [];
  for (let i = 0; i < ncols; i++) {
    combined[i] = [h1Filled[i], h2Filled[i], (h3[i] || "").trim()].filter(Boolean).join(" ").trim();
  }
  return combined;
}

function mapLogbookHeader(h: string): string | null {
  const s = (h || "").toLowerCase();
  if (/^year$/.test(s)) return "year";
  if (/^date$/.test(s)) return "logdate";
  if (/^type$/.test(s)) return "aircraftType";
  if (/^ident|registration/.test(s)) return "registration";
  if (/^pic$/.test(s)) return "pic";
  if (/student|passenger|^sic$|first\s*officer/.test(s)) return "sic";
  if (/^from$/.test(s)) return "from";
  if (/^to$/.test(s)) return "to";
  if (/^info$|notes|remarks/.test(s)) return "notes";
  if (/single\s*engine.*day/.test(s)) return "se_day";
  if (/single\s*engine.*night/.test(s)) return "se_night";
  if (/multi\s*engine.*day/.test(s)) return "me_day";
  if (/multi\s*engine.*night/.test(s)) return "me_night";
  if (/cross\s*country.*day/.test(s)) return "xc_day";
  if (/cross\s*country.*night/.test(s)) return "xc_night";
  if (/ifr.*actual/.test(s) || /^ifr$/.test(s)) return "ifrActual";
  if (/ifr.*sim/.test(s)) return "ifrSim";
  return null;
}

export function normalizeName(s: string): string {
  return String(s || "").toLowerCase().replace(/[.,\s]+/g, "");
}

// Decide which crew slot the owner sat in for this row.
function ownerRoleForRow(picRaw: string, sicRaw: string, ownerNames: string[]): string | null {
  if (!ownerNames || !ownerNames.length) return null;
  const picN = normalizeName(picRaw);
  const sicN = normalizeName(sicRaw);
  for (const n of ownerNames) {
    if (!n) continue;
    if (picN && (picN === n || picN.includes(n) || n.includes(picN))) return "Captain";
    if (sicN && (sicN === n || sicN.includes(n) || n.includes(sicN))) return "Student";
  }
  return null;
}

export interface ImportResult {
  data: AppData;
  added: number;
  skipped: number;
  error?: string;
  format?: string;
  roleCounts?: { Captain: number; Student: number };
}

function importStructuredLogbook(
  data: AppData,
  rows: string[][],
  groupRowIdx: number,
  ownerNames: string[],
): ImportResult {
  const combined = buildCombinedHeaders(rows, groupRowIdx);
  const colMap = combined.map(mapLogbookHeader);

  if (!colMap.includes("logdate")) {
    return { data, added: 0, skipped: 0, error: "Couldn't find a Date column in this logbook." };
  }

  const yearCol = colMap.indexOf("year");
  const dateCol = colMap.indexOf("logdate");

  const roleCounts = { Captain: 0, Student: 0 };
  let added = 0;
  const skipped = 0;
  for (let r = groupRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const dateRaw = (row[dateCol] || "").trim();
    if (!dateRaw) continue;

    let fallbackYear: number | null = null;
    if (yearCol >= 0) {
      const yr = parseInt((row[yearCol] || "").trim(), 10);
      if (yr && yr >= 1900 && yr <= 3000) fallbackYear = yr;
    }

    const parsed = parseAnyDate(dateRaw, fallbackYear);
    if (!parsed) continue;
    const [y, m, d] = parsed;
    if (isNaN(y) || isNaN(m) || isNaN(d) || y < 1900 || y > 2200) continue;

    let se = 0, me = 0, xc = 0, dayH = 0, nightH = 0, ifrAct = 0, ifrSim = 0;
    const fieldVals: Record<string, string> = {};
    for (let i = 0; i < colMap.length; i++) {
      const mp = colMap[i];
      if (!mp) continue;
      const raw = (row[i] || "").trim();
      const v = parseFloat(raw);
      if (mp === "se_day" && !isNaN(v)) { se += v; dayH += v; }
      else if (mp === "se_night" && !isNaN(v)) { se += v; nightH += v; }
      else if (mp === "me_day" && !isNaN(v)) { me += v; dayH += v; }
      else if (mp === "me_night" && !isNaN(v)) { me += v; nightH += v; }
      else if (mp === "xc_day" && !isNaN(v)) xc += v;
      else if (mp === "xc_night" && !isNaN(v)) xc += v;
      else if (mp === "ifrActual" && !isNaN(v)) ifrAct += v;
      else if (mp === "ifrSim" && !isNaN(v)) ifrSim += v;
      else fieldVals[mp] = raw;
    }

    const role = ownerRoleForRow(fieldVals.pic, fieldVals.sic, ownerNames) || "Captain";
    roleCounts[role as "Captain" | "Student"] = (roleCounts[role as "Captain" | "Student"] || 0) + 1;

    data.flights.push({
      id: uid("f"),
      year: y, month: m, day: d,
      date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      aircraftType: fieldVals.aircraftType || "",
      civilIdent: (fieldVals.registration || "").toUpperCase(),
      registration: (fieldVals.registration || "").toUpperCase(),
      pic: fieldVals.pic || "", sic: fieldVals.sic || "", soc: "",
      from: (fieldVals.from || "").toUpperCase(),
      to: (fieldVals.to || "").toUpperCase(),
      takeoff: "Day", landing: "Day",
      se: +se.toFixed(2), me: +me.toFixed(2), xc: +xc.toFixed(2),
      dayHours: +dayH.toFixed(2), nightHours: +nightH.toFixed(2),
      ifrActual: +ifrAct.toFixed(2), ifrSim: +ifrSim.toFixed(2),
      loggedRole: role,
      notes: fieldVals.notes || "",
    } as Flight);
    added++;
  }

  if (added) {
    const migrated = migrateData(data);
    if (ownerNames && ownerNames.length && migrated.currentPilotId) {
      const myId = migrated.currentPilotId;
      for (let i = migrated.flights.length - 1; i >= Math.max(0, migrated.flights.length - added); i--) {
        const fl = migrated.flights[i];
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
        fl.pilotId = myId;
      }
    }
    return { data: migrated, added, skipped, format: "structured-logbook", roleCounts };
  }
  return { data, added, skipped, format: "structured-logbook", roleCounts };
}

export function importCSV(data: AppData, text: string, ownerNames: string[]): ImportResult {
  const rows = parseCSV(text);
  if (rows.length < 2) return { data, added: 0, skipped: 0, error: "File has no data rows." };

  const structIdx = detectStructuredLogbook(rows);
  if (structIdx >= 0) return importStructuredLogbook(data, rows, structIdx, ownerNames);

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  CSV_FIELDS.forEach((f, fi) => {
    let col = header.indexOf(f.toLowerCase());
    if (col === -1) col = header.indexOf(CSV_HEADERS[fi].toLowerCase());
    if (col !== -1) idx[f] = col;
  });
  const hasDate = idx.date != null;
  const hasYMD = idx.year != null && idx.month != null && idx.day != null;
  if (!hasDate && !hasYMD) {
    return {
      data, added: 0, skipped: 0,
      error: "CSV must include a Date column (YYYY-MM-DD) OR Year/Month/Day columns.",
    };
  }

  let added = 0, skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const get = (f: string) => (idx[f] != null ? (cells[idx[f]] || "").trim() : "");
    let y: number, m: number, d: number;
    if (hasDate) {
      const parsed = parseAnyDate(get("date"));
      if (!parsed) { skipped++; continue; }
      [y, m, d] = parsed;
    } else {
      y = parseInt(get("year"), 10); m = parseInt(get("month"), 10); d = parseInt(get("day"), 10);
      if (!isNaN(y) && y < 100) y = expandTwoDigitYear(y);
    }
    if (isNaN(y) || isNaN(m) || isNaN(d) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) { skipped++; continue; }
    data.flights.push({
      id: uid("f"),
      year: y, month: m, day: d,
      date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      aircraftType: get("aircraftType"),
      civilIdent: get("civilIdent"),
      registration: get("civilIdent").toUpperCase(),
      pic: get("pic"), sic: get("sic"), soc: get("soc"),
      from: get("from").toUpperCase(), to: get("to").toUpperCase(),
      takeoff: get("takeoff").toLowerCase() === "night" ? "Night" : "Day",
      landing: get("landing").toLowerCase() === "night" ? "Night" : "Day",
      se: num(get("se")), me: num(get("me")), xc: num(get("xc")),
      dayHours: num(get("dayHours")), nightHours: num(get("nightHours")),
      ifrActual: num(get("ifrActual")), ifrSim: num(get("ifrSim")),
      loggedRole: get("loggedRole") || "Captain",
      notes: get("notes"),
    } as Flight);
    added++;
  }
  if (added) return { data: migrateData(data), added, skipped };
  return { data, added, skipped };
}
