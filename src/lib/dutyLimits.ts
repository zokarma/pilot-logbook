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
  duty28Day?: number;    // hours in any 28 days (704 = 192; 705 uses the annual cap)
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
  wocl?: boolean;
}

export const FDP_TABLE: FdpRow[] = [
  { start: "07:00–12:59", legs1to4: 13, legs5to6: 12, legs7plus: 11 },
  { start: "13:00–16:59", legs1to4: 12.5, legs5to6: 11.5, legs7plus: 10.5 },
  { start: "17:00–21:59", legs1to4: 12, legs5to6: 11, legs7plus: 10 },
  { start: "22:00–22:59", legs1to4: 11, legs5to6: 10, legs7plus: 9 },
  { start: "23:00–03:59", legs1to4: 9, legs5to6: 9, legs7plus: 9, wocl: true },
  { start: "04:00–04:59", legs1to4: 10, legs5to6: 9, legs7plus: 9 },
  { start: "05:00–05:59", legs1to4: 11, legs5to6: 10, legs7plus: 9 },
  { start: "06:00–06:59", legs1to4: 12, legs5to6: 11, legs7plus: 10 },
];

export const DUTY_LIMITS: Record<OperationType, DutyLimits> = {
  "705": {
    label: "705 — Airline",
    flightTime28: 112, flightTime90: 300, flightTime365: 1000,
    fdpDailyMax: 13, duty7Day: 60, duty7DayOptions: [60, 70], duty365: 2200,
    minRestHome: 12, minRestAway: 10,
    notes: [
      "36 consecutive hours free from duty every 7 days.",
      "3 consecutive days free from duty within any 17 days.",
    ],
  },
  "704": {
    label: "704 — Commuter",
    flightTime28: 112, flightTime90: 300, flightTime365: 1000,
    fdpDailyMax: 13, duty7Day: 60, duty7DayOptions: [60, 70], duty28Day: 192, duty365: 2200,
    singlePilot24: 8,
    minRestHome: 12, minRestAway: 10,
    notes: [
      "Time off — Option A: 36 consecutive hours off every 7 days, plus 3 consecutive days off every 17 days.",
      "Time off — Option B: 48 consecutive hours off every 8 days, plus 4 consecutive days off every 16 days.",
      "Split duty: a break of at least 4 consecutive hours in suitable accommodation extends the FDP by 50% of the break. Total extended FDP caps at 15 hours.",
      "Unforeseen circumstances: the captain may extend the FDP by up to 2 hours (3 hours with an augmented crew); the next rest period increases by the same amount.",
      "Max 3 consecutive FDPs infringing the window of circadian low (02:00–05:59) without added rest provisions.",
    ],
  },
  "703": {
    label: "703 — Air Taxi",
    flightTime28: 112, flightTime90: 300, flightTime365: 1000,
    fdpDailyMax: 13, duty7Day: 60, duty7DayOptions: [60, 70], duty28Day: 192, duty365: 2200,
    singlePilot24: 8,
    minRestHome: 12, minRestAway: 10,
    notes: [
      "Time off — Option A: 36 consecutive hours off every 7 days, plus 3 consecutive days off every 17 days.",
      "Time off — Option B: 48 consecutive hours off every 8 days, plus 4 consecutive days off every 16 days.",
      "Split duty: a break of at least 4 consecutive hours in suitable accommodation extends the FDP by 50% of the break (full credit for a night break). Total duty caps at 17 hours.",
      "Unforeseen circumstances: the captain may extend the FDP by up to 2 hours; the next rest period increases by the same amount.",
      "Reserve availability period (RAP): 14 hours maximum, and crews must be advised in advance.",
    ],
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
