// Eval #9 — airport reference data (src/lib/airports.ts).
// Map support: known Canadian fields resolve to real coordinates; unknown
// codes resolve to NULL (never a made-up position — the Route Map lists them
// for the pilot to place); the pilot's own placed airports extend and can
// correct the built-in DB.

import { AIRPORTS_DB, airportCoord, airportLabel, sortedAirportCodes } from "../src/lib/airports";
import type { CustomAirport } from "../src/lib/types";
import { Suite } from "./harness";

export function run(): Suite {
  const s = new Suite(9, "Airport DB (airports.ts)", "Route-map support data; wrong coords are cosmetic but visible.");

  const cyvr = airportCoord("CYVR")!;
  s.check("CYVR resolves to Vancouver's real coordinates", !!cyvr && Math.abs(cyvr[0] - 49.1939) < 0.01 && Math.abs(cyvr[1] + 123.1844) < 0.01);
  s.check("CYVR label names the airport", /vancouver/i.test(airportLabel("CYVR")));
  s.check("lookup normalizes case and whitespace", airportCoord(" cyvr ")![0] === cyvr[0]);

  {
    s.check("unknown code resolves to null — never a fabricated position", airportCoord("ZZZZ") === null);
    const custom: CustomAirport[] = [
      { id: "ap1", code: "cabc", lat: 50.5, lon: -120.25, name: "Test Strip" },
      { id: "ap2", code: "CYVR", lat: 1, lon: 2 }, // pilot correction shadows a built-in
      { id: "ap3", code: "CBAD", lat: NaN, lon: 3 }, // junk coords are ignored
    ];
    const placed = airportCoord("CABC", custom);
    s.check("custom airport resolves (code normalized)", !!placed && placed[0] === 50.5 && placed[1] === -120.25);
    s.check("custom placement wins over the built-in DB", airportCoord("CYVR", custom)![0] === 1);
    s.check("custom entry with junk coords is ignored", airportCoord("CBAD", custom) === null);
    s.check("custom label uses the pilot's name", /test strip/i.test(airportLabel("CABC", custom)));
    const codes = sortedAirportCodes(custom);
    s.check("autocomplete includes custom codes alongside the DB", codes.includes("CABC") && codes.includes("CYVR") && codes.length === Object.keys(AIRPORTS_DB).length + 1);
  }

  const db = Object.entries(AIRPORTS_DB);
  const bad = db.filter(([, [la, lo]]) => la < -90 || la > 90 || lo < -180 || lo > 180);
  s.check(`all ${db.length} DB entries have sane lat/lon`, bad.length === 0, bad.map(([c]) => c).join(","));

  return s;
}
