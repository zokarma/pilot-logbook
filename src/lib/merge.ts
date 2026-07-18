// Per-entity sync merge — the fix for whole-blob last-write-wins.
//
// The cloud store is one JSONB blob per user (plb_app_state.data). Two clients
// editing offline used to silently overwrite each other's flights on whichever
// upsert landed last. Instead, DataContext now keeps the last state it synced
// FROM the server (the "base") and, before writing, three-way merges
//   base (common ancestor) + local (this client) + remote (server row)
// entity-by-entity. Entities are matched by id (duty entries by date key);
// concurrent edits to the same entity resolve to the newer updated_at stamp.
// The base is what lets deletions propagate without tombstones: an entity
// missing on one side but unchanged from base was deleted there, while an
// entity missing on one side and *changed* on the other was edited — and an
// edit beats a delete (never silently lose a flight; this is a legal record).
//
// Without a base (pre-upgrade caches) the merge degrades to a union: deleted
// entities can resurrect once, but nothing is ever lost.
//
// Pure and framework-free like the rest of src/lib. All inputs must be
// screenshot-stripped (clientStore.stripScreenshots) so local-only screenshot
// blobs never register as differences.

import { AppData, DutyEntry } from "./types";

// Order-insensitive deep equality. jsonb round-trips reorder object keys and
// JSON.stringify drops undefined-valued keys, so key order must not matter and
// `k: undefined` must equal an absent key.
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
    const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(ra[k], rb[k]));
  }
  return false;
}

// Equality ignoring the entity's own change stamp, so a difference in nothing
// but the stamp doesn't count as an edit.
function sameIgnoringStamp(a: unknown, b: unknown, stampKey: string): boolean {
  return deepEqual(
    { ...(a as Record<string, unknown>), [stampKey]: undefined },
    { ...(b as Record<string, unknown>), [stampKey]: undefined },
  );
}

// True when both timestamps denote the same instant. Our writes use
// toISOString() ("…Z") but Postgres echoes "…+00:00", so compare parsed times.
export function sameStamp(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return Date.parse(a) === Date.parse(b);
}

// Concurrent edits to the same entity: newer stamp wins; a stamped side beats
// an unstamped one; otherwise keep local (the copy in front of the user).
function pickNewer<T>(local: T, remote: T, stampOf: (t: T) => string | undefined): T {
  const ls = stampOf(local);
  const rs = stampOf(remote);
  if (ls && rs) return Date.parse(rs) > Date.parse(ls) ? remote : local;
  if (rs && !ls) return remote;
  return local;
}

function mergeById<T>(
  base: T[] | undefined,
  local: T[],
  remote: T[],
  idOf: (t: T) => string,
  stampKey: string,
): T[] {
  const stampOf = (t: T) => (t as Record<string, unknown>)[stampKey] as string | undefined;
  const baseMap = new Map((base ?? []).map((t) => [idOf(t), t]));
  const localIds = new Set(local.map(idOf));
  const remoteMap = new Map(remote.map((t) => [idOf(t), t]));
  const out: T[] = [];
  for (const l of local) {
    const id = idOf(l);
    const r = remoteMap.get(id);
    if (r !== undefined) {
      out.push(deepEqual(l, r) ? l : pickNewer(l, r, stampOf));
    } else {
      const b = baseMap.get(id);
      // In base and unchanged locally → the other client deleted it. Anything
      // else is a local add or a local edit (which beats a remote delete).
      if (b !== undefined && sameIgnoringStamp(l, b, stampKey)) continue;
      out.push(l);
    }
  }
  for (const r of remote) {
    const id = idOf(r);
    if (localIds.has(id)) continue;
    const b = baseMap.get(id);
    // In base and unchanged remotely → deleted locally; keep the delete.
    if (b !== undefined && sameIgnoringStamp(r, b, stampKey)) continue;
    out.push(r);
  }
  return out;
}

// Same three-way logic for the duty Record<dateKey, DutyEntry>. The entry's
// updatedAt is hoisted onto the wrapper (and stripped from the inner entry) so
// mergeById reads the stamp where it lives — otherwise every duty conflict
// looks unstamped, ties always keep local, and two devices editing the same
// duty day never converge.
function mergeDuty(
  base: Record<string, DutyEntry> | undefined,
  local: Record<string, DutyEntry>,
  remote: Record<string, DutyEntry>,
): Record<string, DutyEntry> {
  type Keyed = { key: string; updatedAt?: string; entry: DutyEntry };
  const toList = (rec: Record<string, DutyEntry> | undefined): Keyed[] =>
    Object.entries(rec ?? {}).map(([key, entry]) => {
      const { updatedAt, ...rest } = entry;
      return { key, updatedAt, entry: rest as DutyEntry };
    });
  const merged = mergeById(toList(base), toList(local), toList(remote), (k) => k.key, "updatedAt");
  const out: Record<string, DutyEntry> = {};
  for (const k of merged) {
    out[k.key] = k.updatedAt !== undefined ? { ...k.entry, updatedAt: k.updatedAt } : k.entry;
  }
  return out;
}

// Singleton fields (profile, column layout, …): changed-from-base side wins;
// if both changed (or there is no base), keep local.
function pickField<K extends keyof AppData>(
  base: AppData | null,
  local: AppData,
  remote: AppData,
  key: K,
): AppData[K] {
  if (!base) return local[key];
  return deepEqual(local[key], base[key]) ? remote[key] : local[key];
}

export function mergeAppData(base: AppData | null, local: AppData, remote: AppData): AppData {
  return {
    // Unknown top-level keys (e.g. written by a newer app version) survive the
    // round trip instead of being dropped by an older client.
    ...remote,
    ...local,
    flights: mergeById(base?.flights, local.flights ?? [], remote.flights ?? [], (f) => f.id, "updated_at"),
    pilots: mergeById(base?.pilots, local.pilots ?? [], remote.pilots ?? [], (p) => p.id, "updatedAt"),
    documents: mergeById(base?.documents, local.documents ?? [], remote.documents ?? [], (d) => d.id, "updatedAt"),
    bugReports: mergeById(base?.bugReports, local.bugReports ?? [], remote.bugReports ?? [], (b) => b.id, "updatedAt"),
    importTemplates: mergeById(
      base?.importTemplates, local.importTemplates ?? [], remote.importTemplates ?? [], (t) => t.id, "updatedAt",
    ),
    fleet: mergeById(base?.fleet, local.fleet ?? [], remote.fleet ?? [], (a) => a.id, "updatedAt"),
    duty: mergeDuty(base?.duty, local.duty ?? {}, remote.duty ?? {}),
    pilotName: pickField(base, local, remote, "pilotName"),
    currentPilotId: pickField(base, local, remote, "currentPilotId"),
    lastLoggedRole: pickField(base, local, remote, "lastLoggedRole"),
    dashboardHidden: pickField(base, local, remote, "dashboardHidden"),
    flightColumns: pickField(base, local, remote, "flightColumns"),
    profile: pickField(base, local, remote, "profile"),
  };
}

// --- Change stamping -------------------------------------------------------
// mutate()/replace() call this on every state change so each added or edited
// entity carries the wall-clock stamp the conflict resolution above relies on.
// (syncFlightMirrors also stamps flights; double-stamping is harmless.)

function stampList<T>(prev: T[], next: T[], idOf: (t: T) => string, stampKey: string, now: string): void {
  const prevMap = new Map(prev.map((t) => [idOf(t), t]));
  for (const n of next) {
    const p = prevMap.get(idOf(n));
    if (p === undefined || !sameIgnoringStamp(n, p, stampKey)) {
      (n as Record<string, unknown>)[stampKey] = now;
    }
  }
}

// Mutates `next` in place (it is always a fresh draft/import result).
export function stampChanges(prev: AppData, next: AppData, now: string): void {
  stampList(prev.flights ?? [], next.flights ?? [], (f) => f.id, "updated_at", now);
  stampList(prev.pilots ?? [], next.pilots ?? [], (p) => p.id, "updatedAt", now);
  stampList(prev.documents ?? [], next.documents ?? [], (d) => d.id, "updatedAt", now);
  stampList(prev.bugReports ?? [], next.bugReports ?? [], (b) => b.id, "updatedAt", now);
  stampList(prev.importTemplates ?? [], next.importTemplates ?? [], (t) => t.id, "updatedAt", now);
  stampList(prev.fleet ?? [], next.fleet ?? [], (a) => a.id, "updatedAt", now);
  const prevDuty = prev.duty ?? {};
  const nextDuty = next.duty ?? {};
  for (const key of Object.keys(nextDuty)) {
    const p = prevDuty[key];
    if (p === undefined || !sameIgnoringStamp(nextDuty[key], p, "updatedAt")) {
      nextDuty[key].updatedAt = now;
    }
  }
}
