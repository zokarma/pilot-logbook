"use client";

// Read the signed-in user's premium entitlement, offline-first. The
// plb_entitlements row is written only by the server (stripe-webhook); here we
// just read our own row (RLS-scoped), cache it in localStorage, and interpret
// it via the pure helpers in lib/entitlement. Offline, we serve the cached
// value immediately and never block on the network — a paying pilot keeps
// premium in the air (the grace window in effectiveTier covers the gap).

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient, supabaseConfigured } from "@/lib/supabaseClient";
import {
  Entitlement, Feature, FREE, Tier, effectiveTier, entitlementFromRow,
  hasFeature, isPremium as isPrem,
} from "@/lib/entitlement";

const CACHE_PREFIX = "plb_entitlement_";

function readCache(uid: string): Entitlement | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + uid);
    return raw ? entitlementFromRow(JSON.parse(raw)) : null;
  } catch { return null; }
}
function writeCache(uid: string, e: Entitlement): void {
  try { localStorage.setItem(CACHE_PREFIX + uid, JSON.stringify(e)); } catch { /* ignore */ }
}

export interface UseEntitlement {
  entitlement: Entitlement;
  tier: Tier;
  isPremium: boolean;
  has: (f: Feature) => boolean;
  ready: boolean; // true once we've resolved (from cache or server)
}

export function useEntitlement(): UseEntitlement {
  const [ent, setEnt] = useState<Entitlement>(FREE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const sb = supabaseConfigured() ? getSupabaseClient() : null;
    if (!sb) { setReady(true); return; } // local-only mode: everyone is free

    async function load() {
      const { data: { user } } = await sb!.auth.getUser();
      if (!alive) return;
      if (!user) { setEnt(FREE); setReady(true); return; }

      const cached = readCache(user.id);
      if (cached) setEnt(cached);          // instant, offline-safe
      setReady(true);

      const { data, error } = await sb!
        .from("plb_entitlements").select("*").eq("user_id", user.id).maybeSingle();
      if (!alive || error) return;         // keep the cached value on a network error
      const fresh = data ? entitlementFromRow(data) : FREE;
      setEnt(fresh);
      writeCache(user.id, fresh);
    }

    void load();
    const { data: sub } = sb.auth.onAuthStateChange(() => { void load(); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const has = useCallback((f: Feature) => hasFeature(ent, f), [ent]);
  return { entitlement: ent, tier: effectiveTier(ent), isPremium: isPrem(ent), has, ready };
}
