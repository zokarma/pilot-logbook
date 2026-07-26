// Eval #17 — Logged-Flights column set (src/lib/flightColumns.ts).
// The per-user visible/ordered subset is stored in AppData.flightColumns and
// normalized on every load (migrate.ts) and every Columns-panel edit. A bad
// normalization empties the table — the pilot's logbook "disappears" even
// though the data is intact.

import {
  FLIGHT_COLUMNS, DEFAULT_FLIGHT_COLUMN_KEYS, FLIGHT_COLUMN_LABEL, normalizeFlightColumns,
} from "../src/lib/flightColumns";
import { Suite } from "./harness";

export function run(): Suite {
  const s = new Suite(17, "Flight table columns (flightColumns.ts)", "A bad normalization renders an empty table — the logbook looks lost even though it isn't.");

  const keys = FLIGHT_COLUMNS.map((c) => c.key);

  s.check("column keys are unique", new Set(keys).size === keys.length);
  s.check("every column has a non-empty label", FLIGHT_COLUMNS.every((c) => !!c.label.trim()));
  s.eq("the label map covers exactly the canonical keys", Object.keys(FLIGHT_COLUMN_LABEL).sort(), [...keys].sort());
  s.eq("defaults are every column, in declaration order", DEFAULT_FLIGHT_COLUMN_KEYS, keys);
  s.check("the canonical set covers the TC logbook essentials", ["date", "aircraft", "reg", "route", "role", "se", "me", "xc", "ifr"].every((k) => keys.includes(k)));

  /* ------------------------------ normalization ----------------------------- */
  s.eq("undefined (never customized) → the default set", normalizeFlightColumns(undefined), DEFAULT_FLIGHT_COLUMN_KEYS);
  s.eq("null (legacy row) → the default set", normalizeFlightColumns(null), DEFAULT_FLIGHT_COLUMN_KEYS);
  s.eq("a non-array value → the default set", normalizeFlightColumns("date,reg" as unknown as string[]), DEFAULT_FLIGHT_COLUMN_KEYS);
  s.eq("an empty list → the default set (never a column-less table)", normalizeFlightColumns([]), DEFAULT_FLIGHT_COLUMN_KEYS);
  s.eq("all-unknown keys → the default set", normalizeFlightColumns(["nope", "gone", "ancient"]), DEFAULT_FLIGHT_COLUMN_KEYS);

  s.eq("the pilot's chosen order is preserved verbatim", normalizeFlightColumns(["reg", "date", "se"]), ["reg", "date", "se"]);
  s.eq("a retired/unknown key is dropped, the rest kept in order", normalizeFlightColumns(["date", "instructorSignature", "reg"]), ["date", "reg"]);
  s.eq("duplicates collapse to the first occurrence", normalizeFlightColumns(["date", "reg", "date", "reg"]), ["date", "reg"]);
  s.eq("a single valid column is respected (not force-reset)", normalizeFlightColumns(["date"]), ["date"]);
  s.check("normalizing is idempotent", JSON.stringify(normalizeFlightColumns(normalizeFlightColumns(["reg", "x", "reg", "date"]))) === JSON.stringify(["reg", "date"]));

  /* --------------------------- mutation safety ------------------------------ */
  {
    const a = normalizeFlightColumns(null);
    s.check("the fallback returns a fresh array, not the shared constant", a !== DEFAULT_FLIGHT_COLUMN_KEYS);
    a.push("date");
    s.eq("mutating a normalized result can't corrupt the module default", DEFAULT_FLIGHT_COLUMN_KEYS, keys);
    const b = normalizeFlightColumns(["date", "reg"]);
    b.push("se");
    s.eq("two normalizations don't share backing state", normalizeFlightColumns(["date", "reg"]), ["date", "reg"]);
  }

  s.probe(
    "column keys are display aliases, not Flight field names",
    `keys like "aircraft" (aircraftType), "reg" (registration), "route" (from/to) and "ifr" (ifrActual) are resolved by FlightTable, not by the type system — renaming a Flight field would compile clean here and only break at render. A key→accessor map in this module would make the coupling type-checked.`,
  );

  return s;
}
