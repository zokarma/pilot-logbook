// Eval #11 — currency/recency math (src/lib/currency.ts).
// Wrong currency answers tell a pilot they may legally carry passengers or
// fly IFR when they may not — window boundaries and lapse dates must be exact.

import {
  builtinCurrencyStatuses, customCurrencyStatuses, metricAmount, flightLandings,
  monthsAgo, daysAgo,
} from "../src/lib/currency";
import { dstr } from "../src/lib/logbook";
import { CurrencyRule, Flight } from "../src/lib/types";
import { Suite } from "./harness";
import { mkData, mkFlight } from "./fixtures";

const today = new Date();
const d = (date: Date) => dstr(date);

const rule = (over: Partial<CurrencyRule>): CurrencyRule => ({
  id: "r1", name: "", metric: "landings", threshold: 3, windowDays: 90,
  createdAt: "2026-01-01T00:00:00.000Z", ...over,
});

export function run(): Suite {
  const s = new Suite(11, "Currency math (currency.ts)", "Recency gauges must not overstate currency — legal exposure if wrong.");

  // -- legacy defaults --
  s.check("a flight without a landings count is 1 landing", flightLandings(mkFlight("f")) === 1);
  s.check("a recorded landings count is used", flightLandings(mkFlight("f", { landings: 3 })) === 3);
  s.check("approaches default to 0", metricAmount(mkFlight("f"), "approaches") === 0);
  s.check("night landing classified by the landing field", metricAmount(mkFlight("f", { landing: "Night", landings: 2 }), "nightLandings") === 2);
  s.check("day landing contributes nothing to night", metricAmount(mkFlight("f", { landing: "Day" }), "nightLandings") === 0);
  s.check("night takeoff classified independently of landing", metricAmount(mkFlight("f", { takeoff: "Night", landing: "Day" }), "nightTakeoffs") === 1);
  s.check("instrument hours = actual + sim", metricAmount(mkFlight("f", { ifrActual: 1.0, ifrSim: 0.5 }), "ifrHours") === 1.5);

  // -- TC day passenger recency: 5 TO + 5 ldg in 6 months --
  {
    const data = mkData({
      flights: [mkFlight("f1", { date: d(daysAgo(today, 10)), landings: 5 })],
    });
    const day = builtinCurrencyStatuses(data, today).find((x) => x.key === "tc-day-pax")!;
    s.check("5 landings 10 days ago → day-passenger current", day.ok);
    s.check("lapse date = event date + 6 months", day.lapsesOn === d(monthsAgo(new Date(today.getFullYear(), today.getMonth() + 6, today.getDate() - 10), 0)) || day.lapsesOn === d(new Date(today.getFullYear(), today.getMonth() + 6, today.getDate() - 10)));
  }
  {
    const data = mkData({
      flights: [mkFlight("f1", { date: d(daysAgo(today, 10)), landings: 4 })],
    });
    const day = builtinCurrencyStatuses(data, today).find((x) => x.key === "tc-day-pax")!;
    s.check("4 landings → NOT current, value reported", !day.ok && day.components[1].value === 4);
    s.check("not-current rules carry no lapse date", day.lapsesOn === null);
  }

  // -- 6-month window boundary (calendar months) --
  {
    const onBoundary = mkData({ flights: [mkFlight("f1", { date: d(monthsAgo(today, 6)), landings: 5 })] });
    const outside = mkData({ flights: [mkFlight("f1", { date: d(daysAgo(monthsAgo(today, 6), 1)), landings: 5 })] });
    s.check("a flight exactly 6 months ago still counts", builtinCurrencyStatuses(onBoundary, today)[0].ok);
    s.check("a flight 6 months + 1 day ago does not", !builtinCurrencyStatuses(outside, today)[0].ok);
  }

  // -- lapse walks to the threshold-crossing event --
  {
    const data = mkData({
      flights: [
        mkFlight("new", { date: d(daysAgo(today, 5)), landings: 2 }),
        mkFlight("mid", { date: d(daysAgo(today, 30)), landings: 2 }),
        mkFlight("old", { date: d(daysAgo(today, 60)), landings: 2 }),
      ],
    });
    const day = builtinCurrencyStatuses(data, today).find((x) => x.key === "tc-day-pax")!;
    // 2+2+2 = 6 ≥ 5: the 5th-most-recent landing sits on the OLDEST flight, so
    // currency lapses when that flight leaves the window.
    const oldPlus6mo = new Date(today.getFullYear(), today.getMonth() + 6, today.getDate() - 60);
    s.check("lapse anchored to the flight carrying the 5th landing", day.ok && day.lapsesOn === d(oldPlus6mo));
  }

  // -- night variant is independent of day --
  {
    const data = mkData({
      flights: [
        mkFlight("day", { date: d(daysAgo(today, 5)), landings: 5, takeoff: "Day", landing: "Day" }),
        mkFlight("night", { date: d(daysAgo(today, 5)), landings: 2, takeoff: "Night", landing: "Night" }),
      ],
    });
    const st = builtinCurrencyStatuses(data, today);
    s.check("day passengers current, night not (2 of 5 night)", st[0].ok && !st[1].ok);
  }

  // -- IFR is composite: hours AND approaches --
  {
    const hoursOnly = mkData({ flights: [mkFlight("f1", { date: d(daysAgo(today, 5)), ifrActual: 6, approaches: 0 })] });
    const both = mkData({ flights: [mkFlight("f1", { date: d(daysAgo(today, 5)), ifrActual: 4, ifrSim: 2, approaches: 6 })] });
    const a = builtinCurrencyStatuses(hoursOnly, today).find((x) => x.key === "tc-ifr")!;
    const b = builtinCurrencyStatuses(both, today).find((x) => x.key === "tc-ifr")!;
    s.check("6 IFR hours without approaches is NOT current", !a.ok && a.components[1].value === 0);
    s.check("6 hours (actual+sim) + 6 approaches IS current", b.ok);
  }

  // -- pilot scoping + future flights --
  {
    const data = mkData({
      currentPilotId: "me",
      flights: [
        mkFlight("mine", { date: d(daysAgo(today, 5)), landings: 3, pilotId: "me" }),
        mkFlight("theirs", { date: d(daysAgo(today, 5)), landings: 9, pilotId: "them" }),
        mkFlight("future", { date: d(daysAgo(today, -10)), landings: 9, pilotId: "me" }),
      ],
    });
    const day = builtinCurrencyStatuses(data, today).find((x) => x.key === "tc-day-pax")!;
    s.check("another pilot's flights don't count toward my currency", day.components[1].value === 3);
    s.check("future-dated flights are excluded", !day.ok);
  }

  // -- custom rules: day windows + aircraft scope --
  {
    const data = mkData({
      currencyRules: [rule({ id: "r1", threshold: 3, windowDays: 90, aircraftType: "C172" })],
      flights: [
        mkFlight("a", { date: d(daysAgo(today, 10)), landings: 2, aircraftType: "C172" }),
        mkFlight("b", { date: d(daysAgo(today, 20)), landings: 1, aircraftType: "c 172" }),
        mkFlight("c", { date: d(daysAgo(today, 5)), landings: 9, aircraftType: "PA28" }),
      ],
    });
    const [st] = customCurrencyStatuses(data, today);
    s.check("aircraft scope matches by normalized code, other types ignored", st.ok && st.components[0].value === 3);
  }
  {
    const data = mkData({
      currencyRules: [rule({ id: "r2", metric: "landings", threshold: 3, windowDays: 90 })],
      flights: [
        mkFlight("in", { date: d(daysAgo(today, 90)), landings: 3 }),
        mkFlight("out", { date: d(daysAgo(today, 91)), landings: 9 }),
      ],
    });
    const [st] = customCurrencyStatuses(data, today);
    s.check("day-window boundary: day 90 counts, day 91 doesn't", st.ok && st.components[0].value === 3);
    s.check("custom lapse = event + windowDays", st.lapsesOn === d(daysAgo(today, 0)));
  }
  {
    const data = mkData({
      currencyRules: [rule({ id: "r3", metric: "not-a-metric", threshold: 2, windowDays: 30 })],
      flights: [mkFlight("a", { date: d(daysAgo(today, 3)) }), mkFlight("b", { date: d(daysAgo(today, 4)) })],
    });
    const [st] = customCurrencyStatuses(data, today);
    s.check("an unknown metric degrades to counting flights (never crashes)", st.ok && st.components[0].value === 2);
  }

  // -- empty logbook --
  {
    const st = builtinCurrencyStatuses(mkData(), today);
    s.check("empty logbook: everything honestly NOT current", st.every((x) => !x.ok && x.lapsesOn === null));
  }

  s.probe(
    "simplifications",
    "takeoffs are assumed equal to landings (no separate takeoff count field); a flight's landings all share its day/night classification; the CARs category/class split and sim-credit rules are not modeled. All gauges are labeled 'reference only'.",
  );

  return s;
}
