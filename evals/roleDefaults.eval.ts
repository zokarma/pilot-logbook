// Eval #25 — role-based defaults (src/lib/roleDefaults.ts).
//
// These rules decide what a pilot sees on first run. Two failure modes matter:
// hiding something a pilot genuinely needs (they lose trust in the logbook), and
// wiping data while "tidying up" (unforgivable in a legal record). The checks
// below pin both, plus the conservative promise that commercial roles are never
// second-guessed.

import {
  AIRCRAFT_CLASS, roleHiddenAircraft, roleFlightColumns, roleFormFields,
  applyRoleDefaults, roleDefaultsDiffer, showDutyForRole, isNonCommercialRole,
} from "../src/lib/roleDefaults";
import { AIRCRAFT_TYPES } from "../src/lib/aircraft";
import { DEFAULT_FLIGHT_COLUMN_KEYS } from "../src/lib/flightColumns";
import { DEFAULT_FORM_FIELD_KEYS } from "../src/lib/formFields";
import { PILOT_ROLES } from "../src/lib/documents";
import { mkData, mkFlight } from "./fixtures";
import { Suite } from "./harness";

const COMMERCIAL = ["Commercial Pilot", "First Officer", "Captain", "Second Officer", "Other"];
const NON_COMMERCIAL = ["Student Pilot", "Private Pilot", "Flight Instructor"];

export function run(): Suite {
  const s = new Suite(25, "Role defaults (roleDefaults.ts)", "Decides what a new pilot sees; over-hiding loses trust, and nothing may touch logbook data.");

  // -- catalogue coverage: an unclassified type would silently never be hidden --
  {
    const missing = AIRCRAFT_TYPES.filter((t) => !AIRCRAFT_CLASS[t.code]);
    s.check(`all ${AIRCRAFT_TYPES.length} built-in types are classified`, missing.length === 0, missing.map((t) => t.code).join(","));
  }

  // -- commercial roles are never second-guessed --
  for (const role of COMMERCIAL) {
    s.check(`${role}: no aircraft hidden`, roleHiddenAircraft(role).length === 0);
    s.check(`${role}: every column shown`, roleFlightColumns(role).length === DEFAULT_FLIGHT_COLUMN_KEYS.length);
    s.check(`${role}: every form field shown`, roleFormFields(role).length === DEFAULT_FORM_FIELD_KEYS.length);
  }
  s.check("unknown/blank role is treated as commercial (hides nothing)", roleHiddenAircraft(undefined).length === 0 && roleHiddenAircraft("Astronaut").length === 0);

  // -- non-commercial roles: jets and turboprops only --
  for (const role of NON_COMMERCIAL) {
    const hidden = new Set(roleHiddenAircraft(role));
    s.check(`${role}: airliners hidden`, hidden.has("A320") && hidden.has("B737") && hidden.has("CRJ900"));
    s.check(`${role}: turboprops hidden`, hidden.has("BE20") && hidden.has("DHC-8"));
    s.check(`${role}: trainers always visible`, !hidden.has("C172") && !hidden.has("PA28") && !hidden.has("DA40"));
    s.check(`${role}: light twin stays (multi training)`, !hidden.has("DA42"));
    s.check(`${role}: third-crew box hidden`, !roleFormFields(role).includes("soc") && !roleFlightColumns(role).includes("soc"));
  }
  s.check("only a student loses the multi-engine box", !roleFormFields("Student Pilot").includes("me") && roleFormFields("Private Pilot").includes("me"));
  s.check("students keep single-engine + IFR boxes (they train on both)", roleFormFields("Student Pilot").includes("se") && roleFormFields("Student Pilot").includes("ifrSim"));

  // -- ordering is preserved, so the form/table layout stays stable --
  {
    const cols = roleFlightColumns("Student Pilot");
    const order = DEFAULT_FLIGHT_COLUMN_KEYS.filter((k) => cols.includes(k));
    s.check("column order follows the catalogue", cols.every((c, i) => c === order[i]));
  }

  // -- every role in the picker produces a usable form --
  for (const role of PILOT_ROLES) {
    s.check(`${role}: still has date-critical hour fields`, roleFormFields(role).includes("se") || roleFormFields(role).includes("me"));
  }

  // -- applyRoleDefaults touches ONLY the three preference lists --
  {
    const d = mkData({
      flights: [mkFlight("f1", { soc: "Someone", me: 2 })],
      documents: [{ id: "d1", type: "Category 1 Medical", expiryMode: "manual", expiryDate: "2027-01-01", createdAt: "", updatedAt: "" }],
    });
    const flightsBefore = JSON.stringify(d.flights);
    const docsBefore = JSON.stringify(d.documents);
    applyRoleDefaults(d, "Student Pilot");
    s.check("flights are untouched by a retune", JSON.stringify(d.flights) === flightsBefore);
    s.check("documents are untouched by a retune", JSON.stringify(d.documents) === docsBefore);
    s.check("fleetHidden is set from the role", d.fleetHidden.includes("A320"));
    s.check("columns/fields are set from the role", !d.flightColumns.includes("soc") && !d.flightFormFields.includes("me"));

    // ...and switching to a commercial role restores everything.
    applyRoleDefaults(d, "Captain");
    s.check("moving to a commercial role restores the full lists",
      d.fleetHidden.length === 0 &&
      d.flightColumns.length === DEFAULT_FLIGHT_COLUMN_KEYS.length &&
      d.flightFormFields.length === DEFAULT_FORM_FIELD_KEYS.length);
  }

  // -- the retune prompt only fires when it would actually change something --
  {
    const d = mkData();
    applyRoleDefaults(d, "Captain");
    s.check("no prompt when already matching the role", !roleDefaultsDiffer(d, "Captain"));
    s.check("prompt when the role would change things", roleDefaultsDiffer(d, "Student Pilot"));
  }

  // -- duty visibility: role hides it, but recorded data always wins --
  {
    s.check("duty hidden for a student with no duty data", !showDutyForRole(mkData({ profile: { firstName: "A", lastName: "B", role: "Student Pilot", onboarded: true } })));
    s.check("duty shown for a captain", showDutyForRole(mkData({ profile: { firstName: "A", lastName: "B", role: "Captain", onboarded: true } })));
    s.check("duty shown for a student who HAS recorded duty (data wins)", showDutyForRole(mkData({
      profile: { firstName: "A", lastName: "B", role: "Student Pilot", onboarded: true },
      duty: { "2026-07-01": { on: true, hours: 6 } },
    })));
  }

  s.check("isNonCommercialRole matches the three trainee roles", NON_COMMERCIAL.every(isNonCommercialRole) && !COMMERCIAL.some(isNonCommercialRole));

  return s;
}
