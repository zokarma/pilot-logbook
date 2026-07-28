// The extraction contract for the cloud scanner: prompts, the structured-output
// schema, and how to read the model's reply. Pure and framework-free — no Deno
// globals, no jsr imports, no network — for one reason: the accuracy eval
// (evals/scanAccuracy.live.ts) imports this module and sends the SAME request
// body the Edge Function sends. A copy of the prompt in the eval would drift
// from the deployed one within a release and quietly start measuring a pipeline
// nobody runs.
//
// index.ts imports this as "./extraction.ts" (Deno wants the extension); the
// eval imports it without one (tsc rejects .ts specifiers). Same file.

export type ScanMode = "flights" | "document";

// Field names the model may flag in `uncertain`. Mirrors FmFlight / FmDocument
// in src/lib/scan.ts — the client re-checks the list against the same names.
export const FLIGHT_FIELDS = [
  "date", "aircraftType", "registration", "loggedRole", "from", "to",
  "se", "me", "xc", "dayHours", "nightHours", "ifrActual", "ifrSim",
  "notes", "pic", "sic",
] as const;
export const DOCUMENT_FIELDS = ["type", "number", "issueDate", "examDate", "expiryDate"] as const;

const LOGGED_ROLES = [
  "Captain", "First Officer", "Dual", "Student", "Dual Given", "Dual Received", "Instructor",
];

export const DEFAULT_SCAN_MODEL = "claude-sonnet-5";

// Thinking and response text share this budget, and thinking is on by default on
// current models. At the old 4096 a dense logbook page could spend the budget
// mid-JSON: the reply was then unparseable and the whole scan came back as
// "nothing readable" even though the page had been read correctly.
export const SCAN_MAX_TOKENS = 16000;

/* ------------------------------ schema ------------------------------ */
// Structured output makes the response shape a guarantee rather than a request
// — no prose, no code fences, no missing/renamed keys. Every property is
// required and nullable: the model says "couldn't read it" with an explicit
// null instead of dropping the key.
//
// Nullability is spelled with anyOf rather than a `type: [...]` union: both are
// valid JSON Schema, but anyOf is the form structured outputs documents as
// supported, and a schema the API rejects would 400 every scan. The vocabulary
// stays deliberately plain for the same reason — structured outputs rejects
// numeric/string constraints like minimum or maxLength, so value bounds stay
// where they already were, in the client's sanitizeFm* guards.
const nullableStr = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNum = { anyOf: [{ type: "number" }, { type: "null" }] };

const uncertainSchema = (fields: readonly string[]) => ({
  type: "array",
  description:
    "Names of fields above whose values you are NOT confident in. The pilot is shown these for review before anything is saved.",
  items: { type: "string", enum: [...fields] },
});

const FLIGHT_ITEM_SCHEMA = {
  type: "object",
  properties: {
    date: { ...nullableStr, description: "YYYY-MM-DD" },
    aircraftType: nullableStr,
    registration: { ...nullableStr, description: "Aircraft ident, e.g. C-GABC or N12345" },
    loggedRole: { anyOf: [{ type: "string", enum: LOGGED_ROLES }, { type: "null" }] },
    from: { ...nullableStr, description: "ICAO code" },
    to: { ...nullableStr, description: "ICAO code" },
    se: { ...nullableNum, description: "Single-engine hours (decimal)" },
    me: { ...nullableNum, description: "Multi-engine hours (decimal)" },
    xc: { ...nullableNum, description: "Cross-country hours (decimal)" },
    dayHours: nullableNum,
    nightHours: nullableNum,
    ifrActual: nullableNum,
    ifrSim: nullableNum,
    notes: nullableStr,
    pic: nullableStr,
    sic: nullableStr,
    uncertain: uncertainSchema(FLIGHT_FIELDS),
  },
  required: [...FLIGHT_FIELDS, "uncertain"],
  additionalProperties: false,
};

export const FLIGHTS_SCHEMA = {
  type: "object",
  properties: { flights: { type: "array", items: FLIGHT_ITEM_SCHEMA } },
  required: ["flights"],
  additionalProperties: false,
};

export const DOCUMENT_SCHEMA = {
  type: "object",
  properties: {
    document: {
      type: "object",
      properties: {
        type: nullableStr,
        number: nullableStr,
        issueDate: { ...nullableStr, description: "YYYY-MM-DD" },
        examDate: { ...nullableStr, description: "Medical examination date, YYYY-MM-DD" },
        expiryDate: { ...nullableStr, description: "YYYY-MM-DD" },
        uncertain: uncertainSchema(DOCUMENT_FIELDS),
      },
      required: [...DOCUMENT_FIELDS, "uncertain"],
      additionalProperties: false,
    },
  },
  required: ["document"],
  additionalProperties: false,
};

/* ------------------------------ prompts ------------------------------ */

export const FLIGHTS_PROMPT = `You are extracting rows from a photo of a pilot's paper logbook (often a Transport Canada layout: year/month printed once as a header, one flight per row).

Rules:
- One object per logbook row.
- Use null for any field that is not present or that you genuinely cannot make out. Do NOT guess a value to fill a hole.
- When you CAN read a field but are not confident in your reading — smudged digits, ambiguous handwriting, a column you had to infer — give your best reading anyway and list that field's name in "uncertain". The pilot reviews and confirms every scanned row before it is saved, so a flagged best guess is far more useful to them than a null.
- Numbers are decimal hours. Dates are YYYY-MM-DD; derive year/month from page headers when rows only show the day.
- registration is the aircraft ident (e.g. C-GABC, N12345); from/to are ICAO codes.
- If a page contains no logbook rows, return an empty flights array.`;

export const DOCUMENT_PROMPT = `You are extracting fields from a photo of an aviation document (pilot licence, permit, medical certificate, or rating).

Rules:
- Use null for any field that is not present or that you genuinely cannot make out. Do NOT guess a value to fill a hole.
- When you CAN read a field but are not confident in your reading, give your best reading anyway and list that field's name in "uncertain". The pilot confirms every scanned document before it is saved.
- Prefer these exact type values when they match: Student Pilot Permit (SPP), Private Pilot Licence (PPL), Commercial Pilot Licence (CPL), Airline Transport Pilot Licence (ATPL), Category 1 Medical, Category 3 Medical, Category 4 Medical, Radio Operator Certificate, Restricted Operator Certificate (Aeronautical), Instrument Rating, Multi-Engine Rating, Instructor Rating, Type Rating, Dangerous Goods Training, CRM Training, Recurrent Training. Otherwise use the document's own title.
- examDate is the medical examination date. Dates are YYYY-MM-DD.`;

/* ------------------------------ request ------------------------------ */

export interface ImagePart {
  media: string; // an ALLOWED_MEDIA value (index.ts owns that policy)
  data: string;  // bare base64, no data-URL prefix
}

export interface BuildOptions {
  model?: string;
  /** low | medium | high | xhigh | max. Omitted = the model's default. */
  effort?: string;
}

// The exact body sent to /v1/messages. Images first, instruction last.
export function buildExtractionRequest(
  mode: ScanMode,
  images: ImagePart[],
  opts: BuildOptions = {},
): Record<string, unknown> {
  const content: unknown[] = images.map((img) =>
    img.media === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: img.media, data: img.data } }
      : { type: "image", source: { type: "base64", media_type: img.media, data: img.data } },
  );
  content.push({ type: "text", text: mode === "flights" ? FLIGHTS_PROMPT : DOCUMENT_PROMPT });

  const output_config: Record<string, unknown> = {
    format: {
      type: "json_schema",
      schema: mode === "flights" ? FLIGHTS_SCHEMA : DOCUMENT_SCHEMA,
    },
  };
  if (opts.effort) output_config.effort = opts.effort;

  return {
    model: opts.model || DEFAULT_SCAN_MODEL,
    max_tokens: SCAN_MAX_TOKENS,
    output_config,
    messages: [{ role: "user", content }],
  };
}

/* ------------------------------ response ------------------------------ */

// Pull the first JSON object out of the model's reply (tolerates code fences).
// The schema makes this unnecessary in the normal case; it stays as a fallback
// for a SCAN_MODEL override on a model without structured-output support.
export function extractJson(text: string): unknown {
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

export type ExtractionResult =
  | { ok: true; value: { flights?: unknown; document?: unknown } }
  | { ok: false; reason: "refusal" | "truncated" | "unparseable"; detail?: string };

// A 200 does not mean we got an answer. Before this split out, a refusal and a
// truncated reply both fell through to the parser and surfaced as the same
// generic "nothing readable" — which sent pilots off to re-photograph a page
// that had scanned fine.
export function readExtraction(payload: unknown): ExtractionResult {
  const p = (payload ?? {}) as {
    stop_reason?: string;
    stop_details?: { category?: string } | null;
    content?: unknown;
  };

  if (p.stop_reason === "refusal") {
    return { ok: false, reason: "refusal", detail: p.stop_details?.category ?? "unknown" };
  }
  if (p.stop_reason === "max_tokens") return { ok: false, reason: "truncated" };

  const text = Array.isArray(p.content)
    ? p.content
        .filter((c: { type?: string }) => c?.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("\n")
    : "";

  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { parsed = extractJson(text); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "unparseable" };
  }
  return { ok: true, value: parsed as { flights?: unknown; document?: unknown } };
}
