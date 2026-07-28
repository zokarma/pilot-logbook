// Supabase Edge Function: scan-extract
//
// Cloud half of the hybrid logbook scanner. The app's on-device OCR stays the
// default; when a signed-in pilot explicitly opts in (or scans from the
// website, which has no on-device OCR), the selected images/PDF are sent here
// and forwarded to Claude's vision API for structured extraction.
//
// - Auth: caller is identified from their own Supabase JWT — anonymous calls
//   are rejected, so the public anon key alone can't spend API credits.
// - Entitlement: cloud scanning is a PAID feature, so the tier is checked HERE,
//   server-side. The client hides the scan UI for free pilots, but a client
//   gate can't protect a resource that costs money — without this check any
//   signed-in free account could invoke the function directly and run up the
//   ANTHROPIC_API_KEY bill.
// - The ANTHROPIC_API_KEY lives ONLY in this function's secrets, never in the
//   app bundle.
// - Nothing is stored: images pass through to the model call and the JSON
//   result is returned. (Anthropic API data is not used for training.)
//
// Deploy:
//   supabase functions deploy scan-extract
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
// Optional: SCAN_MODEL to override the default model (must support structured
// outputs — the schema in extraction.ts is what keeps the response shape
// honest), and SCAN_EFFORT (low|medium|high|xhigh|max) to trade tokens for
// accuracy. Both are settable without a code change so the winning combination
// from `npx tsx evals/scanAccuracy.live.ts` can be adopted by secret alone.
//
// This file owns policy and transport — auth, entitlement, size caps, HTTP.
// WHAT is asked of the model (prompts, schema, reply handling) lives in
// extraction.ts, which the accuracy eval imports so it exercises this exact
// request instead of a copy that drifts.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildExtractionRequest,
  readExtraction,
  type ImagePart,
} from "./extraction.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MAX_IMAGES = 4;
const MAX_BYTES = 8 * 1024 * 1024;        // per image (decoded, approximated from base64 length)
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // per request, across all images
// Hard ceiling on the raw request body, checked BEFORE req.json() parses it.
// Without this, an authenticated caller can make the function buffer and parse
// an arbitrarily large body — memory pressure that costs us before a single
// per-image limit is ever consulted.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

// Days a lapsed/retriable subscription still counts — mirrors GRACE_DAYS in
// src/lib/entitlement.ts so the server and the client agree about who's premium.
const GRACE_MS = 3 * 86400000;

// Does this plb_entitlements row grant a paid tier right now? Deliberately a
// small, self-contained mirror of effectiveTier() in src/lib/entitlement.ts
// (Edge Functions can't import from src/). Keep the two in step — and keep this
// one FAIL-CLOSED: anything unrecognised reads as not-premium.
function grantsPremium(row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  const tier = row.tier;
  if (tier !== "pro" && tier !== "professional") return false;

  const status = row.status;
  const rawEnd = row.current_period_end;
  const end = typeof rawEnd === "string" ? Date.parse(rawEnd) : NaN;
  const within = isNaN(end) ? null : Date.now() <= end + GRACE_MS;

  // Active-ish: valid unless the paid period (+grace) has already passed.
  if (status === "active" || status === "trialing" || status === "past_due") {
    return within === null ? true : within;
  }
  // Canceled: honour the remainder of the period they already paid for.
  if (status === "canceled") return within === true;
  return false;
}

const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
// Strict base64: the alphabet plus optional padding, nothing else. Anything
// that isn't valid base64 can only ever be rejected downstream by Anthropic —
// at our expense — so it is refused here instead of being forwarded.
const BASE64_ONLY = /^[A-Za-z0-9+/]+={0,2}$/;

// "data:image/png;base64,AAAA" or bare base64 → {media, data}. PDFs allowed.
function parseImage(raw: unknown): ImagePart | null {
  if (typeof raw !== "string" || !raw) return null;
  const m = raw.match(/^data:([a-z0-9.+/-]+);base64,(.+)$/i);
  const media = m ? m[1].toLowerCase() : "image/jpeg";
  const data = (m ? m[2] : raw).replace(/\s+/g, "");
  if (!ALLOWED_MEDIA.includes(media)) return null;
  // base64 inflates by 4/3; compare decoded size against the per-image cap.
  if (data.length * 3 / 4 > MAX_BYTES) return null;
  if (!BASE64_ONLY.test(data)) return null;
  return { media, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  // Caller must be a real signed-in user (their own JWT).
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Invalid or expired session" }, 401);

  // Paid-feature gate. Read through the CALLER's client: RLS
  // (entitlements_select_own) means they can only ever see their own row, so
  // the answer can't be forged — and the row itself is written solely by the
  // stripe-webhook service role. Fail closed on a read error: we'd rather
  // refuse a scan than hand out API credits on a database blip.
  const { data: entRow, error: entErr } = await userClient
    .from("plb_entitlements")
    .select("tier, status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  if (entErr) {
    console.error("entitlement lookup failed", entErr.message);
    return json({ error: "Could not verify your subscription — please try again." }, 503);
  }
  if (!grantsPremium(entRow as Record<string, unknown> | null)) {
    return json({ error: "AI scanning is a Pro feature. Upgrade at /pricing to enable it.", code: "upgrade_required" }, 402);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Cloud AI is not configured (missing ANTHROPIC_API_KEY secret)." }, 503);

  // Reject an oversized body before parsing it.
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (declaredLen > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);

  let body: { mode?: string; images?: unknown[] };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "Invalid JSON body" }, 400);

  const mode = body.mode === "document" ? "document" : "flights";
  const images: ImagePart[] = [];
  let totalBytes = 0;
  for (const raw of (Array.isArray(body.images) ? body.images : []).slice(0, MAX_IMAGES)) {
    const part = parseImage(raw);
    if (!part) continue;
    totalBytes += part.data.length * 3 / 4;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return json({ error: "Those pages add up to more than 20 MB — scan fewer at a time." }, 413);
    }
    images.push(part);
  }
  if (!images.length) return json({ error: "No usable images (JPEG/PNG/WebP/GIF or PDF, ≤8 MB each)." }, 400);

  // Request shape lives in extraction.ts so the accuracy eval can send exactly
  // this body — see evals/scanAccuracy.live.ts.
  const requestBody = buildExtractionRequest(mode, images, {
    model: Deno.env.get("SCAN_MODEL") || undefined,
    effort: Deno.env.get("SCAN_EFFORT") || undefined,
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("anthropic error", res.status, detail.slice(0, 500));
    const friendly = res.status === 429
      ? "Cloud AI is busy right now — try again in a minute."
      : "Cloud AI extraction failed.";
    return json({ error: friendly }, 502);
  }

  const result = readExtraction(await res.json());
  if (!result.ok) {
    // A 200 does not mean we got an answer. These used to fall through to the
    // parser, fail there, and surface as one generic "nothing readable" — which
    // sent pilots off to re-photograph a page that had scanned fine.
    if (result.reason === "refusal") {
      console.error("anthropic refusal", result.detail ?? "unknown");
      return json({ error: "Cloud AI declined to process that image. Try a different photo, or enter the details manually." }, 422);
    }
    if (result.reason === "truncated") {
      return json({ error: "That scan had more rows than one request can return — try one page at a time." }, 422);
    }
    return json({ error: "Cloud AI returned no readable data for that image." }, 422);
  }
  const parsed = result.value;

  // The client re-sanitizes field-by-field (lib/scan sanitizers); this is just shape.
  return json(
    mode === "flights"
      ? { flights: Array.isArray(parsed.flights) ? parsed.flights : [] }
      : { document: parsed.document ?? null },
    200,
  );
});
