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
// Passwords are stored as PBKDF2-HMAC-SHA256 digests over a per-user random
// salt. This is an offline convenience gate, not real security — the logbook
// itself sits unencrypted in localStorage, so anyone with the unlocked device
// can read it regardless — but a KDF means a *stolen* digest can't be turned
// back into the password (which pilots reuse) with a wordlist in seconds, the
// way a bare SHA-256 can.
//
// Records carry an explicit `scheme` so the verifier always knows how a digest
// was produced. Three legacy shapes are still accepted, verified with their
// original algorithm and rehashed to the current one in place on success:
//   - no salt                → unsalted djb2 (oldest)
//   - salt, no scheme        → single-round salted SHA-256, or (if that fails)
//                              salted djb2 written in a non-secure context
// That last pair is why `scheme` exists: those two were indistinguishable, so
// an account created over plain http could never log in again once the app was
// served from https, where crypto.subtle appears and the digests stop matching.

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
type PassScheme = "pbkdf2-sha256";

type LocalUsers = Record<string, {
  pass: string;
  salt?: string;
  scheme?: PassScheme;
  iterations?: number;
}>;

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

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

function subtleCrypto(): SubtleCrypto | null {
  return typeof crypto !== "undefined" && crypto.subtle ? crypto.subtle : null;
}

// True when this browser can do real password hashing. crypto.subtle only
// exists in a secure context (https, localhost, and the capacitor:// shell),
// which covers every way this app actually ships.
export function localAuthAvailable(): boolean {
  return subtleCrypto() !== null;
}

async function pbkdf2(password: string, salt: string, iterations: number): Promise<string> {
  const subtle = subtleCrypto();
  if (!subtle) throw new Error("no-subtle");
  const key = await subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

// The one-round salted SHA-256 used by the previous version — verification only.
async function legacySha256(password: string, salt: string): Promise<string | null> {
  const subtle = subtleCrypto();
  if (!subtle) return null;
  return toHex(await subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + password)));
}

// Constant-time-ish comparison. Digests are public-ish (same localStorage the
// attacker already reads), so this is belt-and-braces, but it costs nothing.
function digestsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function makeRecord(password: string): Promise<LocalUsers[string]> {
  const salt = randomSalt();
  return {
    pass: await pbkdf2(password, salt, PBKDF2_ITERATIONS),
    salt,
    scheme: "pbkdf2-sha256",
    iterations: PBKDF2_ITERATIONS,
  };
}

const hasUser = (users: LocalUsers, name: string) =>
  Object.prototype.hasOwnProperty.call(users, name);

export async function localSignup(username: string, password: string): Promise<{ error?: string }> {
  const users = loadLocalUsers();
  if (hasUser(users, username)) return { error: "Username already exists. Try logging in." };
  if (!localAuthAvailable()) {
    // Refuse rather than write a weak digest we can't verify later. Only
    // reachable over plain http on a non-localhost host, which this app never
    // ships as; failing loudly beats silently creating a locked-out account.
    return { error: "A secure connection (https) is required to create a local account." };
  }
  users[username] = await makeRecord(password);
  saveLocalUsers(users);
  saveCache(username, emptyData());
  localStorage.setItem(LOCAL_SESSION_KEY, username);
  return {};
}

export async function localLogin(username: string, password: string): Promise<{ error?: string }> {
  const users = loadLocalUsers();
  if (!hasUser(users, username)) return { error: "No such user. Please sign up." };
  const rec = users[username];

  if (rec.scheme === "pbkdf2-sha256" && rec.salt) {
    const got = await pbkdf2(password, rec.salt, rec.iterations || PBKDF2_ITERATIONS);
    if (!digestsEqual(rec.pass, got)) return { error: "Incorrect password." };
    // Re-stretch if the iteration count has since been raised.
    if ((rec.iterations || 0) < PBKDF2_ITERATIONS) {
      users[username] = await makeRecord(password);
      saveLocalUsers(users);
    }
  } else {
    // --- legacy record: verify with the scheme that wrote it, then upgrade ---
    let ok = false;
    if (rec.salt) {
      const sha = await legacySha256(password, rec.salt);
      // Salted SHA-256, or the salted djb2 an insecure context used to write.
      ok = (sha !== null && digestsEqual(rec.pass, sha)) ||
        digestsEqual(rec.pass, hashStr(rec.salt + ":" + password));
    } else {
      ok = digestsEqual(rec.pass, hashStr(password)); // unsalted djb2
    }
    if (!ok) return { error: "Incorrect password." };
    // Upgrade to PBKDF2 — but only where we can compute one. Without
    // crypto.subtle we let the (correctly authenticated) pilot in and leave
    // the record on its legacy digest: never lock someone out of a legal
    // document over a rehash, and skipping it is no weaker than not trying.
    if (localAuthAvailable()) {
      users[username] = await makeRecord(password);
      saveLocalUsers(users);
    }
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
