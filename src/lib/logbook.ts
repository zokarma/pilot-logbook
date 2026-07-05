// Pure helper functions over AppData / Flight. No global state — everything is
// derived from the data passed in.

import { AppData, Flight, Pilot } from "./types";

export function num(v: unknown): number {
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

export const totalHours = (fl: Flight): number => num(fl.se) + num(fl.me);
export const ifrHours = (fl: Flight): number => num(fl.ifrActual) + num(fl.ifrSim);

export function flightDateStr(fl: Flight): string {
  if (fl.date) return fl.date;
  if (fl.year) {
    const m = String(fl.month || 1).padStart(2, "0");
    const d = String(fl.day || 1).padStart(2, "0");
    return `${fl.year}-${m}-${d}`;
  }
  return "";
}

export function flightDate(fl: Flight): Date {
  const s = flightDateStr(fl);
  if (!s) return new Date(0);
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

export function pilotById(data: AppData, id: string | null): Pilot | null {
  if (!id) return null;
  return data.pilots.find((p) => p.id === id) || null;
}

export function pilotName(data: AppData, id: string | null | undefined): string {
  const p = pilotById(data, id ?? null);
  if (!p) return "";
  return ((p.firstName || "") + " " + (p.lastName || "")).trim();
}

export function currentPilot(data: AppData): Pilot | null {
  return pilotById(data, data.currentPilotId);
}

// Sorted list of flights for the currently selected pilot (newest first).
export function flightsForCurrentPilot(data: AppData): Flight[] {
  const pid = data.currentPilotId;
  return data.flights
    .filter((f) => !pid || f.pilotId === pid)
    .sort((a, b) => flightDate(b).getTime() - flightDate(a).getTime());
}

// Re-derive a flight's backward-compatible mirror fields (year/month/day,
// civilIdent, upper-cased reg/route, pic/sic/soc names) from its canonical
// fields. Mutates in place — call inside a mutate() draft after any edit so the
// CSV export and legacy readers stay consistent. See FlightForm for the same
// invariant on create.
export function syncFlightMirrors(data: AppData, fl: Flight): void {
  if (fl.date) {
    const [y, m, d] = fl.date.split("-").map((n) => parseInt(n, 10));
    if (y) { fl.year = y; fl.month = m; fl.day = d; }
  }
  fl.registration = (fl.registration || "").trim().toUpperCase();
  fl.civilIdent = fl.registration;
  fl.from = (fl.from || "").trim().toUpperCase();
  fl.to = (fl.to || "").trim().toUpperCase();
  fl.pic = pilotName(data, fl.picId);
  fl.sic = pilotName(data, fl.sicId);
  fl.soc = pilotName(data, fl.socId);
  fl.updated_at = new Date().toISOString();
}

// "YYYY-MM-DD" for a Date, using local calendar fields.
export function dstr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
