// Canonical data shapes for the Pilot Logbook, ported from the original
// single-file app. Flights carry both structured IDs (pilotId/picId/…) and
// backward-compatible text mirrors (pic/sic/soc, year/month/day, civilIdent)
// that the CSV export and Supabase schema rely on — keep both in sync.

import { DEFAULT_FLIGHT_COLUMN_KEYS } from "./flightColumns";

export type DayNight = "Day" | "Night";

export interface Pilot {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  licenseNumber: string;
  createdAt: string;
  updatedAt?: string; // stamped on change (lib/merge) — drives sync conflict resolution
}

export interface Flight {
  id: string;
  // Canonical fields
  date: string; // "YYYY-MM-DD"
  aircraftType: string;
  registration: string;
  pilotId: string | null; // owner of this logbook row
  loggedRole: string;
  picId: string;
  sicId: string;
  socId: string;
  from: string;
  to: string;
  takeoff: DayNight;
  landing: DayNight;
  se: number;
  me: number;
  xc: number;
  dayHours: number;
  nightHours: number;
  ifrActual: number;
  ifrSim: number;
  notes: string;
  // Currency inputs (optional; older flights won't have them). A flight with
  // no `landings` counts as ONE takeoff + ONE landing (classified day/night by
  // the takeoff/landing fields); `approaches` defaults to 0. See lib/currency.
  landings?: number;
  approaches?: number;
  // Backward-compatible mirrors (CSV / Supabase schema)
  year?: number;
  month?: number;
  day?: number;
  civilIdent?: string;
  pic?: string;
  sic?: string;
  soc?: string;
  updated_at?: string;
}

export interface DutyEntry {
  on: boolean;
  start?: string;
  end?: string;
  hours?: number;
  operationType?: string;
  updatedAt?: string; // stamped on change (lib/merge) — drives sync conflict resolution
}

export interface BugReport {
  id: string;
  username: string;
  created_at: string;
  status: string;
  severity: string;
  description: string;
  steps: string;
  tab: string;
  url: string;
  user_agent: string;
  viewport: string;
  app_version: string;
  app_state: Record<string, unknown>;
  recent_errors: unknown[];
  screenshot?: string; // base64 data URL, local-only (never pushed to cloud)
  updatedAt?: string; // stamped on change (lib/merge) — drives sync conflict resolution
}

// The primary account holder's profile, captured in the first-time setup wizard
// and editable afterwards. Stored inside AppData (the single per-user JSONB blob),
// so it inherits the same RLS scoping and offline mirroring as everything else.
export interface UserProfile {
  firstName: string;
  lastName: string;
  displayName?: string;
  role: string; // one of PILOT_ROLES
  dateOfBirth?: string; // "YYYY-MM-DD" — drives Transport Canada medical expiry math
  carsSubpart?: string; // "703" | "704" | "705" — CARs operation, drives duty limits
  duty7DayOption?: number; // 60 or 70 — the operator's approved 7-day work limit
  pilotId?: string; // the Pilot profile that represents this account holder
  onboarded: boolean; // has the setup wizard been completed / skipped
}

// How a document's expiry date was determined.
export type DocExpiryMode = "auto" | "manual" | "none";

// An aviation document (licence / medical / certificate) owned by the user.
export interface PilotDocument {
  id: string;
  type: string; // one of the catalog values in lib/documents.ts (or free text)
  number?: string;
  issueDate?: string; // "YYYY-MM-DD"
  examDate?: string; // medical examination date — basis for auto medical expiry
  expiryDate?: string; // "YYYY-MM-DD"; empty when expiryMode === "none"
  expiryMode: DocExpiryMode;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// A user-defined aircraft type in the pilot's personal fleet, on top of the
// built-in catalog (lib/aircraft.ts). Per-user data like everything else —
// stored in AppData, RLS-scoped, offline-mirrored, and merge-synced. `code`
// (normalized, uppercased) is the natural key used to dedupe against built-ins.
export interface AircraftType {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  updatedAt?: string; // stamped on change (lib/merge) — drives sync conflict resolution
}

// A pilot-defined currency rule ("N <metric> in the last <windowDays> days",
// optionally scoped to one aircraft type) evaluated by lib/currency.ts. The
// Transport Canada rules are built-in; these are the user's extras (company
// minima, personal minima). Per-user, merge-synced like everything else.
export interface CurrencyRule {
  id: string;
  name: string;
  metric: string; // a CurrencyMetric key from lib/currency.ts
  threshold: number;
  windowDays: number;
  aircraftType?: string; // restrict to one type (normalized code) when set
  createdAt: string;
  updatedAt?: string; // stamped on change (lib/merge) — drives sync conflict resolution
}

// A remembered CSV import mapping, keyed by a hash of the file's (normalized)
// header row. Re-importing a file with the same shape skips the mapping step.
export interface ImportTemplate {
  id: string;
  signature: string; // headerSignature() of the source file's headers
  mapping: { header: string; field: string }[]; // mapped columns only
  createdAt: string;
  updatedAt: string;
}

export interface AppData {
  flights: Flight[];
  duty: Record<string, DutyEntry>;
  pilotName: string;
  pilots: Pilot[];
  currentPilotId: string | null;
  lastLoggedRole: string;
  bugReports: BugReport[];
  // Per-user dashboard metric keys the user has hidden (local UI preference).
  dashboardHidden: string[];
  // Ordered list of visible Logged Flights columns (keys from lib/flightColumns).
  flightColumns: string[];
  // First-time setup profile (null until the wizard runs) + aviation documents.
  profile: UserProfile | null;
  documents: PilotDocument[];
  // Saved CSV column mappings from previous imports (lib/importMap).
  importTemplates: ImportTemplate[];
  // The pilot's custom aircraft types, added via the Fleet manager, shown in
  // pickers alongside the built-in catalog (lib/aircraft.ts).
  fleet: AircraftType[];
  // User-defined currency rules (lib/currency.ts evaluates them + the TC built-ins).
  currencyRules: CurrencyRule[];
}

export function emptyData(): AppData {
  return {
    flights: [],
    duty: {},
    pilotName: "",
    pilots: [],
    currentPilotId: null,
    lastLoggedRole: "Captain",
    bugReports: [],
    dashboardHidden: [],
    flightColumns: [...DEFAULT_FLIGHT_COLUMN_KEYS],
    profile: null,
    documents: [],
    importTemplates: [],
    fleet: [],
    currencyRules: [],
  };
}

export const APP_VERSION = "0.13.0";
