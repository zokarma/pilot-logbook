// Flight-form field catalogue — the counterpart to flightColumns.ts, but for
// the Add-a-Flight form rather than the table.
//
// The form is split in two:
//  - CORE fields are always rendered. Without them a logbook entry isn't a
//    logbook entry (when, what, where, and the takeoff/landing that currency
//    depends on), so they are deliberately NOT hideable.
//  - OPTIONAL fields are the ones a given pilot may never touch. They can be
//    switched off per-user from the form's Customize panel, and are seeded from
//    the pilot's role on first run (see roleDefaults.ts).
//
// Hiding a field never clears data: an existing flight keeps whatever value it
// already had, and the field reappears with that value if it's switched back on.

/** Fields that are always rendered and cannot be hidden. */
export const CORE_FORM_FIELDS = [
  "date", "aircraftType", "registration", "from", "to", "takeoff", "landing", "notes",
] as const;

/** Hideable fields, in the order they appear on the form. */
export const OPTIONAL_FORM_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "loggedRole", label: "Role being logged" },
  { key: "pic", label: "PIC" },
  { key: "sic", label: "Student / First Officer" },
  { key: "soc", label: "Third crew", hint: "Multi-crew decks only" },
  { key: "se", label: "Single engine (hrs)" },
  { key: "me", label: "Multi engine (hrs)" },
  { key: "xc", label: "Cross country (hrs)" },
  { key: "dayHours", label: "Day (hrs)" },
  { key: "nightHours", label: "Night (hrs)" },
  { key: "ifrActual", label: "IFR actual (hrs)" },
  { key: "ifrSim", label: "IFR simulated (hrs)" },
  { key: "approaches", label: "Approaches (count)" },
];

export const DEFAULT_FORM_FIELD_KEYS: string[] = OPTIONAL_FORM_FIELDS.map((f) => f.key);

export const FORM_FIELD_LABEL: Record<string, string> = Object.fromEntries(
  OPTIONAL_FORM_FIELDS.map((f) => [f.key, f.label]),
);

/**
 * Drop unknown keys and de-dupe. Unlike flight columns, an EMPTY result is
 * legitimate here — a pilot may switch every optional field off and log with
 * the core fields alone — so this only falls back to the full set when the
 * stored value is missing entirely (i.e. a logbook from before this feature).
 */
export function normalizeFormFields(keys?: string[] | null): string[] {
  if (!Array.isArray(keys)) return [...DEFAULT_FORM_FIELD_KEYS];
  const valid = new Set(DEFAULT_FORM_FIELD_KEYS);
  const seen = new Set<string>();
  return keys.filter((k) => valid.has(k) && !seen.has(k) && seen.add(k));
}
