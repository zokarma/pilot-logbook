"use client";

// Owns the entire logbook state and its persistence.
//
// Cloud mode (Supabase configured): real Supabase Auth (email/password) manages
// the session; the browser talks to the `plb_app_state` table directly with the
// PUBLIC anon key, and Row Level Security guarantees each user only ever sees
// their own row. There is NO service-role/secret key anywhere.
//
// Local-only mode (no Supabase env): auth + data live entirely in localStorage.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { AppData, emptyData } from "@/lib/types";
import { migrateData } from "@/lib/migrate";
import { getSupabaseClient, supabaseConfigured } from "@/lib/supabaseClient";
import {
  loadCache, saveCache, mergeScreenshots, stripScreenshots,
  localLogin, localSignup, localSession, localLogout,
} from "@/lib/clientStore";

export type SyncState = "ok" | "syncing" | "offline" | "error" | null;

interface AuthResult {
  error?: string;
  needsConfirmation?: boolean;
}

interface DataCtx {
  ready: boolean;
  currentUser: string | null;
  cloud: boolean;
  syncState: SyncState;
  data: AppData;
  mutate: (fn: (draft: AppData) => void) => void;
  replace: (next: AppData) => void;
  login: (identifier: string, password: string) => Promise<AuthResult>;
  signup: (identifier: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<{ error?: string }>;
}

const Ctx = createContext<DataCtx | null>(null);

export function useData(): DataCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const cloud = supabaseConfigured();
  const [ready, setReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(null);
  const [data, setData] = useState<AppData>(emptyData());

  // Refs so the debounced saver and auth listener see current values.
  const uidRef = useRef<string | null>(null);       // Supabase user id (cloud writes)
  const cacheKeyRef = useRef<string | null>(null);   // localStorage cache key
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist: local cache immediately; cloud upsert (debounced) if signed in.
  const scheduleSync = useCallback((next: AppData) => {
    if (cacheKeyRef.current) saveCache(cacheKeyRef.current, next);
    const uid = uidRef.current;
    if (!cloud || !uid) return;
    const sb = getSupabaseClient();
    if (!sb) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSyncState("syncing");
      try {
        const { error } = await sb.from("plb_app_state").upsert({
          user_id: uid,
          data: stripScreenshots(next),
          updated_at: new Date().toISOString(),
        });
        setSyncState(error ? "error" : "ok");
      } catch {
        setSyncState("offline");
      }
    }, 600);
  }, [cloud]);

  const mutate = useCallback((fn: (draft: AppData) => void) => {
    setData((prev) => {
      const draft: AppData = structuredClone(prev);
      fn(draft);
      scheduleSync(draft);
      return draft;
    });
  }, [scheduleSync]);

  const replace = useCallback((next: AppData) => {
    setData(next);
    scheduleSync(next);
  }, [scheduleSync]);

  // Load a signed-in user's row from Supabase (RLS scopes it to them).
  const loadCloudState = useCallback(async (uid: string) => {
    const cache = loadCache(uid);
    const sb = getSupabaseClient();
    try {
      const { data: row, error } = await sb!
        .from("plb_app_state")
        .select("data")
        .eq("user_id", uid)
        .maybeSingle();
      if (!error) {
        const server = migrateData((row?.data as AppData) ?? emptyData());
        const merged = mergeScreenshots(server, cache);
        setData(merged);
        saveCache(uid, merged); // keep the offline mirror warm
        setSyncState("ok");
      } else {
        setData(migrateData(cache ?? emptyData()));
        setSyncState("error");
      }
    } catch {
      setData(migrateData(cache ?? emptyData()));
      setSyncState("offline");
    }
    setReady(true);
  }, []);

  const applySession = useCallback((session: Session | null) => {
    const user = session?.user;
    if (user) {
      setCurrentUser(user.email ?? user.id);
      if (uidRef.current !== user.id) {
        uidRef.current = user.id;
        cacheKeyRef.current = user.id;
        loadCloudState(user.id);
      } else {
        setReady(true);
      }
    } else {
      uidRef.current = null;
      cacheKeyRef.current = null;
      setCurrentUser(null);
      setData(emptyData());
      setSyncState(null);
      setReady(true);
    }
  }, [loadCloudState]);

  // Bootstrap: cloud → subscribe to Supabase Auth; local → read localStorage.
  useEffect(() => {
    if (cloud) {
      const sb = getSupabaseClient();
      if (!sb) { setReady(true); return; }
      const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
        applySession(session);
      });
      return () => sub.subscription.unsubscribe();
    }
    // Local-only
    const u = localSession();
    if (u) {
      cacheKeyRef.current = u;
      setCurrentUser(u);
      setData(migrateData(loadCache(u) ?? emptyData()));
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (identifier: string, password: string): Promise<AuthResult> => {
    if (cloud) {
      const sb = getSupabaseClient()!;
      const { error } = await sb.auth.signInWithPassword({ email: identifier.trim(), password });
      if (error) return { error: error.message };
      return {}; // onAuthStateChange loads the state
    }
    const r = await localLogin(identifier.trim(), password);
    if (r.error) return r;
    cacheKeyRef.current = identifier.trim();
    setCurrentUser(identifier.trim());
    setData(migrateData(loadCache(identifier.trim()) ?? emptyData()));
    return {};
  }, [cloud]);

  const signup = useCallback(async (identifier: string, password: string): Promise<AuthResult> => {
    if (cloud) {
      const sb = getSupabaseClient()!;
      // Pin the confirmation-link redirect to the current origin's /login page.
      // Without this, Supabase falls back to the dashboard "Site URL", which has
      // leaked stale Vercel preview URLs into production emails. Landing on
      // /login (rather than / → /logger) also avoids a client-side redirect
      // racing detectSessionInUrl and dropping the auth token from the URL hash.
      const emailRedirectTo =
        typeof window !== "undefined" ? `${window.location.origin}/login/` : undefined;
      const { data: res, error } = await sb.auth.signUp({
        email: identifier.trim(),
        password,
        options: { emailRedirectTo },
      });
      if (error) return { error: error.message };
      if (!res.session) return { needsConfirmation: true }; // email confirmation is on
      return {};
    }
    const r = await localSignup(identifier.trim(), password);
    if (r.error) return r;
    cacheKeyRef.current = identifier.trim();
    setCurrentUser(identifier.trim());
    setData(migrateData(loadCache(identifier.trim()) ?? emptyData()));
    return {};
  }, [cloud]);

  const logout = useCallback(async () => {
    if (cloud) {
      const sb = getSupabaseClient();
      try { await sb?.auth.signOut(); } catch { /* ignore */ }
      // onAuthStateChange(SIGNED_OUT) clears state.
    } else {
      localLogout();
      cacheKeyRef.current = null;
      setCurrentUser(null);
      setData(emptyData());
    }
  }, [cloud]);

  // Permanently delete the signed-in account via the delete-account Edge
  // Function (which holds the service-role key server-side), then sign out.
  const deleteAccount = useCallback(async (): Promise<{ error?: string }> => {
    if (!cloud) return { error: "Account deletion is only available with cloud sync." };
    const sb = getSupabaseClient();
    if (!sb) return { error: "Not connected." };
    try {
      const { data: res, error } = await sb.functions.invoke("delete-account", { method: "POST" });
      if (error) return { error: error.message };
      if (res?.error) return { error: res.error };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Deletion failed." };
    }
    try { await sb.auth.signOut(); } catch { /* ignore */ }
    return {};
  }, [cloud]);

  return (
    <Ctx.Provider
      value={{ ready, currentUser, cloud, syncState, data, mutate, replace, login, signup, logout, deleteAccount }}
    >
      {children}
    </Ctx.Provider>
  );
}
