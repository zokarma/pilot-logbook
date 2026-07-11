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
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AppData, emptyData } from "@/lib/types";
import { migrateData } from "@/lib/migrate";
import { deepEqual, mergeAppData, sameStamp, stampChanges } from "@/lib/merge";
import { getSupabaseClient, supabaseConfigured } from "@/lib/supabaseClient";
import {
  loadCache, saveCache, loadBase, saveBase, SyncBase, mergeScreenshots, stripScreenshots,
  loadLastUser, saveLastUser, clearLastUser,
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

// Push logbook summary to the iOS home-screen widget via WidgetPlugin.
// Fire-and-forget: failures are silent (web browser has no plugin).
function writeWidgetData(data: AppData): void {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const plugin = cap?.Plugins?.Widget as
    | { setData: (d: Record<string, unknown>) => Promise<void> }
    | undefined;
  if (!plugin?.setData) return;

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const year  = today.slice(0, 4);
  const sum = (prefix: string) =>
    (data.flights ?? []).filter((f) => (f.date ?? "").startsWith(prefix))
      .reduce((t, f) => t + (f.se ?? 0) + (f.me ?? 0), 0);

  let nextExpiryLabel = "", nextExpiryDate = "", nextExpiryDays = -1;
  const now = Date.now();
  for (const doc of data.documents ?? []) {
    if (!doc.expiryDate) continue;
    const ms = new Date(doc.expiryDate).getTime();
    const days = Math.ceil((ms - now) / 86_400_000);
    if (days < 0) continue;
    if (nextExpiryDays < 0 || days < nextExpiryDays) {
      nextExpiryDays = days; nextExpiryDate = doc.expiryDate; nextExpiryLabel = doc.type ?? "";
    }
  }
  void plugin.setData({
    hoursToday: sum(today), hoursThisMonth: sum(month), hoursThisYear: sum(year),
    nextExpiryLabel, nextExpiryDate, nextExpiryDays,
  });
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
  const dataRef = useRef<AppData>(data);             // current state, readable mid-await
  const baseRef = useRef<SyncBase | null>(null);     // last synced server state (merge ancestor)
  const pushingRef = useRef(false);                  // a push is in flight
  const repushRef = useRef(false);                   // a push fired while one was in flight
  // uid whose mirror we showed at boot before Supabase restored the session.
  const optimisticRef = useRef<string | null>(null);

  // Write the current state to plb_app_state without clobbering another
  // client's changes. The blob is one row per user, so a blind upsert is
  // last-write-wins across devices; instead:
  //   1. probe the row's updated_at — if it moved since our last sync, another
  //      client wrote, so fetch its data and three-way merge (lib/merge)
  //      against baseRef (the state we last synced);
  //   2. write conditionally on the updated_at we just saw, so a write that
  //      races between our probe and our update loses cleanly and retries.
  // Even when two clients interleave, each converges on the union of both
  // sets of changes on its next push or load.
  const pushState = useCallback(async () => {
    const uid = uidRef.current;
    const sb = getSupabaseClient();
    if (!sb || !uid) return;
    if (pushingRef.current) { repushRef.current = true; return; }
    pushingRef.current = true;
    setSyncState("syncing");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = dataRef.current;
        const base = baseRef.current;
        const localStripped = stripScreenshots(snapshot);

        const { data: probe, error: probeErr } = await sb
          .from("plb_app_state").select("updated_at").eq("user_id", uid).maybeSingle();
        if (probeErr) { setSyncState("error"); return; }

        let serverStamp = (probe?.updated_at as string | null) ?? null;
        let toWrite = localStripped;
        let didMerge = false;

        if (probe && !sameStamp(serverStamp, base?.updatedAt)) {
          const { data: row, error } = await sb
            .from("plb_app_state").select("data, updated_at").eq("user_id", uid).maybeSingle();
          if (error) { setSyncState("error"); return; }
          serverStamp = (row?.updated_at as string | null) ?? null;
          const server = stripScreenshots(migrateData((row?.data as AppData) ?? emptyData()));
          toWrite = mergeAppData(base?.data ?? null, localStripped, server);
          didMerge = true;
        } else if (probe && base && deepEqual(localStripped, base.data)) {
          // Nothing changed since the last sync — skip the no-op write (it
          // would bump updated_at and force other clients into a fetch+merge).
          setSyncState("ok");
          return;
        }

        const newStamp = new Date().toISOString();
        let wrote: boolean;
        if (probe) {
          let q = sb.from("plb_app_state")
            .update({ data: toWrite, updated_at: newStamp })
            .eq("user_id", uid);
          q = serverStamp === null ? q.is("updated_at", null) : q.eq("updated_at", serverStamp);
          const { data: updated, error } = await q.select("user_id");
          if (error) { setSyncState("error"); return; }
          wrote = !!updated && updated.length > 0;
        } else {
          const { error } = await sb.from("plb_app_state")
            .insert({ user_id: uid, data: toWrite, updated_at: newStamp });
          if (error && error.code === "23505") wrote = false; // row appeared meanwhile
          else if (error) { setSyncState("error"); return; }
          else wrote = true;
        }
        if (!wrote) continue; // lost the race — re-probe and re-merge

        baseRef.current = { data: toWrite, updatedAt: newStamp };
        saveBase(uid, baseRef.current);
        if (didMerge) {
          // Fold the merged result back into the UI. If the user edited while
          // we were writing, merge those newer edits in too (their own push is
          // already queued and will persist them).
          setData((prev) => {
            const merged = prev === snapshot
              ? toWrite
              : mergeAppData(localStripped, stripScreenshots(prev), toWrite);
            const final = mergeScreenshots(structuredClone(merged), prev);
            dataRef.current = final;
            if (cacheKeyRef.current) saveCache(cacheKeyRef.current, final);
            return final;
          });
        }
        setSyncState("ok");
        return;
      }
      setSyncState("error"); // three straight write races — wait for the next change
    } catch {
      setSyncState("offline");
    } finally {
      pushingRef.current = false;
      if (repushRef.current) {
        repushRef.current = false;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { void pushState(); }, 600);
      }
    }
  }, []);

  // Persist: local cache immediately; cloud push (debounced) if signed in.
  const scheduleSync = useCallback((next: AppData) => {
    if (cacheKeyRef.current) saveCache(cacheKeyRef.current, next);
    writeWidgetData(next);
    if (!cloud || !uidRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void pushState(); }, 600);
  }, [cloud, pushState]);

  const mutate = useCallback((fn: (draft: AppData) => void) => {
    setData((prev) => {
      const draft: AppData = structuredClone(prev);
      fn(draft);
      // Stamp changed entities so concurrent edits resolve to the newest copy.
      stampChanges(prev, draft, new Date().toISOString());
      dataRef.current = draft;
      scheduleSync(draft);
      return draft;
    });
  }, [scheduleSync]);

  const replace = useCallback((next: AppData) => {
    setData((prev) => {
      stampChanges(prev, next, new Date().toISOString());
      dataRef.current = next;
      scheduleSync(next);
      return next;
    });
  }, [scheduleSync]);

  // Load a signed-in user's row from Supabase (RLS scopes it to them). Any
  // offline edits sitting in the local mirror are merged in — not discarded —
  // and pushed back up.
  const loadCloudState = useCallback(async (uid: string) => {
    const cache = loadCache(uid);
    const storedBase = loadBase(uid);
    const sb = getSupabaseClient();
    try {
      const { data: row, error } = await sb!
        .from("plb_app_state")
        .select("data, updated_at")
        .eq("user_id", uid)
        .maybeSingle();
      if (!error) {
        const server = stripScreenshots(migrateData((row?.data as AppData) ?? emptyData()));
        let merged = server;
        if (cache) {
          const local = stripScreenshots(migrateData(structuredClone(cache)));
          const base = storedBase ? migrateData(storedBase.data) : null;
          merged = mergeAppData(base, local, server);
        }
        baseRef.current = { data: server, updatedAt: (row?.updated_at as string | null) ?? null };
        saveBase(uid, baseRef.current);
        const final = mergeScreenshots(structuredClone(merged), cache);
        dataRef.current = final;
        setData(final);
        saveCache(uid, final); // keep the offline mirror warm
        setSyncState("ok");
        if (!deepEqual(merged, server)) {
          // The mirror held offline edits — push the merged result up.
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => { void pushState(); }, 600);
        }
      } else {
        const local = migrateData(cache ?? emptyData());
        baseRef.current = storedBase;
        dataRef.current = local;
        setData(local);
        setSyncState("error");
      }
    } catch {
      const local = migrateData(cache ?? emptyData());
      baseRef.current = storedBase;
      dataRef.current = local;
      setData(local);
      setSyncState("offline");
    }
    setReady(true);
  }, [pushState]);

  const applySession = useCallback((event: AuthChangeEvent, session: Session | null) => {
    const user = session?.user;
    if (user) {
      setCurrentUser(user.email ?? user.id);
      saveLastUser({ uid: user.id, email: user.email ?? user.id });
      if (uidRef.current !== user.id) {
        uidRef.current = user.id;
        cacheKeyRef.current = user.id;
        // Hold `ready` down while this user's row loads. Otherwise the layout
        // renders with the previous (empty) data — whose null profile briefly
        // flashes the onboarding wizard before the real state arrives.
        // Exception: we already booted from this same user's mirror — keep the
        // shell up and let loadCloudState merge the server row in behind it.
        if (optimisticRef.current !== user.id) setReady(false);
        optimisticRef.current = null;
        loadCloudState(user.id);
      } else {
        optimisticRef.current = null;
        setReady(true);
      }
    } else {
      // No session. If we booted from a remembered user's mirror and the
      // device is offline, keep the logbook open — a pilot must never be
      // locked out mid-trip because a token couldn't refresh. Supabase emits
      // again once connectivity returns.
      if (
        event !== "SIGNED_OUT" &&
        optimisticRef.current &&
        typeof navigator !== "undefined" &&
        !navigator.onLine
      ) {
        setReady(true);
        return;
      }
      if (event === "SIGNED_OUT") clearLastUser();
      optimisticRef.current = null;
      uidRef.current = null;
      cacheKeyRef.current = null;
      baseRef.current = null;
      setCurrentUser(null);
      const empty = emptyData();
      dataRef.current = empty;
      setData(empty);
      setSyncState(null);
      setReady(true);
    }
  }, [loadCloudState]);

  // Bootstrap: cloud → subscribe to Supabase Auth; local → read localStorage.
  useEffect(() => {
    if (cloud) {
      const sb = getSupabaseClient();
      if (!sb) { setReady(true); return; }
      // Mirror-first boot: if a remembered user has a local mirror, show it
      // NOW — before (or entirely without) the network. Startup goes from
      // network-bound to instant, and an offline launch still opens the
      // logbook. uidRef stays null, so nothing pushes to the cloud until the
      // real session confirms; edits land in the mirror and merge-sync later.
      const remembered = loadLastUser();
      if (remembered) {
        const cache = loadCache(remembered.uid);
        if (cache) {
          optimisticRef.current = remembered.uid;
          cacheKeyRef.current = remembered.uid;
          baseRef.current = loadBase(remembered.uid);
          const local = migrateData(cache);
          dataRef.current = local;
          setData(local);
          setCurrentUser(remembered.email);
          setSyncState("offline");
          setReady(true);
        }
      }
      const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
        applySession(event, session);
      });
      // Back online after offline edits → sync (pushState merges, so this
      // also pulls in anything other clients wrote meanwhile).
      const onOnline = () => {
        if (!uidRef.current) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { void pushState(); }, 600);
      };
      window.addEventListener("online", onOnline);
      return () => {
        sub.subscription.unsubscribe();
        window.removeEventListener("online", onOnline);
      };
    }
    // Local-only
    const u = localSession();
    if (u) {
      cacheKeyRef.current = u;
      setCurrentUser(u);
      const local = migrateData(loadCache(u) ?? emptyData());
      dataRef.current = local;
      setData(local);
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
    const local = migrateData(loadCache(identifier.trim()) ?? emptyData());
    dataRef.current = local;
    setData(local);
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
    const local = migrateData(loadCache(identifier.trim()) ?? emptyData());
    dataRef.current = local;
    setData(local);
    return {};
  }, [cloud]);

  const logout = useCallback(async () => {
    if (cloud) {
      const sb = getSupabaseClient();
      try { await sb?.auth.signOut(); } catch { /* ignore */ }
      // onAuthStateChange(SIGNED_OUT) normally clears state, but clear
      // explicitly too: during an offline mirror-first boot there is no live
      // session, so signOut may emit nothing.
      clearLastUser();
      optimisticRef.current = null;
      uidRef.current = null;
      cacheKeyRef.current = null;
      baseRef.current = null;
      setCurrentUser(null);
      const empty = emptyData();
      dataRef.current = empty;
      setData(empty);
      setSyncState(null);
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
