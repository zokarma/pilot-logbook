"use client";

// Browser Supabase client using the PUBLIC anon/publishable key. This key is
// safe to ship to the browser — it respects Row Level Security, so a user can
// only ever read/write their own rows. There is no service-role/secret key in
// this app anymore. Returns null (→ local-only mode) when env isn't configured.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let checked = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (checked) return client;
  checked = true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

export function supabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
