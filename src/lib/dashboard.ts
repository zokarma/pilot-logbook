// Dashboard metric registry (for the Customize panel) plus the CARs-reference
// compliance and active-duty computations. Pure functions over AppData.

import { AppData } from "./types";
import { dstr, flightDate, totalHours } from "./logbook";
import { effectiveLimits } from "./dutyLimits";

export const DASH_METRICS: { section: string; items: [string, string][] }[] = [
  { section: "Flight Stats", items: [["totalTime", "Total Time"], ["currentMonth", "Current Month"], ["annualTotal", "Annual Total"], ["totalFlights", "Total Flights"]] },
  { section: "Flight Time Breakdown", items: [["pic", "PIC Hours"], ["dual", "Dual (SIC) Hours"], ["xc", "Cross Country"], ["day", "Day Hours"], ["night", "Night Hours"], ["ifr", "IFR Hours"], ["routes", "Unique Routes"]] },
  { section: "Active Duty", items: [["dailyDuty", "Daily Duty"], ["weeklyDuty", "Weekly Duty"]] },
  { section: "Documents", items: [["documentStatus", "Document Status"]] },
  { section: "Panels", items: [["aircraftHours", "Hours by Aircraft Type"], ["currentPilot", "Current Pilot"], ["recentLogs", "Recent Logs"]] },
  { section: "CARs Compliance · Duty Tracker", items: [["carMonthly", "Flight Time (28-day)"], ["carRest", "Min Rest"]] },
];

export function isHidden(data: AppData, key: string): boolean {
  return (data.dashboardHidden || []).includes(key);
}

// Active Duty — today + trailing 7 days of recorded duty hours.
export function computeActiveDuty(data: AppData) {
  const limits = effectiveLimits(data.profile);
  const todayKey = dstr(new Date());
  const todayEntry = data.duty[todayKey];
  const dailyHrs = todayEntry && todayEntry.hours ? +todayEntry.hours : 0;
  const dailyCap = limits.fdpDailyMax; // FDP ceiling for the selected operation
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
  const weeklyCap = limits.duty7Day;
  const weeklyPct = Math.min(100, (weeklyHrs / weeklyCap) * 100);
  return { dailyHrs, dailyCap, dailyPct, weeklyHrs, weeklyCap, weeklyPct, operation: limits.label };
}

// CARs Part VII reference gauges, using the limit set for the pilot's operation.
// Monthly: rolling 28-day flight time vs that operation's cap. Rest: smallest
// recorded gap between consecutive duty days (trailing 14 days) vs the minimum.
export function computeCars(data: AppData) {
  const limits = effectiveLimits(data.profile);
  const pid = data.currentPilotId;
  const fl = data.flights.filter((x) => !pid || x.pilotId === pid);
  const now = new Date();
  const cutoff28 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 27);
  const hrs28 = fl
    .filter((x) => { const d = flightDate(x); return d >= cutoff28 && d <= now; })
    .reduce((s, x) => s + totalHours(x), 0);
  const monthlyCap = limits.flightTime28; // 28-day flight-time limit for the operation
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
      // An end time earlier than the start time means the duty ran past
      // midnight, so it actually ended the following day.
      if (a.start && a.end < a.start) aEnd.setDate(aEnd.getDate() + 1);
      const bStart = new Date(keys[i + 1] + "T" + b.start);
      const gapHrs = (bStart.getTime() - aEnd.getTime()) / 3600000;
      // Overlapping/inconsistent entries yield a negative gap — no meaningful
      // rest period can be derived from them, so skip rather than wrap.
      if (gapHrs < 0) continue;
      if (minGapHrs === null || gapHrs < minGapHrs) minGapHrs = gapHrs;
    }
  }
  const restCap = limits.minRestHome;
  const restPct = minGapHrs == null ? 100 : Math.min(100, (minGapHrs / restCap) * 100);
  const restLabel = minGapHrs == null ? "No duty pairs recorded yet" : `${minGapHrs.toFixed(1)}h / ${restCap}h min rest`;

  return { hrs28, monthlyCap, monthlyPct, minGapHrs, restCap, restPct, restLabel, operation: limits.label };
}
