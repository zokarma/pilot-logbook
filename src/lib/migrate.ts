// Data migration — brings older logbooks into the current shape. Runs on every
// load. When you add or rename a field, extend this rather than assuming stored
// data has it. Operates in place on the passed object and returns it.

import { AppData, Flight, Pilot, emptyData } from "./types";
import { normalizeFlightColumns } from "./flightColumns";
import { uid } from "./id";

export function migrateData(input: Partial<AppData> | null | undefined): AppData {
  const d = (input || emptyData()) as AppData;
  if (!Array.isArray(d.flights)) d.flights = [];
  if (!Array.isArray(d.pilots)) d.pilots = [];
  if (typeof d.currentPilotId === "undefined") d.currentPilotId = null;
  if (!d.lastLoggedRole) d.lastLoggedRole = "Captain";
  if (!d.duty || typeof d.duty !== "object") d.duty = {};
  // Upgrade legacy duty entries from `true` to `{on: true}`
  Object.keys(d.duty).forEach((k) => {
    const entry = d.duty[k] as unknown;
    if (entry === true) d.duty[k] = { on: true };
    else if (entry && typeof entry === "object" && (entry as { on?: boolean }).on === undefined) {
      (entry as { on: boolean }).on = true;
    }
  });
  if (typeof d.pilotName !== "string") d.pilotName = "";
  if (!Array.isArray(d.bugReports)) d.bugReports = [];
  if (!Array.isArray(d.dashboardHidden)) d.dashboardHidden = [];
  d.flightColumns = normalizeFlightColumns(d.flightColumns);
  if (!Array.isArray(d.documents)) d.documents = [];
  if (typeof d.profile === "undefined") d.profile = null;
  if (!Array.isArray(d.importTemplates)) d.importTemplates = [];
  if (!Array.isArray(d.fleet)) d.fleet = [];
  if (!Array.isArray(d.currencyRules)) d.currencyRules = [];

  // Build a quick name -> pilotId map; create profiles for any free-text PIC/SIC/SOC.
  const nameToId: Record<string, string> = {};
  d.pilots.forEach((p) => {
    const full = ((p.firstName || "") + " " + (p.lastName || "")).trim().toLowerCase();
    if (full) nameToId[full] = p.id;
  });
  function ensurePilot(rawName?: string): string {
    const name = (rawName || "").trim();
    if (!name) return "";
    const key = name.toLowerCase();
    if (nameToId[key]) return nameToId[key];
    const parts = name.split(/\s+/);
    const p: Pilot = {
      id: uid("p"),
      firstName: parts[0] || name,
      lastName: parts.slice(1).join(" "),
      employeeNumber: "",
      licenseNumber: "",
      createdAt: new Date().toISOString(),
    };
    d.pilots.push(p);
    nameToId[key] = p.id;
    return p.id;
  }

  d.flights.forEach((fl: Flight) => {
    if (!fl.date && fl.year) {
      const m = String(fl.month || 1).padStart(2, "0");
      const dd = String(fl.day || 1).padStart(2, "0");
      fl.date = `${fl.year}-${m}-${dd}`;
    }
    if (!fl.registration && fl.civilIdent) fl.registration = fl.civilIdent;
    if (typeof fl.picId === "undefined") fl.picId = ensurePilot(fl.pic);
    if (typeof fl.sicId === "undefined") fl.sicId = ensurePilot(fl.sic);
    if (typeof fl.socId === "undefined") fl.socId = ensurePilot(fl.soc);
    if (typeof fl.dayHours === "undefined") fl.dayHours = 0;
    if (typeof fl.nightHours === "undefined") fl.nightHours = 0;
    if (!fl.loggedRole) fl.loggedRole = "Captain";
    if (!fl.pilotId) fl.pilotId = fl.picId || null;
  });

  // Promote legacy pilotName into a profile if missing.
  if (
    d.pilotName &&
    !d.pilots.find(
      (p) =>
        ((p.firstName || "") + " " + (p.lastName || "")).trim().toLowerCase() ===
        d.pilotName.trim().toLowerCase(),
    )
  ) {
    ensurePilot(d.pilotName);
  }
  if (!d.currentPilotId && d.pilots.length) d.currentPilotId = d.pilots[0].id;

  // Profile / onboarding. Brand-new users (no flights, no pilots) get a null
  // profile so the first-time setup wizard runs. Existing users are never
  // interrupted: synthesize a profile from their current pilot and mark it
  // onboarded so they land straight in the app.
  if (!d.profile) {
    const hasData = d.flights.length > 0 || d.pilots.length > 0;
    if (hasData) {
      const primary =
        d.pilots.find((p) => p.id === d.currentPilotId) || d.pilots[0] || null;
      d.profile = {
        firstName: primary?.firstName || "",
        lastName: primary?.lastName || "",
        role: d.lastLoggedRole || "Captain",
        pilotId: primary?.id,
        onboarded: true,
      };
    }
  }
  // Keep the profile pinned to a real pilot id if one exists.
  if (d.profile && !d.profile.pilotId && d.currentPilotId) {
    d.profile.pilotId = d.currentPilotId;
  }

  return d;
}
