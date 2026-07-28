// Pilot de-duplication + merge logic. Free-text imports create many near-
// duplicate profiles, so these helpers flag clusters and fold references from
// source pilots into a target before deleting the sources.

import { AppData, Pilot } from "./types";
import { pilotName } from "./logbook";

// "B.Pearce" -> "b:pearce" ; "Ben Pearce" -> "b:pearce" ; "A. MOWBRAY" -> "a:mowbray".
export function pilotDupKey(p: Pilot): string {
  const full = `${p.firstName || ""} ${p.lastName || ""}`.toLowerCase();
  const words = full.split(/[^a-z]+/).filter(Boolean);
  if (!words.length) return "";
  const last = words[words.length - 1];
  const initials = words.slice(0, -1).map((w) => w[0]).sort().join("");
  return `${initials}:${last}`;
}

export function findDuplicateClusters(data: AppData): Pilot[][] {
  const groups: Record<string, Pilot[]> = {};
  data.pilots.forEach((p) => {
    const k = pilotDupKey(p);
    if (!k) return;
    (groups[k] = groups[k] || []).push(p);
  });
  return Object.values(groups).filter((g) => g.length >= 2);
}

export function flightRefCount(data: AppData, ids: string[]): number {
  return data.flights.filter((f) =>
    ids.some((id) => f.pilotId === id || f.picId === id || f.sicId === id || f.socId === id),
  ).length;
}

// Fold every pilot in sourceIds into targetId (mutates the draft).
export function applyMerge(draft: AppData, targetId: string, sourceIds: string[]): void {
  const tgt = draft.pilots.find((p) => p.id === targetId);
  if (!tgt) return;
  // Merging a pilot into themselves would delete the target at the end of this
  // function, leaving every flight pointing at an id that no longer exists. The
  // UI never offers it; this makes it impossible however applyMerge is called.
  sourceIds = sourceIds.filter((id) => id !== targetId);
  sourceIds.forEach((id) => {
    const src = draft.pilots.find((p) => p.id === id);
    if (!src) return;
    if (!tgt.employeeNumber && src.employeeNumber) tgt.employeeNumber = src.employeeNumber;
    if (!tgt.licenseNumber && src.licenseNumber) tgt.licenseNumber = src.licenseNumber;
  });
  draft.flights.forEach((f) => {
    if (sourceIds.includes(f.pilotId as string)) f.pilotId = targetId;
    if (sourceIds.includes(f.picId)) { f.picId = targetId; f.pic = pilotName(draft, targetId); }
    if (sourceIds.includes(f.sicId)) { f.sicId = targetId; f.sic = pilotName(draft, targetId); }
    if (sourceIds.includes(f.socId)) { f.socId = targetId; f.soc = pilotName(draft, targetId); }
  });
  draft.pilots = draft.pilots.filter((p) => !sourceIds.includes(p.id));
  if (sourceIds.includes(draft.currentPilotId as string)) draft.currentPilotId = targetId;
}

// Delete one pilot, clearing its references (mutates the draft).
export function applyDeletePilot(draft: AppData, id: string): void {
  draft.pilots = draft.pilots.filter((p) => p.id !== id);
  const fallback = draft.pilots[0]?.id || null;
  draft.flights.forEach((f) => {
    // Clear ownership rather than reassigning to another pilot — migrateData
    // re-points orphaned flights to their PIC on next load when one exists.
    if (f.pilotId === id) f.pilotId = null;
    if (f.picId === id) { f.picId = ""; f.pic = ""; }
    if (f.sicId === id) { f.sicId = ""; f.sic = ""; }
    if (f.socId === id) { f.socId = ""; f.soc = ""; }
  });
  if (draft.currentPilotId === id) draft.currentPilotId = fallback;
}
