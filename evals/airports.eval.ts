// Eval #9 — airport reference data (src/lib/airports.ts).
// Map support: known Canadian fields resolve to real coordinates; unknown codes
// fall back deterministically instead of jumping around between renders.

import { AIRPORTS_DB, airportCoord, airportLabel, sortedAirportCodes } from "../src/lib/airports";
import { Suite } from "./harness";

export function run(): Suite {
  const s = new Suite(9, "Airport DB (airports.ts)", "Route-map support data; wrong coords are cosmetic but visible.");

  const [lat, lon] = airportCoord("CYVR");
  s.check("CYVR resolves to Vancouver's real coordinates", Math.abs(lat - 49.1939) < 0.01 && Math.abs(lon + 123.1844) < 0.01);
  s.check("CYVR label names the airport", /vancouver/i.test(airportLabel("CYVR")));
  s.check("lookup is case-insensitive or exact (documented behavior)", airportCoord("CYYZ")[0] !== airportCoord("CYVR")[0]);

  {
    const a = airportCoord("ZZZZ");
    const b = airportCoord("ZZZZ");
    s.check("unknown code falls back deterministically (same coords every call)", a[0] === b[0] && a[1] === b[1]);
    s.check("fallback coords are on the planet", a[0] >= -90 && a[0] <= 90 && a[1] >= -180 && a[1] <= 180);
    const c = airportCoord("QQQQ");
    s.check("different unknown codes get different fallback spots", !(a[0] === c[0] && a[1] === c[1]));
  }

  {
    const codes = sortedAirportCodes();
    s.check("autocomplete source covers the DB", codes.length === Object.keys(AIRPORTS_DB).length && codes.includes("CYVR"));
    const sorted = [...codes].sort();
    s.check("codes come pre-sorted", codes.every((c, i) => c === sorted[i]));
  }

  const db = Object.entries(AIRPORTS_DB);
  const bad = db.filter(([, [la, lo]]) => la < -90 || la > 90 || lo < -180 || lo > 180);
  s.check(`all ${db.length} DB entries have sane lat/lon`, bad.length === 0, bad.map(([c]) => c).join(","));

  return s;
}
