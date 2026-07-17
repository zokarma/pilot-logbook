// Eval #8 — dashboard duty + CARs math (src/lib/dashboard.ts).
// Reference gauges, not legal advice — but the windows and rest-gap math still
// have to be right.

import { computeActiveDuty, computeCars } from "../src/lib/dashboard";
import { Suite, approx } from "./harness";
import { mkData, mkFlight, localDateOffset } from "./fixtures";

export function run(): Suite {
  const s = new Suite(8, "Dashboard duty & CARs gauges (dashboard.ts)", "Compliance display: window boundaries and rest-gap math must not mislead.");

  // -- active duty: today + trailing 7 days --
  {
    const data = mkData({
      duty: {
        [localDateOffset(0)]: { on: true, hours: 5 },
        [localDateOffset(-6)]: { on: true, hours: 10 }, // inside the window
        [localDateOffset(-7)]: { on: true, hours: 99 }, // outside
      },
    });
    const d = computeActiveDuty(data);
    s.check("daily hours read from today's entry", d.dailyHrs === 5);
    s.check("weekly window includes day -6, excludes day -7", d.weeklyHrs === 15);
    s.check("daily % against the 14h cap", approx(d.dailyPct, (5 / 14) * 100));
  }
  {
    const d = computeActiveDuty(mkData({ duty: { [localDateOffset(0)]: { on: true, hours: 20 } } }));
    s.check("daily % clamps at 100", d.dailyPct === 100);
  }
  {
    const d = computeActiveDuty(mkData({ duty: { [localDateOffset(0)]: { on: true, start: "08:00", end: "16:00" } } }));
    s.probe("duty entry with start/end but no hours", `contributes ${d.dailyHrs}h — hours are never derived from the start/end pair, so a pilot who logs times but not the total sees an empty gauge.`);
  }

  // -- CARs monthly: rolling 28 days, scoped to the current pilot --
  {
    const data = mkData({
      currentPilotId: "me",
      flights: [
        mkFlight("in", { date: localDateOffset(-27), se: 2.0, pilotId: "me" }),
        mkFlight("out", { date: localDateOffset(-28), se: 5.0, pilotId: "me" }),
        mkFlight("theirs", { date: localDateOffset(-5), se: 9.0, pilotId: "them" }),
      ],
    });
    const c = computeCars(data);
    s.check("28-day window includes day -27, excludes day -28", approx(c.hrs28, 2.0));
    s.check("another pilot's flights are excluded", c.hrs28 < 9);
  }

  // -- CARs rest: smallest gap between consecutive duty days --
  {
    const c = computeCars(mkData({
      duty: {
        [localDateOffset(-2)]: { on: true, start: "08:00", end: "22:00" },
        [localDateOffset(-1)]: { on: true, start: "08:00", end: "16:00" },
      },
    }));
    s.check("22:00 → next-day 08:00 is a 10h rest gap", c.minGapHrs !== null && approx(c.minGapHrs, 10));
    s.check("rest % against the 12h floor", approx(c.restPct, (10 / 12) * 100));
  }
  {
    const c = computeCars(mkData({
      duty: {
        [localDateOffset(-4)]: { on: true, start: "20:00", end: "02:00" }, // past midnight
        [localDateOffset(-3)]: { on: true, start: "12:00", end: "18:00" },
      },
    }));
    s.check("overnight duty rolls its end to the next day (gap 10h, not 34h)", c.minGapHrs !== null && approx(c.minGapHrs, 10));
  }
  {
    const c = computeCars(mkData({
      duty: {
        [localDateOffset(-4)]: { on: true, start: "22:00", end: "02:00" }, // ends 02:00 on day -3
        [localDateOffset(-3)]: { on: true, start: "01:00", end: "09:00" }, // overlaps: negative gap
      },
    }));
    s.check("overlapping entries are skipped, not reported as negative rest", c.minGapHrs === null);
  }
  {
    const c = computeCars(mkData());
    s.check("no duty pairs → gauge full, honest label", c.restPct === 100 && /no duty pairs/i.test(c.restLabel));
  }

  s.probe(
    "gauges are advisory only",
    "CAR 700.15/700.16 gauges use fixed caps (192h/28d, 12h rest) with no operation-type nuance (703/704/705 differ); labels present them as reference values, which matches the intent.",
  );

  return s;
}
