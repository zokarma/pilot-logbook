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
  };
}

export const APP_VERSION = "0.7.1";
