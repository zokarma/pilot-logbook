// Supabase Edge Function: scan-extract
//
// Cloud half of the hybrid logbook scanner. The app's on-device OCR stays the
// default; when a signed-in pilot explicitly opts in (or scans from the
// website, which has no on-device OCR), the selected images/PDF are sent here
// and forwarded to Claude's vision API for structured extraction.
//
// - Auth: caller is identified from their own Supabase JWT — anonymous calls
//   are rejected, so the public anon key alone can't spend API credits.
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
const MAX_BYTES = 8 * 1024 * 1024; // per image, roughly (base64 length checked)

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

// "data:image/png;base64,AAAA" or bare base64 → {media, data}. PDFs allowed.
function parseImage(raw: unknown): ImagePart | null {
  if (typeof raw !== "string" || !raw) return null;
  const m = raw.match(/^data:([a-z0-9.+/-]+);base64,(.+)$/i);
  const media = m ? m[1].toLowerCase() : "image/jpeg";
  const data = m ? m[2] : raw;
  const ok = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"].includes(media);
  if (!ok || data.length > MAX_BYTES * 1.4) return null;
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

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Cloud AI is not configured (missing ANTHROPIC_API_KEY secret)." }, 503);

  let body: { mode?: string; images?: unknown[] };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const mode = body.mode === "document" ? "document" : "flights";
  const images = (Array.isArray(body.images) ? body.images : [])
    .slice(0, MAX_IMAGES)
    .map(parseImage)
    .filter((p): p is ImagePart => p !== null);
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
