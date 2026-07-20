// Browser-side persistence helpers. The Supabase-backed API routes are the
// primary store; this localStorage layer is (a) an offline mirror, (b) where
// bug-report screenshots live (they're never sent to the cloud), and (c) a
// full local-only fallback when Supabase isn't configured.

import { AppData, emptyData } from "./types";
import { hashStr } from "./hash";
import { migrateData } from "./migrate";

const cacheKey = (u: string) => "plb_cache_" + u;
const baseKey = (u: string) => "plb_base_" + u;
const LOCAL_USERS_KEY = "plb_local_users";
const LOCAL_SESSION_KEY = "plb_local_session";
const LAST_USER_KEY = "plb_last_user";

// The last cloud user who signed in on this device. Lets the app open their
// mirrored logbook instantly on launch (before — or entirely without — the
// network), so a pilot is never locked out mid-trip by an expired token.
export interface LastUser {
  uid: string;
  email: string;
}

export function loadLastUser(): LastUser | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    return raw ? (JSON.parse(raw) as LastUser) : null;
  } catch {
    return null;
  }
}

export function saveLastUser(u: LastUser): void {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(u));
  } catch {
    /* ignore */
  }
}

export function clearLastUser(): void {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    /* ignore */
  }
}

export function loadCache(user: string): AppData | null {
  try {
    const raw = localStorage.getItem(cacheKey(user));
    return raw ? (JSON.parse(raw) as AppData) : null;
  } catch {
    return null;
  }
}

export function saveCache(user: string, data: AppData): void {
  try {
    localStorage.setItem(cacheKey(user), JSON.stringify(data));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

// The last state this client synced with the server — the common ancestor for
// the three-way merge in lib/merge. `data` is stored screenshot-stripped;
// `updatedAt` is the server row's updated_at at that moment (the freshness
// token pushState checks before writing).
export interface SyncBase {
  data: AppData;
  updatedAt: string | null;
}

export function loadBase(user: string): SyncBase | null {
  try {
    const raw = localStorage.getItem(baseKey(user));
    if (!raw) return null;
    const base = JSON.parse(raw) as SyncBase;
    // Normalize a base stored by an older app version: the sync merge compares
    // fields against this ancestor, and a missing-vs-empty mismatch on a newly
    // added field would make an untouched local look edited and win the merge.
    base.data = migrateData(base.data);
    return base;
  } catch {
    return null;
  }
}

export function saveBase(user: string, base: SyncBase): void {
  try {
    localStorage.setItem(baseKey(user), JSON.stringify(base));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

// Bug-report screenshots are large base64 blobs kept local-only — strip them
// before writing state to the cloud so they don't bloat the jsonb row.
export function stripScreenshots(data: AppData): AppData {
  return {
    ...data,
    bugReports: (data.bugReports || []).map((b) => ({ ...b, screenshot: "" })),
  };
}

// Cloud state has no screenshot blobs; re-attach any we cached locally.
export function mergeScreenshots(server: AppData, cache: AppData | null): AppData {
  if (!cache) return server;
  const byId: Record<string, string | undefined> = {};
  (cache.bugReports || []).forEach((b) => { if (b.screenshot) byId[b.id] = b.screenshot; });
  server.bugReports = (server.bugReports || []).map((b) =>
    byId[b.id] ? { ...b, screenshot: byId[b.id] } : b,
  );
  return server;
}

// --- Local-only fallback auth (used when Supabase isn't configured) ---
//
// Passwords are stored as salted SHA-256 digests. This is an offline
// convenience gate, not real security — the logbook data itself sits
// unencrypted in localStorage — but salted digests at least aren't trivially
// reversible. Records written by older versions used an unsalted djb2 hash
// (no `salt` field); those are verified with the legacy hash on login and
// upgraded in place.

type LocalUsers = Record<string, { pass: string; salt?: string }>;

function loadLocalUsers(): LocalUsers {
  try { return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || "{}") as LocalUsers; }
  catch { return {}; }
}
function saveLocalUsers(u: LocalUsers) { localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(u)); }

function randomSalt(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  // crypto.subtle is only exposed in secure contexts (https / localhost);
  // fall back to the legacy hash rather than breaking auth entirely.
  if (typeof crypto === "undefined" || !crypto.subtle) return hashStr(salt + ":" + password);
  const data = new TextEncoder().encode(salt + ":" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const hasUser = (users: LocalUsers, name: string) =>
  Object.prototype.hasOwnProperty.call(users, name);

export async function localSignup(username: string, password: string): Promise<{ error?: string }> {
  const users = loadLocalUsers();
  if (hasUser(users, username)) return { error: "Username already exists. Try logging in." };
  const salt = randomSalt();
  users[username] = { pass: await hashPassword(password, salt), salt };
  saveLocalUsers(users);
  saveCache(username, emptyData());
  localStorage.setItem(LOCAL_SESSION_KEY, username);
  return {};
}

export async function localLogin(username: string, password: string): Promise<{ error?: string }> {
  const users = loadLocalUsers();
  if (!hasUser(users, username)) return { error: "No such user. Please sign up." };
  const rec = users[username];
  if (rec.salt) {
    if (rec.pass !== (await hashPassword(password, rec.salt))) return { error: "Incorrect password." };
  } else {
    // Legacy unsalted djb2 record — verify, then upgrade to a salted digest.
    if (rec.pass !== hashStr(password)) return { error: "Incorrect password." };
    const salt = randomSalt();
    users[username] = { pass: await hashPassword(password, salt), salt };
    saveLocalUsers(users);
  }
  localStorage.setItem(LOCAL_SESSION_KEY, username);
  return {};
}

export function localSession(): string | null {
  return localStorage.getItem(LOCAL_SESSION_KEY);
}

export function localLogout(): void {
  localStorage.removeItem(LOCAL_SESSION_KEY);
}
