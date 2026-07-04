// Dashboard metric registry (for the Customize panel) plus the CARs-reference
// compliance and active-duty computations. Pure functions over AppData.

import { AppData } from "./types";
import { dstr, flightDate, totalHours } from "./logbook";

export const DASH_METRICS: { section: string; items: [string, string][] }[] = [
  { section: "Flight Stats", items: [["totalTime", "Total Time"], ["currentMonth", "Current Month"], ["annualTotal", "Annual Total"], ["totalFlights", "Total Flights"]] },
  { section: "Flight Time Breakdown", items: [["pic", "PIC Hours"], ["dual", "Dual (SIC) Hours"], ["xc", "Cross Country"], ["day", "Day Hours"], ["night", "Night Hours"], ["ifr", "IFR Hours"], ["routes", "Unique Routes"]] },
  { section: "Active Duty", items: [["dailyDuty", "Daily Duty"], ["weeklyDuty", "Weekly Duty"]] },
  { section: "Panels", items: [["aircraftHours", "Hours by Aircraft Type"], ["currentPilot", "Current Pilot"], ["recentLogs", "Recent Logs"]] },
  { section: "CARs Compliance · Duty Tracker", items: [["carMonthly", "CAR 700.15 — Monthly"], ["carRest", "CAR 700.16 — Rest"]] },
];

export function isHidden(data: AppData, key: string): boolean {
  return (data.dashboardHidden || []).includes(key);
}

// Active Duty — today + trailing 7 days of recorded duty hours.
export function computeActiveDuty(data: AppData) {
  const todayKey = dstr(new Date());
  const todayEntry = data.duty[todayKey];
  const dailyHrs = todayEntry && todayEntry.hours ? +todayEntry.hours : 0;
  const dailyCap = 14;
  const dailyPct = Math.min(100, (dailyHrs / dailyCap) * 100);

  const now = new Date();
  const cutoff7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  let weeklyHrs = 0;
  Object.keys(data.duty).forEach((k) => {
    const d = new Date(k + "T00:00:00");
    if (d >= cutoff7 && d <= now) {
      const e = data.duty[k];
      if (e && e.hours) weeklyHrs += +e.hours;
    }
  });
  const weeklyCap = 60;
  const weeklyPct = Math.min(100, (weeklyHrs / weeklyCap) * 100);
  return { dailyHrs, dailyCap, dailyPct, weeklyHrs, weeklyCap, weeklyPct };
}

// CARs Part VII reference gauges.
// Monthly: rolling 28-day flight time vs 192h. Rest: smallest recorded gap
// between consecutive duty days (trailing 14 days) vs the 12h minimum.
export function computeCars(data: AppData) {
  const pid = data.currentPilotId;
  const fl = data.flights.filter((x) => !pid || x.pilotId === pid);
  const now = new Date();
  const cutoff28 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27);
  const hrs28 = fl
    .filter((x) => { const d = flightDate(x); return d >= cutoff28 && d <= now; })
    .reduce((s, x) => s + totalHours(x), 0);
  const monthlyCap = 192;
  const monthlyPct = Math.min(100, (hrs28 / monthlyCap) * 100);

  const keys = Object.keys(data.duty)
    .filter((k) => {
      const d = new Date(k + "T00:00:00");
      const diffDays = (now.getTime() - d.getTime()) / 86400000;
      return diffDays >= 0 && diffDays <= 14;
    })
    .sort();
  let minGapHrs: number | null = null;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = data.duty[keys[i]], b = data.duty[keys[i + 1]];
    if (a && a.end && b && b.start) {
      const aEnd = new Date(keys[i] + "T" + a.end);
      const bStart = new Date(keys[i + 1] + "T" + b.start);
      let gapHrs = (bStart.getTime() - aEnd.getTime()) / 3600000;
      if (gapHrs < 0) gapHrs += 24;
      if (minGapHrs === null || gapHrs < minGapHrs) minGapHrs = gapHrs;
    }
  }
  const restCap = 12;
  const restPct = minGapHrs == null ? 100 : Math.min(100, (minGapHrs / restCap) * 100);
  const restLabel = minGapHrs == null ? "No duty pairs recorded yet" : `${minGapHrs.toFixed(1)}h / ${restCap}h min rest`;

  return { hrs28, monthlyCap, monthlyPct, minGapHrs, restCap, restPct, restLabel };
}
