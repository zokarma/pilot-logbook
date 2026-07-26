// Eval #5 — OCR scan parser (src/lib/scan.ts).
// Heuristic extraction from logbook pages and licence/medical documents, plus
// the Foundation-Models combiner. Accuracy-style: a golden set of synthetic
// OCR lines with known expected fields, plus behavioral checks.

import {
  parseFlightsFromOcr, parseDocumentFromOcr, combineFlights, combineDocument,
  sanitizeFmFlights, sanitizeFmDocument,
  LOW_CONFIDENCE, ScannedFlight, FmFlight,
} from "../src/lib/scan";
import { Suite } from "./harness";
import { ocrPage } from "./fixtures";

export function run(): Suite {
  const s = new Suite(7, "OCR scan parser (scan.ts)", "Newest data-entry path; heuristic accuracy and honest confidence flagging keep bad rows out of the logbook.");

  // ---- flights: golden page with a TC-style year/month header ----
  const page = ocrPage([
    "JULY 2026", // page header: month + year context, not a flight
    "17 C-GABC C172 CYNJ CYPK 1.2",
    "2026-07-10 CGABC C172 CYNJ CYPK 1.5",
    "18 BE76 C-GXYZ CYYZ CYOW 1.3 PIC",
    "19 C-FLYQ CZBB CYXX 0.9 dual received night",
    "Jul 5, 2026 N12345 C172 KBFI KPAE 2.0",
  ]);
  const flights = parseFlightsFromOcr([page]);

  s.check("header line is not mistaken for a flight", flights.length === 5);
  const [f1, f2, f3, f4, f5] = flights;

  s.check("day-only date combines with page header context", f1?.date?.value === "2026-07-17");
  s.check("day-only dates carry reduced confidence", (f1?.date?.confidence ?? 1) < 0.75);
  s.check("registration extracted", f1?.registration?.value === "C-GABC");
  s.check("aircraft type extracted and not misread as an airport", f1?.aircraftType?.value === "C172" && f1?.from?.value === "CYNJ" && f1?.to?.value === "CYPK");
  s.check("hours land in se for a single-engine type", f1?.se?.value === 1.2 && f1?.me === undefined);

  s.check("full in-row date parses at high confidence", f2?.date?.value === "2026-07-10" && (f2?.date?.confidence ?? 0) > 0.8);
  s.check("unhyphenated Canadian reg normalized to C-GABC", f2?.registration?.value === "C-GABC");

  s.check("multi-engine type routes hours to me, not se", f3?.me?.value === 1.3 && f3?.se === undefined);
  s.check("PIC keyword → Captain", f3?.loggedRole?.value === "Captain");
  s.check("route survives beside an ME type", f3?.from?.value === "CYYZ" && f3?.to?.value === "CYOW");

  s.check("'dual received' → Dual Received (not Dual Given)", f4?.loggedRole?.value === "Dual Received");
  s.check("'night' sets takeoff and landing to Night", f4?.takeoff?.value === "Night" && f4?.landing?.value === "Night");

  s.check("US N-number + K-prefix ICAOs parse", f5?.registration?.value === "N12345" && f5?.from?.value === "KBFI" && f5?.to?.value === "KPAE");

  // ---- golden-set field accuracy tally ----
  {
    const expected: [ScannedFlight | undefined, Record<string, unknown>][] = [
      [f1, { date: "2026-07-17", registration: "C-GABC", aircraftType: "C172", from: "CYNJ", to: "CYPK", se: 1.2 }],
      [f2, { date: "2026-07-10", registration: "C-GABC", aircraftType: "C172", from: "CYNJ", to: "CYPK", se: 1.5 }],
      [f3, { date: "2026-07-18", registration: "C-GXYZ", aircraftType: "BE76", from: "CYYZ", to: "CYOW", me: 1.3 }],
      [f4, { date: "2026-07-19", registration: "C-FLYQ", from: "CZBB", to: "CYXX", se: 0.9 }],
      [f5, { date: "2026-07-05", registration: "N12345", aircraftType: "C172", from: "KBFI", to: "KPAE", se: 2.0 }],
    ];
    let want = 0, got = 0;
    for (const [fl, exp] of expected) {
      for (const [k, v] of Object.entries(exp)) {
        want++;
        const cf = (fl as unknown as Record<string, { value?: unknown } | undefined>)?.[k];
        if (cf && cf.value === v) got++;
      }
    }
    const pct = Math.round((100 * got) / want);
    s.check("golden-set field accuracy ≥ 90%", pct >= 90, `${got}/${want} fields (${pct}%)`);
    s.probe("heuristic field accuracy on the golden set", `${got}/${want} expected fields extracted exactly (${pct}%)`);
  }

  // ---- positional hour filtering via fragments ----
  {
    const withFrags = ocrPage([
      "JULY 2026",
      {
        text: "20 C-GABC CYNJ CYPK 1.0 2.3",
        confidence: 0.95,
        frags: [
          { t: "20", x: 0.05 }, { t: "C-GABC", x: 0.15 }, { t: "CYNJ", x: 0.3 },
          { t: "CYPK", x: 0.4 }, { t: "1.0", x: 0.45 }, { t: "2.3", x: 0.8 },
        ],
      },
    ]);
    const [g] = parseFlightsFromOcr([withFrags]);
    s.check("fragment x-positions restrict hours to the right-hand columns", g?.se?.value === 2.3, `left-column "1.0" ignored, got se=${g?.se?.value}`);
  }

  // ---- context carry-forward across pages ----
  {
    const p1 = ocrPage(["JULY 2026", "10 C-GABC CYNJ CYPK 1.0"]);
    const p2 = ocrPage(["11 C-GABC CYPK CYNJ 1.1"]); // no header on page 2
    const out = parseFlightsFromOcr([p1, p2]);
    s.check("year/month header carries forward to later pages", out[1]?.date?.value === "2026-07-11");
  }

  // ---- rejection + confidence honesty ----
  {
    const junk = parseFlightsFromOcr([ocrPage(["JULY 2026", "C-GABC CYNJ CYPK"])]);
    s.check("a line with no date is not a flight", junk.length === 0);
    const noisy = parseFlightsFromOcr([ocrPage(["JULY 2026", { text: "22 C-GAAA CYNJ CYPK 1.0", confidence: 0.4 }])]);
    s.check("low OCR confidence pushes fields under the review threshold", (noisy[0]?.date?.confidence ?? 1) < LOW_CONFIDENCE);
    const instr = parseFlightsFromOcr([ocrPage(["JULY 2026", "Instructor J Smith 21 C-GPQR CYNJ CYNJ 1.1"])]);
    s.check("a bare 'Instructor <name>' does not flip the role to Dual Given", instr[0]?.loggedRole === undefined);
  }

  // ---- documents: PPL and medical ----
  {
    const ppl = parseDocumentFromOcr([ocrPage([
      "TRANSPORT CANADA",
      "PRIVATE PILOT LICENCE - AEROPLANE",
      "Licence No: A-123456",
      "Date of Issue: 15/03/2020",
    ])]);
    s.check("PPL recognized as the catalog type", ppl?.type?.value === "Private Pilot Licence (PPL)" && (ppl?.type?.confidence ?? 0) >= 0.85);
    s.check("licence number found near its label", ppl?.number?.value === "A-123456");
    s.check("labeled issue date parsed D/M/Y", ppl?.issueDate?.value === "2020-03-15");

    const med = parseDocumentFromOcr([ocrPage([
      "MEDICAL CERTIFICATE CATEGORY 1",
      "Date of Issue: 2026-07-02",
    ])]);
    s.check("Category 1 medical recognized", med?.type?.value === "Category 1 Medical");
    s.check("a lone issue date on a medical is treated as the exam date", med?.examDate?.value === "2026-07-02");

    const bare = parseDocumentFromOcr([ocrPage(["SOME CERTIFICATE", "2020-01-01", "2030-01-01"])]);
    s.check("two unlabeled dates → chronological issue/expiry guess", bare?.issueDate?.value === "2020-01-01" && bare?.expiryDate?.value === "2030-01-01");
    s.check("chronological guesses are flagged for review (< LOW_CONFIDENCE)", (bare?.issueDate?.confidence ?? 1) < LOW_CONFIDENCE);

    const unlabeled = parseDocumentFromOcr([ocrPage(["PILOT LICENCE WALLET CARD", "A-123456"])]);
    s.check("a bare number with no label nearby is not trusted", unlabeled?.number === undefined);
  }

  // ---- Foundation-Models combiner ----
  {
    const heur = parseFlightsFromOcr([ocrPage(["JULY 2026", "17 C-GABC C172 CYNJ CYPK 1.2", "18 C-GXYZ PA28 CYPK CYNJ 1.0"])]);
    const fm: FmFlight[] = [
      { date: "2026-07-17", registration: "C-GABC", aircraftType: "C152", se: 1.2, from: "CYNJ" },
    ];
    const out = combineFlights(fm, heur);
    const c = out[0];
    s.check("FM+heuristic agreement promotes confidence to 0.95", c?.se?.confidence === 0.95 && c?.from?.confidence === 0.95);
    s.check("FM/heuristic disagreement keeps the FM value at a visible 0.55", c?.aircraftType?.value === "C152" && c?.aircraftType?.confidence === 0.55);
    s.check("0.55 disagreement lands under the review threshold", 0.55 < LOW_CONFIDENCE);
    s.check("heuristic rows FM didn't claim still surface", out.length === 2 && out[1]?.registration?.value === "C-GXYZ");

    const d = combineDocument({ type: "Private Pilot Licence (PPL)", number: "A-123456" }, null);
    s.check("FM-only document fields arrive at 0.75", d?.type?.confidence === 0.75 && d?.number?.value === "A-123456");
  }

  // ---- cloud-extraction sanitizers (untrusted model JSON → safe FmFlight) ----
  {
    const flights = sanitizeFmFlights([
      { date: "17/07/2026", registration: "c-gabc ", se: "1.2", me: -5, xc: 99999, extraKey: "dropped", notes: "x".repeat(500) },
      "not an object",
      {},
      null,
    ]);
    s.check("sanitizer: only meaningful objects survive", flights.length === 1);
    const f = flights[0] as FmFlight & { extraKey?: string };
    s.check("sanitizer: dates normalized to YYYY-MM-DD", f.date === "2026-07-17");
    s.check("sanitizer: numeric strings coerced, negatives dropped, hours clamped", f.se === 1.2 && f.me === undefined && f.xc === 24);
    s.check("sanitizer: unknown keys never pass through", f.extraKey === undefined);
    s.check("sanitizer: long strings bounded", (f.notes ?? "").length <= 200);
    s.check("sanitizer: non-arrays yield empty", sanitizeFmFlights({ flights: [] }).length === 0);

    const big = sanitizeFmFlights(Array.from({ length: 200 }, () => ({ date: "2026-01-01" })));
    s.check("sanitizer: row count capped at 60", big.length === 60);

    const d = sanitizeFmDocument({ type: "Category 1 Medical", examDate: "02 Jul 2026", junk: 1 });
    s.check("sanitizer: document dates normalized, junk dropped", d?.examDate === "2026-07-02" && (d as Record<string, unknown>).junk === undefined);
    s.check("sanitizer: empty document → undefined", sanitizeFmDocument({ junk: true }) === undefined);
  }

  s.probe(
    "hour-column heuristics without fragments",
    "when Vision gives no fragment positions, only the FIRST decimal on the line is taken (as se or me) and dayHours/nightHours/ifrActual are never populated — multi-column hour rows lose everything but one value; the confirm sheet is doing the real safety work.",
  );

  return s;
}
