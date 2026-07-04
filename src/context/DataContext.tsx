"use client";

// Owns the entire logbook state and its persistence. Supabase (via /api routes)
// is the primary store; a localStorage mirror provides offline resilience and
// holds bug-report screenshots. When Supabase isn't configured the whole thing
// runs local-only.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode,
} from "react";
import { AppData, BugReport, emptyData } from "@/lib/types";
import { migrateData } from "@/lib/migrate";
import {
  loadCache, saveCache, mergeScreenshots,
  localLogin, localSignup, localSession, localLogout,
} from "@/lib/clientStore";

export type SyncState = "ok" | "syncing" | "offline" | "error" | null;

interface DataCtx {
  ready: boolean;
  currentUser: string | null;
  cloud: boolean;
  syncState: SyncState;
  data: AppData;
  mutate: (fn: (draft: AppData) => void) => void;
  replace: (next: AppData) => void;
  login: (u: string, p: string) => Promise<{ error?: string }>;
  signup: (u: string, p: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  persistBug: (r: BugReport) => void;
  removeBug: (id: string) => void;
}

const Ctx = createContext<DataCtx | null>(null);

export function useData(): DataCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [cloud, setCloud] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>(null);
  const [data, setData] = useState<AppData>(emptyData());

  const cloudRef = useRef(false);
  const userRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push the full state to the cloud (debounced). Local cache is written immediately.
  const scheduleSync = useCallback((next: AppData) => {
    const user = userRef.current;
    if (user) saveCache(user, next);
    if (!cloudRef.current || !user) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSyncState("syncing");
      try {
        const res = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        setSyncState(res.ok ? "ok" : "error");
      } catch {
        setSyncState("offline");
      }
    }, 600);
  }, []);

  const commit = useCallback((next: AppData) => {
    setData(next);
    scheduleSync(next);
  }, [scheduleSync]);

  const mutate = useCallback((fn: (draft: AppData) => void) => {
    setData((prev) => {
      const draft: AppData = structuredClone(prev);
      fn(draft);
      scheduleSync(draft);
      return draft;
    });
  }, [scheduleSync]);

  const replace = useCallback((next: AppData) => commit(next), [commit]);

  const loadForUser = useCallback(async (user: string, isCloud: boolean) => {
    userRef.current = user;
    cloudRef.current = isCloud;
    setCurrentUser(user);
    setCloud(isCloud);
    const cache = loadCache(user);
    if (isCloud) {
      try {
        const res = await fetch("/api/state");
        if (res.ok) {
          const server = migrateData((await res.json()) as AppData);
          commit(mergeScreenshots(server, cache));
          setSyncState("ok");
          setReady(true);
          return;
        }
      } catch {
        setSyncState("offline");
      }
    }
    // Local-only, or cloud fetch failed: fall back to cache.
    setData(migrateData(cache || emptyData()));
    setReady(true);
  }, [commit]);

  // Bootstrap: figure out whether we're in cloud or local mode and who's logged in.
  useEffect(() => {
    (async () => {
      let isCloud = false;
      let user: string | null = null;
      try {
        const res = await fetch("/api/auth/session");
        const j = await res.json();
        isCloud = !!j.cloud;
        user = j.username || null;
      } catch {
        isCloud = false;
      }
      cloudRef.current = isCloud;
      setCloud(isCloud);
      if (!isCloud) user = localSession();
      if (user) {
        await loadForUser(user, isCloud);
      } else {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (u: string, p: string) => {
    if (cloudRef.current) {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      if (!res.ok) return { error: (await res.json()).error || "Login failed." };
      await loadForUser(u, true);
      return {};
    }
    const r = localLogin(u.trim(), p);
    if (r.error) return r;
    await loadForUser(u.trim(), false);
    return {};
  }, [loadForUser]);

  const signup = useCallback(async (u: string, p: string) => {
    if (cloudRef.current) {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      if (!res.ok) return { error: (await res.json()).error || "Sign up failed." };
      await loadForUser(u.trim(), true);
      return {};
    }
    const r = localSignup(u.trim(), p);
    if (r.error) return r;
    await loadForUser(u.trim(), false);
    return {};
  }, [loadForUser]);

  const logout = useCallback(async () => {
    if (cloudRef.current) {
      try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    } else {
      localLogout();
    }
    userRef.current = null;
    setCurrentUser(null);
    setData(emptyData());
    setSyncState(null);
  }, []);

  const persistBug = useCallback((r: BugReport) => {
    if (!cloudRef.current) return;
    fetch("/api/bugs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
    }).catch(() => { /* offline — local copy is source of truth */ });
  }, []);

  const removeBug = useCallback((id: string) => {
    if (!cloudRef.current) return;
    fetch(`/api/bugs?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }, []);

  return (
    <Ctx.Provider
      value={{
        ready, currentUser, cloud, syncState, data,
        mutate, replace, login, signup, logout, persistBug, removeBug,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
