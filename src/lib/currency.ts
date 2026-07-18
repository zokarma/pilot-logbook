// Recency / currency math — Transport Canada built-ins plus user-defined
// rules (AppData.currencyRules). Pure and framework-free like the rest of
// src/lib: everything is derived from the flights/documents passed in.
//
// REFERENCE ONLY: these gauges simplify the CARs (no category/class split,
// no sim credit rules, etc.). The pilot remains responsible for their own
// currency — the UI labels them accordingly.
//
// Data model notes:
// - A flight without a `landings` count is ONE takeoff + ONE landing,
//   classified day/night by its takeoff/landing fields. With a count, all of
//   that flight's takeoffs/landings share the flight's day/night classification
//   (logbooks rarely split a single row across day and night circuits).
// - `approaches` (instrument approaches) defaults to 0.

import { AppData, CurrencyRule, Flight } from "./types";
import { flightDate, dstr, totalHours, ifrHours } from "./logbook";
import { normalizeAircraftCode } from "./aircraft";

export type CurrencyMetric =
  | "takeoffs" | "landings" | "nightTakeoffs" | "nightLandings"
  | "hours" | "nightHours" | "ifrHours" | "approaches" | "xcHours" | "flights";

export const METRIC_LABELS: Record<CurrencyMetric, string> = {
  takeoffs: "Takeoffs",
  landings: "Landings",
  nightTakeoffs: "Night takeoffs",
  nightLandings: "Night landings",
  hours: "Flight hours",
  nightHours: "Night hours",
  ifrHours: "Instrument hours",
  approaches: "Instrument approaches",
  xcHours: "Cross-country hours",
  flights: "Flights",
};

export const CURRENCY_METRICS = Object.keys(METRIC_LABELS) as CurrencyMetric[];

// Landings recorded on the flight (default 1); takeoffs are assumed equal.
export function flightLandings(fl: Flight): number {
  const n = typeof fl.landings === "number" && isFinite(fl.landings) ? fl.landings : NaN;
  return isNaN(n) ? 1 : Math.max(0, n);
}

export function flightApproaches(fl: Flight): number {
  const n = typeof fl.approaches === "number" && isFinite(fl.approaches) ? fl.approaches : NaN;
  return isNaN(n) ? 0 : Math.max(0, n);
}

// How much a single flight contributes to a metric.
export function metricAmount(fl: Flight, metric: CurrencyMetric): number {
  switch (metric) {
    case "takeoffs": return flightLandings(fl);
    case "landings": return flightLandings(fl);
    case "nightTakeoffs": return fl.takeoff === "Night" ? flightLandings(fl) : 0;
    case "nightLandings": return fl.landing === "Night" ? flightLandings(fl) : 0;
    case "hours": return totalHours(fl);
    case "nightHours": return fl.nightHours || 0;
    case "ifrHours": return ifrHours(fl);
    case "approaches": return flightApproaches(fl);
    case "xcHours": return fl.xc || 0;
    case "flights": return 1;
  }
}

/* ------------------------------ windows ------------------------------ */

export function daysAgo(today: Date, days: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
}

// "Within the previous N months" — calendar months, local time.
export function monthsAgo(today: Date, months: number): Date {
  return new Date(today.getFullYear(), today.getMonth() - months, today.getDate());
}

type Window = { kind: "months"; months: number } | { kind: "days"; days: number };

function windowStart(today: Date, w: Window): Date {
  return w.kind === "months" ? monthsAgo(today, w.months) : daysAgo(today, w.days);
}

function windowEnd(eventDate: Date, w: Window): Date {
  // The day the window that opened at `eventDate` closes: the event stops
  // counting once `today - window` passes it.
  return w.kind === "months"
    ? new Date(eventDate.getFullYear(), eventDate.getMonth() + w.months, eventDate.getDate())
    : new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate() + w.days);
}

/* ------------------------------ evaluation ------------------------------ */

export interface ComponentStatus {
  metric: CurrencyMetric;
  label: string;
  threshold: number;
  value: number;
  ok: boolean;
  // The date this component stops being satisfied if nothing new is logged
  // ("YYYY-MM-DD"), or null when it isn't currently satisfied.
  lapsesOn: string | null;
}

export interface CurrencyStatus {
  key: string;
  name: string;
  regRef?: string; // e.g. "CAR 401.05(1)" — shown as a reference, not advice
  ok: boolean;
  components: ComponentStatus[];
  lapsesOn: string | null; // earliest component lapse when ok, else null
}

function evalComponent(
  flights: Flight[],
  metric: CurrencyMetric,
  threshold: number,
  w: Window,
  today: Date,
): ComponentStatus {
  const start = windowStart(today, w);
  const events = flights
    .map((fl) => ({ date: flightDate(fl), amount: metricAmount(fl, metric) }))
    .filter((e) => e.amount > 0 && e.date >= start && e.date <= today)
    .sort((a, b) => b.date.getTime() - a.date.getTime()); // newest first

  const value = events.reduce((s, e) => s + e.amount, 0);
  const ok = value >= threshold;

  // The requirement stays satisfied until the event that carries the
  // threshold-crossing unit falls out of the window: walk newest→oldest until
  // the accumulated amount reaches the threshold.
  let lapsesOn: string | null = null;
  if (ok && threshold > 0) {
    let acc = 0;
    for (const e of events) {
      acc += e.amount;
      if (acc >= threshold) { lapsesOn = dstr(windowEnd(e.date, w)); break; }
    }
  } else if (ok) {
    lapsesOn = null; // threshold 0 never lapses
  }

  return { metric, label: METRIC_LABELS[metric], threshold, value: round1(value), ok, lapsesOn };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function combine(key: string, name: string, regRef: string | undefined, comps: ComponentStatus[]): CurrencyStatus {
  const ok = comps.every((c) => c.ok);
  let lapsesOn: string | null = null;
  if (ok) {
    for (const c of comps) {
      if (c.lapsesOn && (!lapsesOn || c.lapsesOn < lapsesOn)) lapsesOn = c.lapsesOn;
    }
  }
  return { key, name, regRef, ok, components: comps, lapsesOn };
}

// Flights that belong to the currently selected pilot (currency is personal).
export function currencyFlights(data: AppData): Flight[] {
  const pid = data.currentPilotId;
  return data.flights.filter((f) => !pid || f.pilotId === pid);
}

// The Transport Canada reference set.
export function builtinCurrencyStatuses(data: AppData, today: Date = new Date()): CurrencyStatus[] {
  const fl = currencyFlights(data);
  const six: Window = { kind: "months", months: 6 };
  return [
    combine("tc-day-pax", "Passenger carrying — day", "CAR 401.05(1)", [
      evalComponent(fl, "takeoffs", 5, six, today),
      evalComponent(fl, "landings", 5, six, today),
    ]),
    combine("tc-night-pax", "Passenger carrying — night", "CAR 401.05(1)", [
      evalComponent(fl, "nightTakeoffs", 5, six, today),
      evalComponent(fl, "nightLandings", 5, six, today),
    ]),
    combine("tc-ifr", "IFR", "CAR 401.05(3)", [
      evalComponent(fl, "ifrHours", 6, six, today),
      evalComponent(fl, "approaches", 6, six, today),
    ]),
  ];
}

// User-defined rules (day-based windows, optional aircraft-type scope).
export function customCurrencyStatuses(data: AppData, today: Date = new Date()): CurrencyStatus[] {
  const all = currencyFlights(data);
  return (data.currencyRules ?? []).map((rule: CurrencyRule) => {
    const scope = rule.aircraftType ? normalizeAircraftCode(rule.aircraftType) : "";
    const fl = scope ? all.filter((f) => normalizeAircraftCode(f.aircraftType) === scope) : all;
    const metric = (CURRENCY_METRICS as string[]).includes(rule.metric)
      ? (rule.metric as CurrencyMetric)
      : "flights";
    const comp = evalComponent(fl, metric, rule.threshold, { kind: "days", days: rule.windowDays }, today);
    const scopeLabel = rule.aircraftType ? ` on ${scope}` : "";
    return combine(rule.id, rule.name || `${rule.threshold} ${METRIC_LABELS[metric].toLowerCase()}${scopeLabel} / ${rule.windowDays}d`, undefined, [comp]);
  });
}
