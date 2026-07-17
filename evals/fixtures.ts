// Shared fixture builders for the eval suites.

import { AppData, Flight, Pilot, emptyData } from "../src/lib/types";
import { OcrLine, OcrPage } from "../src/lib/scan";

export function mkPilot(id: string, firstName: string, lastName: string, extra: Partial<Pilot> = {}): Pilot {
  return {
    id,
    firstName,
    lastName,
    employeeNumber: "",
    licenseNumber: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

export function mkFlight(id: string, over: Partial<Flight> = {}): Flight {
  return {
    id,
    date: "2026-07-01",
    aircraftType: "C172",
    registration: "C-GABC",
    pilotId: null,
    loggedRole: "Captain",
    picId: "",
    sicId: "",
    socId: "",
    from: "CYNJ",
    to: "CYPK",
    takeoff: "Day",
    landing: "Day",
    se: 1.0,
    me: 0,
    xc: 0,
    dayHours: 1.0,
    nightHours: 0,
    ifrActual: 0,
    ifrSim: 0,
    notes: "",
    ...over,
  };
}

export function mkData(over: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...over };
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ISO stamp n milliseconds after a fixed epoch — for merge conflict ordering.
export const stampAt = (ms: number): string => new Date(1780000000000 + ms).toISOString();

// "YYYY-MM-DD" offset from *today* in local time (documentStatus/dashboard use
// local-midnight math).
export function localDateOffset(days: number): string {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// OCR fixtures. Confidence defaults to 0.95 (a clean scan).
export function ocrPage(lines: (string | OcrLine)[]): OcrPage {
  const ls: OcrLine[] = lines.map((l) => (typeof l === "string" ? { text: l, confidence: 0.95 } : l));
  return { text: ls.map((l) => l.text).join("\n"), lines: ls };
}
