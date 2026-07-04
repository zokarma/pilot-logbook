// Standardized aircraft-type dropdown list + crew roles.

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

export function aircraftName(code: string): string {
  const t = AIRCRAFT_TYPES.find((x) => x.code === code);
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
