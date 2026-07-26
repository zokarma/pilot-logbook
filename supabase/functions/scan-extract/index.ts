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
// Optional: SCAN_MODEL to override the default model.

import { createClient } from "jsr:@supabase/supabase-js@2";

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

const FLIGHTS_PROMPT = `You are extracting rows from a photo of a pilot's paper logbook (often a Transport Canada layout: year/month printed once as a header, one flight per row).

Return ONLY a JSON object, no prose, of the shape:
{"flights":[{"date":"YYYY-MM-DD","aircraftType":"C172","registration":"C-GABC","from":"CYNJ","to":"CYPK","loggedRole":"Captain","se":1.2,"me":0,"xc":1.2,"dayHours":1.2,"nightHours":0,"ifrActual":0,"ifrSim":0,"pic":"LAST, F","sic":"","notes":""}]}

Rules:
- One object per logbook row. Omit any field you cannot read — never guess.
- Numbers must be JSON numbers (decimal hours). Dates must be YYYY-MM-DD; derive year/month from page headers when rows only show the day.
- registration is the aircraft ident (e.g. C-GABC, N12345); from/to are ICAO codes.
- loggedRole one of: Captain, First Officer, Dual, Student, Dual Given, Dual Received, Instructor.
- If a page contains no logbook rows, return {"flights":[]}.`;

const DOCUMENT_PROMPT = `You are extracting fields from a photo of an aviation document (pilot licence, permit, medical certificate, or rating).

Return ONLY a JSON object, no prose, of the shape:
{"document":{"type":"Private Pilot Licence (PPL)","number":"A-123456","issueDate":"YYYY-MM-DD","examDate":"YYYY-MM-DD","expiryDate":"YYYY-MM-DD"}}

Rules:
- Omit any field you cannot read — never guess.
- Prefer these exact type values when they match: Student Pilot Permit (SPP), Private Pilot Licence (PPL), Commercial Pilot Licence (CPL), Airline Transport Pilot Licence (ATPL), Category 1 Medical, Category 3 Medical, Category 4 Medical, Radio Operator Certificate, Restricted Operator Certificate (Aeronautical), Instrument Rating, Multi-Engine Rating, Instructor Rating, Type Rating, Dangerous Goods Training, CRM Training, Recurrent Training. Otherwise use the document's own title.
- examDate is the medical examination date. Dates must be YYYY-MM-DD.`;

interface ImagePart {
  media: string;
  data: string;
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

// Pull the first JSON object out of the model's reply (tolerates code fences).
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(json)?/gi, "");
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  // Walk to the matching close brace so trailing prose doesn't break parsing.
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
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

  const content: unknown[] = images.map((img) =>
    img.media === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: img.media, data: img.data } }
      : { type: "image", source: { type: "base64", media_type: img.media, data: img.data } },
  );
  content.push({ type: "text", text: mode === "flights" ? FLIGHTS_PROMPT : DOCUMENT_PROMPT });

  const model = Deno.env.get("SCAN_MODEL") || "claude-sonnet-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("anthropic error", res.status, detail.slice(0, 500));
    const friendly = res.status === 429
      ? "Cloud AI is busy right now — try again in a minute."
      : "Cloud AI extraction failed.";
    return json({ error: friendly }, 502);
  }

  const payload = await res.json();
  const text = Array.isArray(payload?.content)
    ? payload.content.filter((c: { type?: string }) => c?.type === "text").map((c: { text?: string }) => c.text ?? "").join("\n")
    : "";
  const parsed = extractJson(text) as { flights?: unknown; document?: unknown } | null;
  if (!parsed) return json({ error: "Cloud AI returned no readable data for that image." }, 422);

  // The client re-sanitizes field-by-field (lib/scan sanitizers); this is just shape.
  return json(
    mode === "flights"
      ? { flights: Array.isArray(parsed.flights) ? parsed.flights : [] }
      : { document: parsed.document ?? null },
    200,
  );
});
