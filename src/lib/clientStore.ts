// Browser-side persistence helpers. The Supabase-backed API routes are the
// primary store; this localStorage layer is (a) an offline mirror, (b) where
// bug-report screenshots live (they're never sent to the cloud), and (c) a
// full local-only fallback when Supabase isn't configured.

import { AppData, emptyData } from "./types";
import { hashStr } from "./hash";

const cacheKey = (u: string) => "plb_cache_" + u;
const LOCAL_USERS_KEY = "plb_local_users";
const LOCAL_SESSION_KEY = "plb_local_session";

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

// Server bug rows have no screenshot blob; re-attach any we cached locally.
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

type LocalUsers = Record<string, { pass: string }>;

function loadLocalUsers(): LocalUsers {
  try { return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || "{}") as LocalUsers; }
  catch { return {}; }
}
function saveLocalUsers(u: LocalUsers) { localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(u)); }

export function localSignup(username: string, password: string): { error?: string } {
  const users = loadLocalUsers();
  if (users[username]) return { error: "Username already exists. Try logging in." };
  users[username] = { pass: hashStr(password) };
  saveLocalUsers(users);
  saveCache(username, emptyData());
  localStorage.setItem(LOCAL_SESSION_KEY, username);
  return {};
}

export function localLogin(username: string, password: string): { error?: string } {
  const users = loadLocalUsers();
  if (!users[username]) return { error: "No such user. Please sign up." };
  if (users[username].pass !== hashStr(password)) return { error: "Incorrect password." };
  localStorage.setItem(LOCAL_SESSION_KEY, username);
  return {};
}

export function localSession(): string | null {
  return localStorage.getItem(LOCAL_SESSION_KEY);
}

export function localLogout(): void {
  localStorage.removeItem(LOCAL_SESSION_KEY);
}
