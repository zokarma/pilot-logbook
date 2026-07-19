// Transport Canada flight & duty time limits by operation type (CARs Part VII,
// Subpart 700 — the fatigue-management rules in force for 705 since Dec 2020 and
// 703/704 since Dec 2022). Pure data + lookup; the gauges in dashboard.ts read
// the set matching the pilot's selected operation (UserProfile.carsSubpart).
//
// NOTE: the maximum Flight Duty Period is really a sliding scale (roughly 9–13h)
// that depends on report time and number of flight segments; `fdpDailyMax` is
// the ceiling of that scale, used as a single-number gauge cap.

export type OperationType = "703" | "704" | "705";

export interface DutyLimits {
  label: string;
  // Flight time (actual air time), hours
  flightTime28: number;
  flightTime90: number;
  flightTime365: number;
  // Duty
  fdpDailyMax: number;   // ceiling of the FDP sliding scale
  duty7Day: number;      // default hours in any 7 consecutive days (conservative)
  duty7DayOptions: number[]; // 60 or 70, depending on the operator's approved schedule
  duty28Day: number;     // hours in any 28 consecutive days (192 across 703/704/705)
  duty365: number;       // hours in any 365 consecutive days
  singlePilot24?: number; // max flight time in 24h for single-pilot ops (703/704)
  // Minimum rest before a flight duty period
  minRestHome: number;
  minRestAway: number;
  // Reference-only rules (time free from duty, FDP extensions). Shown as a
  // cheat sheet — deliberately not computed, since the inputs (report time,
  // segment count, breaks) aren't captured on a duty entry.
  notes: string[];
}

// Maximum Flight Duty Period sliding scale — set by report time and number of
// flight segments, for flights averaging 50 minutes or more. Reference only.
export interface FdpRow {
  start: string;
  legs1to4: number;
  legs5to6: number;
  legs7plus: number;
  mostRestrictive?: boolean; // highlight the lowest-FDP bracket
}

export const FDP_TABLE: FdpRow[] = [
  { start: "07:00–12:59", legs1to4: 13, legs5to6: 12, legs7plus: 11 },
  { start: "13:00–16:59", legs1to4: 12.5, legs5to6: 11.5, legs7plus: 10.5 },
  { start: "17:00–21:59", legs1to4: 12, legs5to6: 11, legs7plus: 10 },
  { start: "22:00–22:59", legs1to4: 11, legs5to6: 10, legs7plus: 9 },
  { start: "23:00–03:59", legs1to4: 9, legs5to6: 9, legs7plus: 9, mostRestrictive: true },
  { start: "04:00–04:59", legs1to4: 10, legs5to6: 9, legs7plus: 9 },
  { start: "05:00–05:59", legs1to4: 11, legs5to6: 10, legs7plus: 9 },
  { start: "06:00–06:59", legs1to4: 12, legs5to6: 11, legs7plus: 10 },
];

// The modern fatigue rules are ONE unified division (CARs 700.26–700.72) that
// applies to 703, 704 and 705 alike, so the reference notes are shared. Each
// item is verified against the regulation text (section cited).
const UNIFIED_NOTES: string[] = [
  "60h/7-day option requires 1 single day free from duty in any 7 days and 4 single days free in any 28 days. [700.29]",
  "70h/7-day option requires 120 consecutive hours free from duty, including 5 consecutive local nights' rest, in any 21 days, plus added duty restrictions. [700.29]",
  "Split duty: a break of at least 60 consecutive minutes in suitable accommodation (first 45 minutes don't count) extends the max FDP by 50% of the break — 100% if the break falls between 00:00 and 05:59. Extended FDPs are limited to 3 consecutive night duty periods. [700.50]",
  "Unforeseen operational circumstances: the FDP may be extended by up to 1h single-pilot, 2h unaugmented crew, or 3h augmented on a single-flight FDP; the next rest period increases by at least the extension. [700.63]",
  "Reserve availability period: 14 consecutive hours maximum. [700.70]",
  "Minimum rest is 12h at home base (or 11h plus travel time to accommodation) and 10h in suitable accommodation away from base.",
];

export const DUTY_LIMITS: Record<OperationType, DutyLimits> = {
  "705": {
    label: "705 — Airline",
    flightTime28: 112, flightTime90: 300, flightTime365: 1000,
    fdpDailyMax: 13, duty7Day: 60, duty7DayOptions: [60, 70], duty28Day: 192, duty365: 2200,
    minRestHome: 12, minRestAway: 10,
    notes: UNIFIED_NOTES,
  },
  "704": {
    label: "704 — Commuter",
    flightTime28: 112, flightTime90: 300, flightTime365: 1000,
    fdpDailyMax: 13, duty7Day: 60, duty7DayOptions: [60, 70], duty28Day: 192, duty365: 2200,
    singlePilot24: 8,
    minRestHome: 12, minRestAway: 10,
    notes: UNIFIED_NOTES,
  },
  "703": {
    label: "703 — Air Taxi",
    flightTime28: 112, flightTime90: 300, flightTime365: 1000,
    fdpDailyMax: 13, duty7Day: 60, duty7DayOptions: [60, 70], duty28Day: 192, duty365: 2200,
    singlePilot24: 8,
    minRestHome: 12, minRestAway: 10,
    notes: UNIFIED_NOTES,
  },
};

// Operation types offered in the picker.
export const OPERATION_TYPES: OperationType[] = ["705", "704", "703"];

export const DEFAULT_OPERATION: OperationType = "705";

// Resolve a stored (possibly undefined/legacy) operation code to a limit set.
export function operationLimits(op?: string): DutyLimits {
  return DUTY_LIMITS[op as OperationType] ?? DUTY_LIMITS[DEFAULT_OPERATION];
}

// The limit set actually in force for a pilot: their operation's table with the
// 7-day work limit swapped to whichever schedule option their operator is
// approved for (60 or 70 hours). Falls back to the conservative default.
export function effectiveLimits(
  profile?: { carsSubpart?: string; duty7DayOption?: number } | null,
): DutyLimits {
  const base = operationLimits(profile?.carsSubpart);
  const choice = profile?.duty7DayOption;
  return choice && base.duty7DayOptions.includes(choice)
    ? { ...base, duty7Day: choice }
    : base;
}
