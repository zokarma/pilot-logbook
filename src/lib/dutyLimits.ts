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
}

export const DUTY_LIMITS: Record<OperationType, DutyLimits> = {
  "705": {
    label: "705 — Airline",
    flightTime28: 112, flightTime90: 300, flightTime365: 1000,
    fdpDailyMax: 13, duty7Day: 60, duty7DayOptions: [60, 70], duty365: 2200,
    minRestHome: 12, minRestAway: 10,
  },
  "704": {
    label: "704 — Commuter",
    flightTime28: 112, flightTime90: 300, flightTime365: 1000,
    fdpDailyMax: 13, duty7Day: 60, duty7DayOptions: [60, 70], duty28Day: 192, duty365: 2200,
    singlePilot24: 8,
    minRestHome: 12, minRestAway: 10,
  },
  "703": {
    label: "703 — Air Taxi",
    flightTime28: 112, flightTime90: 300, flightTime365: 1000,
    fdpDailyMax: 13, duty7Day: 60, duty7DayOptions: [60, 70], duty28Day: 192, duty365: 2200,
    singlePilot24: 8,
    minRestHome: 12, minRestAway: 10,
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
