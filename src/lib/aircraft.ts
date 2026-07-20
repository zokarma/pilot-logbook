// Standardized aircraft-type dropdown list + crew roles.
//
// AIRCRAFT_TYPES is the built-in catalog. Pilots can extend it with their own
// types via the Fleet manager (stored per-user in AppData.fleet); use
// fleetTypes(data.fleet) to get the combined, de-duplicated, sorted list that
// every picker should show.

export interface FleetOption { code: string; name: string; builtIn: boolean }

export const AIRCRAFT_TYPES: { code: string; name: string }[] = [
  { code: "C172", name: "Cessna 172" },
  { code: "C182", name: "Cessna 182" },
  { code: "PA28", name: "Piper PA-28" },
  { code: "DA20", name: "Diamond DA20" },
  { code: "DA40", name: "Diamond DA40" },
  { code: "DA42", name: "Diamond DA42" },
  { code: "BE20", name: "Beechcraft King Air 200" },
  { code: "PC-12", name: "Pilatus PC-12" },
  { code: "DHC-8", name: "De Havilland Dash 8" },
  { code: "CRJ200", name: "Bombardier CRJ200" },
  { code: "CRJ700", name: "Bombardier CRJ700" },
  { code: "CRJ900", name: "Bombardier CRJ900" },
  { code: "B737", name: "Boeing 737" },
  { code: "B738", name: "Boeing 737-800" },
  { code: "A220", name: "Airbus A220" },
  { code: "A320", name: "Airbus A320" },
  { code: "A321", name: "Airbus A321" },
];

// Canonical form of a type code for de-duping ("c 172" / "C172" → "C172").
export function normalizeAircraftCode(code: string): string {
  return (code || "").trim().toUpperCase().replace(/\s+/g, "");
}

// Built-in catalog + the pilot's custom fleet, de-duplicated by normalized code
// (built-ins win) and sorted by code. The list every aircraft picker renders.
export function fleetTypes(
  custom?: { code: string; name: string }[] | null,
  // Normalized built-in codes the pilot hid on the Fleet page (AppData.fleetHidden).
  // Only built-ins can be hidden; custom types are removed outright instead.
  hidden?: string[] | null,
): FleetOption[] {
  const out: FleetOption[] = [];
  const seen = new Set<string>();
  const hide = new Set((hidden ?? []).map(normalizeAircraftCode));
  for (const t of AIRCRAFT_TYPES) {
    const k = normalizeAircraftCode(t.code);
    if (!k || seen.has(k)) continue;
    seen.add(k); // hidden built-ins still claim their code so a custom can't shadow them
    if (hide.has(k)) continue;
    out.push({ code: t.code, name: t.name, builtIn: true });
  }
  for (const t of custom ?? []) {
    const k = normalizeAircraftCode(t.code);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ code: t.code, name: t.name, builtIn: false });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

// Friendly name for a type code, checking the pilot's custom fleet too. Falls
// back to the code itself for anything unknown (e.g. a legacy free-text type).
export function aircraftName(code: string, custom?: { code: string; name: string }[] | null): string {
  const k = normalizeAircraftCode(code);
  if (!k) return code || "";
  const all: { code: string; name: string }[] = [...AIRCRAFT_TYPES, ...(custom ?? [])];
  const t = all.find((x) => normalizeAircraftCode(x.code) === k);
  return t ? t.name : code || "";
}

export const CREW_ROLES = [
  "Captain",
  "First Officer",
  "Dual",
  "Student",
  "Dual Given",
  "Dual Received",
  "Instructor",
];
