// Eval #8 — dashboard duty + CARs math (src/lib/dashboard.ts).
// Reference gauges, not legal advice — but the windows and rest-gap math still
// have to be right.

import {
  computeActiveDuty, computeCars,
  isDashboardPreview, PREVIEW_PRIMARY, PREVIEW_SECONDARY,
} from "../src/lib/dashboard";
import { Suite, approx } from "./harness";
import { mkData, mkFlight, localDateOffset } from "./fixtures";

export function run(): Suite {
  const s = new Suite(12, "Dashboard duty & CARs gauges (dashboard.ts)", "Compliance display: window boundaries and rest-gap math must not mislead.");

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
    // Default (no profile op) → 705 limits: FDP ceiling 13, 7-day 60.
    s.check("daily % against the default 705 FDP cap (13h)", approx(d.dailyPct, (5 / 13) * 100) && d.dailyCap === 13);
    s.check("weekly cap is the operation's 7-day limit (60h default)", d.weeklyCap === 60);
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

  // -- gauges now follow the pilot's CARs operation type (dutyLimits.ts) --
  {
    const flights = [mkFlight("f", { date: localDateOffset(-1), se: 5, pilotId: "me" })];
    const base = { firstName: "Z", lastName: "K", role: "Captain", onboarded: true } as const;
    const c703 = computeCars(mkData({ currentPilotId: "me", flights, profile: { ...base, carsSubpart: "703" } }));
    const c705 = computeCars(mkData({ currentPilotId: "me", flights, profile: { ...base, carsSubpart: "705" } }));
    s.check("28-day flight-time cap follows operation (all currently 112h)", c703.monthlyCap === 112 && c705.monthlyCap === 112);
    s.check("operation label surfaced for the gauge", /703/.test(c703.operation) && /705/.test(c705.operation));

    const d70 = computeActiveDuty(mkData({ duty: { [localDateOffset(0)]: { on: true, hours: 5 } }, profile: { ...base, carsSubpart: "705", duty7DayOption: 70 } }));
    s.check("selected 7-day option (70h) drives the weekly cap", d70.weeklyCap === 70);
    const dBad = computeActiveDuty(mkData({ duty: {}, profile: { ...base, carsSubpart: "705", duty7DayOption: 99 } }));
    s.check("an unapproved 7-day option falls back to the default (60h)", dBad.weeklyCap === 60);
  }

  s.probe(
    "gauges are advisory only",
    "Caps now come from the pilot's CARs operation (703/704/705) via dutyLimits.ts, defaulting to the conservative 705 set; FDP is capped at the sliding-scale ceiling (13h). Labels still present them as reference values.",
  );

  /* ---------------- empty-dashboard preview ---------------- */
  // A logbook is a legal record, so the "don't show a wall of zeros" treatment
  // must stay purely cosmetic: example figures on screen, never sample flights
  // written into the pilot's data where they could reach a CSV or PDF export.
  {
    const empty = mkData();
    s.check("preview is on when the pilot has logged nothing", isDashboardPreview(empty));

    const withFlight = mkData({ flights: [mkFlight("f1", { se: 1.2 })] });
    s.check("preview switches off with the first real flight", !isDashboardPreview(withFlight));

    // Scoped to the CURRENT pilot: another pilot's flights must not suppress it.
    const otherPilot = mkData({ currentPilotId: "me", flights: [mkFlight("f1", { pilotId: "them", se: 2 })] });
    s.check("another pilot's flights don't count as yours", isDashboardPreview(otherPilot));

    // The preview must not mutate anything.
    const before = JSON.stringify(empty);
    isDashboardPreview(empty);
    s.check("checking preview state never mutates the logbook", JSON.stringify(empty) === before);
    s.check("no sample flight is ever created for the preview", empty.flights.length === 0);

    // Values are display strings only — nothing numeric that could be summed
    // into a total by mistake.
    const vals = [...Object.values(PREVIEW_PRIMARY), ...Object.values(PREVIEW_SECONDARY)];
    s.check("preview figures are display strings", vals.length > 0 && vals.every((v) => typeof v === "string" && v.length > 0));
    s.check("preview covers every primary stat", ["totalTime", "currentMonth", "annualTotal", "totalFlights"].every((k) => !!PREVIEW_PRIMARY[k]));
  }

  return s;
}
