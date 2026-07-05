// Canonical column set for the Logged Flights table. The per-user visible set
// and order live in AppData.flightColumns (a list of these keys, in display
// order). Pure/framework-free so migrate.ts and the table share one source.

export const FLIGHT_COLUMNS: { key: string; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "aircraft", label: "Aircraft" },
  { key: "reg", label: "Reg" },
  { key: "route", label: "Route" },
  { key: "role", label: "Role" },
  { key: "pic", label: "PIC" },
  { key: "sic", label: "Student / FO" },
  { key: "soc", label: "Third" },
  { key: "se", label: "SE" },
  { key: "me", label: "ME" },
  { key: "xc", label: "XC" },
  { key: "ifr", label: "IFR" },
  { key: "takeoff", label: "T/O" },
  { key: "landing", label: "Ldg" },
];

export const DEFAULT_FLIGHT_COLUMN_KEYS: string[] = FLIGHT_COLUMNS.map((c) => c.key);

export const FLIGHT_COLUMN_LABEL: Record<string, string> = Object.fromEntries(
  FLIGHT_COLUMNS.map((c) => [c.key, c.label]),
);

// Drop unknown keys, de-dupe, and fall back to the default order when the
// stored value is missing or would leave the table with no columns.
export function normalizeFlightColumns(cols?: string[] | null): string[] {
  const valid = new Set(DEFAULT_FLIGHT_COLUMN_KEYS);
  if (!Array.isArray(cols)) return [...DEFAULT_FLIGHT_COLUMN_KEYS];
  const seen = new Set<string>();
  const out = cols.filter((k) => valid.has(k) && !seen.has(k) && seen.add(k));
  return out.length ? out : [...DEFAULT_FLIGHT_COLUMN_KEYS];
}
