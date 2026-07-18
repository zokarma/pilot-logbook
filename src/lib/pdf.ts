// PDF export — the PURE half. buildPdfModel turns AppData into a fully
// formatted page model (summary + chunked TC-style logbook pages with page /
// forward / grand totals); lib/pdfRender.ts feeds it to jsPDF. Keeping the
// model pure makes the totals math eval-able without a PDF engine.

import { AppData, Flight } from "./types";
import { flightDate, flightDateStr, ifrHours, pilotName } from "./logbook";
import { aircraftName } from "./aircraft";
import { flightLandings } from "./currency";
import { builtinCurrencyStatuses, customCurrencyStatuses } from "./currency";
import { documentStatus } from "./documents";

export const PDF_LOG_COLUMNS = [
  "Date", "Type", "Reg", "From", "To", "Role", "PIC",
  "SE", "ME", "XC", "Day", "Night", "IFR", "Ldg", "Remarks",
] as const;

// Indexes of the columns that get page/forward/grand totals.
export const PDF_NUMERIC_COLS = [7, 8, 9, 10, 11, 12, 13];

// Hours print with one decimal; landings are whole numbers.
const HOURS_COLS = new Set([7, 8, 9, 10, 11, 12]);

export interface PdfLogPage {
  rows: string[][];
  pageTotals: number[]; // aligned with PDF_NUMERIC_COLS
  forwardTotals: number[]; // cumulative including this page
}

export interface PdfSummary {
  flights: number;
  totalHours: number;
  se: number; me: number; xc: number; day: number; night: number; ifr: number; landings: number;
  byType: { code: string; name: string; hours: number }[];
  currencies: { name: string; ok: boolean; lapsesOn: string | null }[];
  documents: { type: string; label: string }[];
}

export interface PdfModel {
  pilotName: string;
  licence: string; // "CPL · A-123456" when a licence doc carries a number
  generatedOn: string; // "YYYY-MM-DD"
  summary: PdfSummary;
  pages: PdfLogPage[];
  grandTotals: number[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
export const fmtCell = (colIdx: number, n: number): string =>
  n === 0 ? "" : HOURS_COLS.has(colIdx) ? n.toFixed(1) : String(n);
export const fmtTotal = (colIdx: number, n: number): string =>
  HOURS_COLS.has(colIdx) ? r1(n).toFixed(1) : String(Math.round(n));

function numericValues(fl: Flight): number[] {
  // Aligned with PDF_NUMERIC_COLS: SE ME XC Day Night IFR Ldg
  return [fl.se || 0, fl.me || 0, fl.xc || 0, fl.dayHours || 0, fl.nightHours || 0, ifrHours(fl), flightLandings(fl)];
}

function rowCells(data: AppData, fl: Flight): string[] {
  const nums = numericValues(fl);
  return [
    flightDateStr(fl),
    fl.aircraftType || "",
    fl.registration || fl.civilIdent || "",
    fl.from || "",
    fl.to || "",
    fl.loggedRole || "",
    fl.pic || pilotName(data, fl.picId) || "",
    ...nums.map((n, i) => fmtCell(PDF_NUMERIC_COLS[i], n)),
    fl.notes || "",
  ];
}

export function buildPdfModel(data: AppData, rowsPerPage = 16): PdfModel {
  const pid = data.currentPilotId;
  const flights = data.flights
    .filter((f) => !pid || f.pilotId === pid)
    .sort((a, b) => flightDate(a).getTime() - flightDate(b).getTime()); // chronological, like a paper logbook

  const pages: PdfLogPage[] = [];
  const forward = PDF_NUMERIC_COLS.map(() => 0);
  for (let i = 0; i < flights.length; i += rowsPerPage) {
    const chunk = flights.slice(i, i + rowsPerPage);
    const pageTotals = PDF_NUMERIC_COLS.map(() => 0);
    for (const fl of chunk) {
      numericValues(fl).forEach((n, j) => { pageTotals[j] += n; });
    }
    pageTotals.forEach((n, j) => { forward[j] += n; });
    pages.push({
      rows: chunk.map((fl) => rowCells(data, fl)),
      pageTotals: pageTotals.map(r1),
      forwardTotals: forward.map(r1),
    });
  }
  const grandTotals = pages.length ? pages[pages.length - 1].forwardTotals : PDF_NUMERIC_COLS.map(() => 0);

  // -- summary --
  const sum = (pick: (fl: Flight) => number) => r1(flights.reduce((s, f) => s + pick(f), 0));
  const byTypeMap = new Map<string, number>();
  for (const fl of flights) {
    const code = (fl.aircraftType || "—").trim() || "—";
    byTypeMap.set(code, (byTypeMap.get(code) || 0) + (fl.se || 0) + (fl.me || 0));
  }
  const byType = [...byTypeMap.entries()]
    .map(([code, hours]) => ({ code, name: aircraftName(code, data.fleet), hours: r1(hours) }))
    .sort((a, b) => b.hours - a.hours);

  const currencies = [...builtinCurrencyStatuses(data), ...customCurrencyStatuses(data)]
    .map((c) => ({ name: c.name, ok: c.ok, lapsesOn: c.lapsesOn }));

  const documents = data.documents.map((doc) => ({ type: doc.type, label: documentStatus(doc).label }));

  // Licence line: first License-category doc that carries a number.
  const lic = data.documents.find((doc) => /licence|permit/i.test(doc.type) && doc.number);
  const profileName = data.profile
    ? `${data.profile.firstName} ${data.profile.lastName}`.trim()
    : pilotName(data, data.currentPilotId);

  const n = new Date();
  const generatedOn = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;

  return {
    pilotName: profileName || "Pilot",
    licence: lic ? `${lic.type} · ${lic.number}` : "",
    generatedOn,
    summary: {
      flights: flights.length,
      totalHours: sum((f) => (f.se || 0) + (f.me || 0)),
      se: sum((f) => f.se || 0),
      me: sum((f) => f.me || 0),
      xc: sum((f) => f.xc || 0),
      day: sum((f) => f.dayHours || 0),
      night: sum((f) => f.nightHours || 0),
      ifr: sum((f) => ifrHours(f)),
      landings: Math.round(flights.reduce((s, f) => s + flightLandings(f), 0)),
      byType,
      currencies,
      documents,
    },
    pages,
    grandTotals,
  };
}
