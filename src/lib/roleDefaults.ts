// Role-based defaults — what a pilot sees on first run, tuned to the flying
// they actually do. A student shouldn't wade past an A320 to find a 172, or
// past a "Third Crew" box that will never be filled in.
//
// DESIGN RULES (deliberately conservative):
//  - Only ever hide what is *clearly* irrelevant to the role. When in doubt,
//    show it. A missing box costs one click to restore; a pilot who can't find
//    the field they need loses trust in the logbook.
//  - Commercial roles get EVERYTHING. A commercial pilot may fly anything from
//    a 172 to a CRJ, so guessing on their behalf is unhelpful.
//  - Nothing here is a lock. Every list this produces is stored in ordinary
//    per-user state the pilot can change: Fleet page (show/hide), the flight
//    table's Columns panel, and the flight form's Customize panel.
//  - Hiding never destroys data. A hidden aircraft type still resolves on
//    existing flights; a hidden column/field still keeps its stored value.
//
// Pure and framework-free so the rules are eval-able.

import { AppData } from "./types";
import { AIRCRAFT_TYPES, normalizeAircraftCode } from "./aircraft";
import { DEFAULT_FLIGHT_COLUMN_KEYS } from "./flightColumns";
import { DEFAULT_FORM_FIELD_KEYS, OPTIONAL_FORM_FIELDS } from "./formFields";

/** Broad class of a built-in aircraft type, used only to pick sensible defaults. */
export type AircraftClass = "trainer" | "twin" | "turboprop" | "jet";

// Classification of the built-in catalog. Custom types the pilot adds are never
// auto-hidden — they added them on purpose.
export const AIRCRAFT_CLASS: Record<string, AircraftClass> = {
  C172: "trainer", C182: "trainer", PA28: "trainer", DA20: "trainer", DA40: "trainer",
  DA42: "twin",
  BE20: "turboprop", "PC-12": "turboprop", "DHC-8": "turboprop",
  CRJ200: "jet", CRJ700: "jet", CRJ900: "jet",
  B737: "jet", B738: "jet", A220: "jet", A320: "jet", A321: "jet",
};

// Roles that don't fly commercially. These are the only roles anything is
// hidden for; every other role sees the full product.
const NON_COMMERCIAL = new Set(["Student Pilot", "Private Pilot", "Flight Instructor"]);

export function isNonCommercialRole(role: string | undefined | null): boolean {
  return !!role && NON_COMMERCIAL.has(role);
}

/**
 * Built-in aircraft codes hidden by default for a role.
 * Non-commercial roles skip turbine metal; everyone else sees the whole catalog.
 */
export function roleHiddenAircraft(role: string | undefined | null): string[] {
  if (!isNonCommercialRole(role)) return [];
  return AIRCRAFT_TYPES
    .map((t) => t.code)
    .filter((code) => {
      const cls = AIRCRAFT_CLASS[code];
      return cls === "jet" || cls === "turboprop";
    })
    .map(normalizeAircraftCode);
}

// Columns/fields a role has no use for. Kept tiny on purpose — see DESIGN RULES.
//  - "soc" / third crew: a third crew member only exists on a multi-crew deck.
//  - "me" (multi-engine): a student pilot is on a single-engine trainer; the
//    moment they start multi training they can switch it back on.
function roleHiddenKeys(role: string | undefined | null): Set<string> {
  if (!isNonCommercialRole(role)) return new Set();
  const hidden = new Set(["soc"]);
  if (role === "Student Pilot") hidden.add("me");
  return hidden;
}

/** Default visible flight-table columns for a role (ordered as the catalog is). */
export function roleFlightColumns(role: string | undefined | null): string[] {
  const hidden = roleHiddenKeys(role);
  return DEFAULT_FLIGHT_COLUMN_KEYS.filter((k) => !hidden.has(k));
}

/** Default enabled optional form fields for a role. */
export function roleFormFields(role: string | undefined | null): string[] {
  const hidden = roleHiddenKeys(role);
  return DEFAULT_FORM_FIELD_KEYS.filter((k) => !hidden.has(k));
}

/**
 * Should the Duty Tracker be offered to this pilot?
 *
 * Non-commercial roles have no CARs duty limits to track, so it's hidden — but
 * NEVER when duty has already been recorded. Data the pilot entered always wins
 * over a guess about what they need.
 */
export function showDutyForRole(data: AppData): boolean {
  const hasDutyData = Object.keys(data.duty ?? {}).length > 0;
  if (hasDutyData) return true;
  return !isNonCommercialRole(data.profile?.role);
}

/**
 * Apply a role's defaults to the three per-user lists, in place on a draft.
 * Used at the end of onboarding and when the pilot changes role.
 *
 * Only ever REPLACES these three lists — flights, documents and every other
 * piece of logbook data are untouched.
 */
export function applyRoleDefaults(draft: AppData, role: string | undefined | null): void {
  draft.fleetHidden = roleHiddenAircraft(role);
  draft.flightColumns = roleFlightColumns(role);
  draft.flightFormFields = roleFormFields(role);
}

/** True when a role's defaults would actually change anything on screen. */
export function roleDefaultsDiffer(data: AppData, role: string | undefined | null): boolean {
  const sameList = (a: string[] | undefined, b: string[]) =>
    Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
  return !(
    sameList([...(data.fleetHidden ?? [])].sort(), [...roleHiddenAircraft(role)].sort()) &&
    sameList(data.flightColumns, roleFlightColumns(role)) &&
    sameList(data.flightFormFields, roleFormFields(role))
  );
}

// Re-exported so callers don't need to know which module owns the field list.
export { OPTIONAL_FORM_FIELDS };
