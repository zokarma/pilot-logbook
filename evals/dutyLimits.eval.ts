// Eval #13 — CARs operation-type duty limits (src/lib/dutyLimits.ts).
// The lookup that decides which fatigue-rule caps the dashboard gauges use.
// Must resolve legacy/unknown profiles safely and honor the 60/70h option.

import {
  DUTY_LIMITS, OPERATION_TYPES, DEFAULT_OPERATION, operationLimits, effectiveLimits,
} from "../src/lib/dutyLimits";
import { Suite } from "./harness";

export function run(): Suite {
  const s = new Suite(13, "CARs duty limits (dutyLimits.ts)", "Operation-type caps that drive the duty/CARs gauges — must degrade safely for legacy profiles.");

  // -- table integrity --
  s.check("all three operation types are defined", OPERATION_TYPES.every((op) => !!DUTY_LIMITS[op]));
  s.check("default operation is the conservative airline (705)", DEFAULT_OPERATION === "705");
  s.check("every table has the required caps populated", OPERATION_TYPES.every((op) => {
    const l = DUTY_LIMITS[op];
    return l.flightTime28 > 0 && l.duty7Day > 0 && l.fdpDailyMax > 0 && l.duty365 > 0 && l.minRestHome > 0;
  }));
  s.check("7-day options always include the configured default", OPERATION_TYPES.every((op) => DUTY_LIMITS[op].duty7DayOptions.includes(DUTY_LIMITS[op].duty7Day)));
  s.check("703 and 704 carry the single-pilot 24h cap; 705 does not", DUTY_LIMITS["703"].singlePilot24 === 8 && DUTY_LIMITS["704"].singlePilot24 === 8 && DUTY_LIMITS["705"].singlePilot24 === undefined);
  s.check("704/703 carry the 28-day duty cap (192h)", DUTY_LIMITS["704"].duty28Day === 192 && DUTY_LIMITS["703"].duty28Day === 192);

  // -- operationLimits: legacy-safe resolution --
  s.check("known code resolves to its table", operationLimits("703").label.includes("703"));
  s.check("undefined operation falls back to the default (705)", operationLimits(undefined).label.includes("705"));
  s.check("garbage operation falls back to the default", operationLimits("nonsense").label.includes("705"));

  // -- effectiveLimits: 7-day option swap --
  {
    const base = effectiveLimits({ carsSubpart: "705" });
    s.check("no option chosen → conservative default 7-day (60h)", base.duty7Day === 60);
    const opt70 = effectiveLimits({ carsSubpart: "705", duty7DayOption: 70 });
    s.check("approved 70h option is applied", opt70.duty7Day === 70);
    const optBad = effectiveLimits({ carsSubpart: "705", duty7DayOption: 55 });
    s.check("an option not in the approved set is ignored (stays 60h)", optBad.duty7Day === 60);
    s.check("effectiveLimits(null) never throws, returns the default", effectiveLimits(null).label.includes("705"));
    // The swap must not mutate the shared table.
    s.check("effectiveLimits returns a copy (table 7-day stays 60)", DUTY_LIMITS["705"].duty7Day === 60);
  }

  return s;
}
