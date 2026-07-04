// Canonical data shapes for the Pilot Logbook, ported from the original
// single-file app. Flights carry both structured IDs (pilotId/picId/…) and
// backward-compatible text mirrors (pic/sic/soc, year/month/day, civilIdent)
// that the CSV export and Supabase schema rely on — keep both in sync.

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
  };
}

export const APP_VERSION = "0.6.1";
