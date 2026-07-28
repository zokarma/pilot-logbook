// Scan accuracy against REAL logbook pages.
//
//   npx tsx evals/scanAccuracy.live.ts
//
// Deliberately NOT part of `evals/run.ts`. That sweep is pure, offline and
// finishes in seconds; this one calls Anthropic, costs money, and depends on
// fixtures that must never be committed. Hence the `.live.` in the name — if
// you are adding it to run.ts, stop.
//
// What it measures: field-level precision/recall for every column, so a change
// to the prompt, schema, model or effort produces a number instead of a
// feeling. The golden set in scan.eval.ts is 29/29 on clean SYNTHETIC lines —
// a regression floor, not a claim about real scans. This closes that gap.
//
// It exercises the real pipeline end to end: the same request body the Edge
// Function sends (imported from extraction.ts, not copied), and the same
// sanitizeFm* guards the client runs before anything reaches the confirm sheet.
// What it skips is only the HTTP shell around it — auth, entitlement, size
// caps — which is why an API key is enough and no Supabase session is needed.
//
// Fixtures live in evals/fixtures/scans/ (gitignored — real pages are personal
// flight data). See the README there for the layout and labelling rules.
//
// Environment:
//   ANTHROPIC_API_KEY   required
//   SCAN_EVAL_DIR       fixture directory (default evals/fixtures/scans)
//   SCAN_EVAL_MODEL     override the model under test (default: the app's)
//   SCAN_EVAL_EFFORT    low|medium|high|xhigh|max — sweep this
//   SCAN_EVAL_ONLY      substring filter on fixture name
//   SCAN_EVAL_CONCURRENCY  parallel requests (default 3)
//   SCAN_EVAL_MIN_F1    exit non-zero if overall F1 falls below this
//   SCAN_EVAL_JSON      also write the full report here, for diffing runs
//   SCAN_EVAL_API_URL   override the endpoint (stub server, gateway, proxy)

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  sanitizeFmDocument,
  sanitizeFmFlights,
  type FmDocument,
  type FmFlight,
} from "../src/lib/scan";
import {
  buildExtractionRequest,
  DEFAULT_SCAN_MODEL,
  DOCUMENT_FIELDS,
  FLIGHT_FIELDS,
  readExtraction,
  type ImagePart,
  type ScanMode,
} from "../supabase/functions/scan-extract/extraction";
import {
  f1,
  newReport,
  overallTally,
  precision,
  recall,
  score,
  type Rec,
  type Report,
  type ScoreTarget,
  type Tally,
} from "./scanScoring";

/* ------------------------------ fixtures ------------------------------ */

const MEDIA_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf",
};

interface Truth {
  mode?: ScanMode;
  /** Extra image files for a multi-page fixture; defaults to the sibling image. */
  images?: string[];
  /** Columns to leave out of scoring — e.g. a remarks column you didn't label. */
  ignoreFields?: string[];
  note?: string;
  flights?: Rec[];
  document?: Rec;
}

interface Fixture extends ScoreTarget {
  name: string;
  mode: ScanMode;
  images: ImagePart[];
}

function loadImage(dir: string, file: string): ImagePart {
  const media = MEDIA_BY_EXT[extname(file).toLowerCase()];
  if (!media) throw new Error(`unsupported image type: ${file}`);
  return { media, data: readFileSync(join(dir, file)).toString("base64") };
}

function loadFixtures(dir: string, only: string): Fixture[] {
  const truthFiles = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("example"));
  const out: Fixture[] = [];

  for (const tf of truthFiles) {
    const name = basename(tf, ".json");
    if (only && !name.includes(only)) continue;

    const truth = JSON.parse(readFileSync(join(dir, tf), "utf8")) as Truth;
    const mode: ScanMode = truth.mode === "document" ? "document" : "flights";

    let files = truth.images ?? [];
    if (!files.length) {
      // Default: the image sitting next to the truth file, same basename.
      const sibling = readdirSync(dir).find(
        (f) => basename(f, extname(f)) === name && MEDIA_BY_EXT[extname(f).toLowerCase()],
      );
      if (!sibling) {
        console.warn(`  ! ${name}: no image found beside ${tf} — skipped`);
        continue;
      }
      files = [sibling];
    }

    const ignore = new Set(truth.ignoreFields ?? []);
    const base = mode === "flights" ? FLIGHT_FIELDS : DOCUMENT_FIELDS;
    const rows = mode === "flights" ? (truth.flights ?? []) : truth.document ? [truth.document] : [];

    out.push({
      name,
      mode,
      images: files.map((f) => loadImage(dir, f)),
      truth: rows,
      fields: base.filter((f) => !ignore.has(f)),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------ the run ------------------------------ */

async function extract(
  fixture: Fixture,
  apiKey: string,
  model: string,
  effort: string | undefined,
): Promise<{ rows: Rec[]; usage: { input: number; output: number } }> {
  const body = buildExtractionRequest(fixture.mode, fixture.images, { model, effort });

  // Overridable so the report path can be exercised against a stub without
  // spending anything, and so a gateway/proxy can be pointed at.
  const url = process.env.SCAN_EVAL_API_URL || "https://api.anthropic.com/v1/messages";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // A 400 here is most likely the schema being rejected — the one failure
    // mode that breaks every scan in production, so say so plainly.
    throw new Error(`HTTP ${res.status}${res.status === 400 ? " (schema rejected?)" : ""}: ${detail.slice(0, 300)}`);
  }

  const payload = await res.json();
  const usage = {
    input: payload?.usage?.input_tokens ?? 0,
    output: payload?.usage?.output_tokens ?? 0,
  };

  const result = readExtraction(payload);
  if (!result.ok) throw new Error(`extraction ${result.reason}${result.detail ? ` (${result.detail})` : ""}`);

  // Through the app's own guards, so we score what would actually be stored.
  const rows: Rec[] =
    fixture.mode === "flights"
      ? (sanitizeFmFlights(result.value.flights) as FmFlight[] as unknown as Rec[])
      : ((): Rec[] => {
          const d = sanitizeFmDocument(result.value.document) as FmDocument | undefined;
          return d ? [d as unknown as Rec] : [];
        })();

  return { rows, usage };
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/* ------------------------------ reporting ------------------------------ */

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// An empty denominator scores 1 so a column nobody labelled can't drag the
// aggregate down — but printing "100.0%" next to zero correct reads as a pass.
// Show it as "—": there was nothing to get right.
const rate = (value: number, denom: number) => (denom ? pct(value) : "—");
const precDenom = (t: Tally) => t.correct + t.wrong + t.spurious;
const recallDenom = (t: Tally) => t.correct + t.wrong + t.missed;

// Indicative only — $/MTok, standard tier, sourced 2026-07. Tokens are the
// durable number; treat cost as a sanity check, not an invoice.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

function printReport(r: Report, model: string, effort: string | undefined, fixtures: number): number {
  const overall = overallTally(r);

  console.log(`\n${"=".repeat(74)}`);
  console.log(`SCAN ACCURACY — ${model}${effort ? ` @ effort=${effort}` : ""} — ${fixtures} fixture(s)`);
  console.log("=".repeat(74));

  console.log(
    `\nRows: ${r.rows.matched} matched, ${r.rows.missed} missed (never extracted), ` +
      `${r.rows.spurious} spurious (invented)`,
  );

  // Worst first — that's the column to go fix.
  const ranked = [...r.fields.entries()].sort((a, b) => f1(a[1]) - f1(b[1]));
  console.log(`\n${"field".padEnd(14)}${"ok".padStart(5)}${"wrong".padStart(7)}${"miss".padStart(6)}${"spur".padStart(6)}${"prec".padStart(8)}${"recall".padStart(8)}${"F1".padStart(8)}`);
  console.log("-".repeat(74));
  for (const [field, t] of ranked) {
    if (!t.correct && !t.wrong && !t.missed && !t.spurious) continue;
    console.log(
      field.padEnd(14) +
        String(t.correct).padStart(5) + String(t.wrong).padStart(7) +
        String(t.missed).padStart(6) + String(t.spurious).padStart(6) +
        rate(precision(t), precDenom(t)).padStart(8) +
        rate(recall(t), recallDenom(t)).padStart(8) +
        pct(f1(t)).padStart(8),
    );
  }
  console.log("-".repeat(74));
  console.log(
    "OVERALL".padEnd(14) +
      String(overall.correct).padStart(5) + String(overall.wrong).padStart(7) +
      String(overall.missed).padStart(6) + String(overall.spurious).padStart(6) +
      pct(precision(overall)).padStart(8) + pct(recall(overall)).padStart(8) + pct(f1(overall)).padStart(8),
  );

  // The confirm sheet only helps if its highlights land on real errors.
  const { flagged, wrong, flaggedAndWrong } = r.flags;
  console.log("\nReview flags (`uncertain` → highlighted in the confirm sheet):");
  if (!flagged && !wrong) {
    console.log("  nothing flagged and nothing wrong — no signal either way");
  } else {
    console.log(
      `  precision ${flagged ? pct(flaggedAndWrong / flagged) : "n/a"} ` +
        `— of ${flagged} flagged field(s), ${flaggedAndWrong} were actually wrong`,
    );
    console.log(
      `  recall    ${wrong ? pct(flaggedAndWrong / wrong) : "n/a"} ` +
        `— of ${wrong} wrong field(s), ${flaggedAndWrong} were flagged for the pilot`,
    );
    if (wrong && flaggedAndWrong / wrong < 0.5) {
      console.log("  ⚠ most errors reach the pilot unflagged — the sheet looks trustworthy when it isn't");
    }
  }

  const price = PRICES[model];
  const cost = price ? (r.usage.input * price.in + r.usage.output * price.out) / 1e6 : null;
  console.log(
    `\nTokens: ${r.usage.input.toLocaleString()} in, ${r.usage.output.toLocaleString()} out` +
      (cost === null ? "" : ` — ~$${cost.toFixed(3)} at list price`),
  );

  if (r.errors.length) {
    console.log(`\nErrors (${r.errors.length}):`);
    for (const e of r.errors) console.log(`  ✗ ${e}`);
  }

  return f1(overall);
}

/* ------------------------------ main ------------------------------ */

const SETUP = `
No fixtures yet. To create the golden set:

  mkdir -p evals/fixtures/scans

For each real logbook page, drop in two files with the same basename:

  evals/fixtures/scans/tc-1998-p12.jpg     the photo, as the app would send it
  evals/fixtures/scans/tc-1998-p12.json    what it SHOULD extract

See evals/fixtures/scans/README.md for the truth-file format and the labelling
rules. The directory is gitignored — real pages are personal flight data and
must never be committed.
`;

async function main(): Promise<void> {
  const dir = process.env.SCAN_EVAL_DIR ?? join("evals", "fixtures", "scans");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.SCAN_EVAL_MODEL || DEFAULT_SCAN_MODEL;
  const effort = process.env.SCAN_EVAL_EFFORT || undefined;
  const only = process.env.SCAN_EVAL_ONLY ?? "";
  const concurrency = Number(process.env.SCAN_EVAL_CONCURRENCY ?? 3) || 3;

  if (!existsSync(dir)) { console.log(SETUP); return; }

  const fixtures = loadFixtures(dir, only);
  if (!fixtures.length) { console.log(SETUP); return; }

  if (!apiKey) {
    console.log(
      `\nFound ${fixtures.length} fixture(s) in ${dir}, but ANTHROPIC_API_KEY is not set.\n` +
        `This eval calls the real API and costs money:\n\n` +
        `  ANTHROPIC_API_KEY=sk-ant-… npx tsx evals/scanAccuracy.live.ts\n`,
    );
    return;
  }

  console.log(`Scanning ${fixtures.length} fixture(s) with ${model}${effort ? ` @ effort=${effort}` : ""}…`);

  const report = newReport();
  await pool(fixtures, concurrency, async (fixture) => {
    try {
      const { rows, usage } = await extract(fixture, apiKey, model, effort);
      report.usage.input += usage.input;
      report.usage.output += usage.output;
      score(report, fixture, rows);
      console.log(`  ✓ ${fixture.name} — ${rows.length} row(s) from ${fixture.truth.length} labelled`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.errors.push(`${fixture.name}: ${msg}`);
      console.log(`  ✗ ${fixture.name} — ${msg}`);
    }
  });

  const overallF1 = printReport(report, model, effort, fixtures.length);

  if (process.env.SCAN_EVAL_JSON) {
    writeFileSync(
      process.env.SCAN_EVAL_JSON,
      JSON.stringify(
        {
          model, effort, at: new Date().toISOString(),
          overallF1,
          fields: Object.fromEntries(
            [...report.fields].map(([f, t]) => [f, { ...t, precision: precision(t), recall: recall(t), f1: f1(t) }]),
          ),
          rows: report.rows, flags: report.flags, usage: report.usage, errors: report.errors,
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${process.env.SCAN_EVAL_JSON}`);
  }

  const min = Number(process.env.SCAN_EVAL_MIN_F1 ?? NaN);
  if (report.errors.length) {
    console.log("\nRESULT: fixtures failed to extract — see errors above");
    process.exitCode = 1;
  } else if (isFinite(min) && overallF1 < min) {
    console.log(`\nRESULT: overall F1 ${pct(overallF1)} is below SCAN_EVAL_MIN_F1 ${pct(min)}`);
    process.exitCode = 1;
  } else {
    console.log("\nRESULT: complete");
  }
}

void main();
