// Eval #7 — id minting + flight mirror invariants (src/lib/id.ts, logbook.ts).
// The quiet plumbing every other feature leans on.

import { uid } from "../src/lib/id";
import { num, syncFlightMirrors, flightDateStr, flightDate, flightsForCurrentPilot, totalHours } from "../src/lib/logbook";
import { Flight } from "../src/lib/types";
import { Suite } from "./harness";
import { mkData, mkFlight, mkPilot } from "./fixtures";

export function run(): Suite {
  const s = new Suite(10, "IDs & flight mirrors (id.ts, logbook.ts)", "Duplicate ids or drifting CSV mirrors silently corrupt references everywhere else.");

  // -- id uniqueness under bulk-import pressure --
  {
    const n = 200_000;
    const seen = new Set<string>();
    let prefixOk = true;
    for (let i = 0; i < n; i++) {
      const id = uid("f");
      if (!id.startsWith("f")) prefixOk = false;
      seen.add(id);
    }
    s.check(`uid: ${n.toLocaleString()} ids in a tight loop, zero collisions`, seen.size === n);
    s.check("uid: prefix respected", prefixOk);
  }

  // -- numeric coercion --
  s.check("num parses decimals and defaults garbage to 0", num("1.5") === 1.5 && num("") === 0 && num("abc") === 0 && num(undefined) === 0);
  s.check("totalHours = se + me", totalHours(mkFlight("f", { se: 1.2, me: 0.8 })) === 2);

  // -- mirror re-derivation --
  {
    const data = mkData({ pilots: [mkPilot("ben", "Ben", "Pearce"), mkPilot("zoe", "Zoe", "Karmali")] });
    const fl = mkFlight("f1", {
      date: "2026-07-05",
      registration: " c-gabc ",
      from: "cynj",
      to: "cypk",
      picId: "ben",
      sicId: "zoe",
      socId: "",
      pic: "STALE", sic: "STALE", soc: "STALE",
      civilIdent: "STALE", year: 1999, month: 1, day: 1,
    });
    syncFlightMirrors(data, fl);
    s.check("year/month/day mirrors re-derived from date", fl.year === 2026 && fl.month === 7 && fl.day === 5);
    s.check("registration trimmed + uppercased, civilIdent mirrored", fl.registration === "C-GABC" && fl.civilIdent === "C-GABC");
    s.check("route uppercased", fl.from === "CYNJ" && fl.to === "CYPK");
    s.check("crew text mirrors re-derived from ids", fl.pic === "Ben Pearce" && fl.sic === "Zoe Karmali" && fl.soc === "");
    s.check("edit stamps updated_at for sync conflict resolution", !!fl.updated_at && !isNaN(Date.parse(fl.updated_at)));
  }

  // -- legacy date fallbacks --
  s.check("flightDateStr falls back to year/month/day", flightDateStr({ year: 2019, month: 3, day: 7 } as unknown as Flight) === "2019-03-07");
  s.check("flightDate of a dateless flight is the epoch (sorts last)", flightDate({} as unknown as Flight).getTime() === 0);

  // -- per-pilot view --
  {
    const data = mkData({
      currentPilotId: "me",
      flights: [
        mkFlight("old", { date: "2026-01-01", pilotId: "me" }),
        mkFlight("new", { date: "2026-07-01", pilotId: "me" }),
        mkFlight("other", { date: "2026-06-01", pilotId: "them" }),
      ],
    });
    const mine = flightsForCurrentPilot(data);
    s.check("flightsForCurrentPilot filters to the owner, newest first", mine.length === 2 && mine[0].id === "new" && mine[1].id === "old");
  }

  return s;
}
