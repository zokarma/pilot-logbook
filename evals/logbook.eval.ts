// Eval #15 — registration → aircraft-type lookup (src/lib/logbook.ts).
// Shared by the flight form and the flight-table quick edit: typing a known
// tail fills in its aircraft type. Must match the most recent type, accept the
// colloquial short form, and never guess on short or ambiguous input.

import { buildRegTypeIndex, lookupRegistration } from "../src/lib/logbook";
import { mkFlight } from "./fixtures";
import { Suite } from "./harness";

export function run(): Suite {
  const s = new Suite(15, "Registration lookup (logbook.ts)", "Smart tail→type fill on the flight form and quick edit.");

  const flights = [
    mkFlight("f1", { date: "2026-07-01", registration: "C-FRZR", aircraftType: "C172" }),
    mkFlight("f2", { date: "2026-07-15", registration: "C-FRZR", aircraftType: "C182" }), // newer wins
    mkFlight("f3", { date: "2026-06-01", registration: "C-GABC", aircraftType: "PA28" }),
    mkFlight("f4", { date: "2026-05-01", registration: "N123AB", aircraftType: "SR22" }),
  ];
  const idx = buildRegTypeIndex(flights);

  s.eq("FRZR short form → most recent type (C182)", lookupRegistration(idx, "FRZR")?.type, "C182");
  s.eq("FRZR resolves to the full stored reg", lookupRegistration(idx, "frzr")?.reg, "C-FRZR");
  s.eq("full C-FRZR exact match", lookupRegistration(idx, "C-FRZR")?.type, "C182");
  s.eq("hyphen-free cfrzr matches", lookupRegistration(idx, "cfrzr")?.reg, "C-FRZR");
  s.eq("unique tail suffix 23AB → N123AB", lookupRegistration(idx, "23AB")?.reg, "N123AB");
  s.check("2-char input is too short to guess", lookupRegistration(idx, "FR") === null);
  s.check("3-char input is too short to guess", lookupRegistration(idx, "FRZ") === null);
  s.check("unknown tail resolves to null", lookupRegistration(idx, "QQQQ") === null);

  // Ambiguity: two tails sharing a 4-char suffix must not resolve.
  const amb = buildRegTypeIndex([
    mkFlight("a1", { date: "2026-01-01", registration: "C-GABC", aircraftType: "PA28" }),
    mkFlight("a2", { date: "2026-01-02", registration: "X-GABC", aircraftType: "DA40" }),
  ]);
  s.check("ambiguous suffix resolves to null (no guessing)", lookupRegistration(amb, "GABC") === null);
  s.eq("exact match still resolves despite an ambiguous suffix", lookupRegistration(amb, "C-GABC")?.type, "PA28");

  // Flights with no type or no reg don't pollute the index.
  const sparse = buildRegTypeIndex([
    mkFlight("s1", { date: "2026-01-01", registration: "C-TEST", aircraftType: "" }),
    mkFlight("s2", { date: "2026-01-02", registration: "", aircraftType: "C172" }),
  ]);
  s.check("reg with no type is not indexed", lookupRegistration(sparse, "CTEST") === null);

  return s;
}
