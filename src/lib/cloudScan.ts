// Client bridge to the scan-extract Edge Function (cloud AI extraction).
//
// Opt-in only: the on-device pipeline (scanBridge.ts) stays the default in
// the iOS app; the website — which has no on-device OCR — uses this as its
// only scan engine. Requires cloud mode (Supabase configured) and a signed-in
// session; the function itself rejects anonymous calls.

import { getSupabaseClient, supabaseConfigured } from "./supabaseClient";
import { FmDocument, FmFlight, sanitizeFmDocument, sanitizeFmFlights } from "./scan";

export interface CloudScanResult {
  flights?: FmFlight[];
  document?: FmDocument;
}

export function cloudScanAvailable(): boolean {
  return supabaseConfigured();
}

export async function cloudExtract(
  mode: "flights" | "document",
  images: string[], // data URLs or bare base64 (JPEG/PNG/WebP/GIF/PDF)
): Promise<CloudScanResult> {
  const sb = getSupabaseClient();
  if (!sb) throw new Error("Cloud AI scanning needs cloud sync to be configured.");

  const { data, error } = await sb.functions.invoke("scan-extract", {
    body: { mode, images: images.slice(0, 4) },
  });
  if (error) {
    // FunctionsHttpError carries the function's JSON body in context.
    let detail = "";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try { detail = ((await ctx.json()) as { error?: string }).error ?? ""; } catch { /* opaque */ }
    }
    throw new Error(detail || "Cloud AI scan failed — check your connection and try again.");
  }

  const body = (data ?? {}) as { flights?: unknown; document?: unknown };
  return {
    flights: sanitizeFmFlights(body.flights),
    document: sanitizeFmDocument(body.document),
  };
}
