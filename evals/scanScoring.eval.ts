// Eval #26 — scan-accuracy scorer (evals/scanScoring.ts).
//
// The instrument, not the model. scanAccuracy.live.ts needs real logbook
// photos, an API key and money, so it can never run in this sweep — but the
// arithmetic it reports with is pure, and a scorer that miscounts would hand
// back a confident wrong number and get believed. This pins the counting rules,
// the row-alignment behavior, and the normalisation tolerances.

import {
  f1, newReport, overallTally, pairRows, precision, recall, score,
  type Rec, type ScoreTarget,
} from "./scanScoring";
import { Suite } from "./harness";

const FIELDS = ["date", "registration", "aircraftType", "from", "to", "se", "pic"] as const;
const target = (truth: Rec[], fields: readonly string[] = FIELDS): ScoreTarget => ({ truth, fields });

const ROW: Rec = {
  date: "2026-07-17", registration: "C-GABC", aircraftType: "C172",
  from: "CYNJ", to: "CYPK", se: 1.2, pic: "SMITH, J",
};

export function run(): Suite {
  const s = new Suite(
    26,
    "Scan-accuracy scorer (evals/scanScoring.ts)",
    "The measuring instrument for real-page accuracy — if it miscounts, every prompt/model decision downstream is made on a wrong number.",
  );

  // ---- the four outcomes a field can have ----
  {
    const r = newReport();
    score(r, target([ROW]), [{ ...ROW }]);
    const t = overallTally(r);
    s.check("an exact row scores every field correct", t.correct === 7 && t.wrong === 0 && t.missed === 0 && t.spurious === 0);
    s.check("an exact row counts as matched", r.rows.matched === 1 && r.rows.missed === 0 && r.rows.spurious === 0);
  }
  {
    const r = newReport();
    score(r, target([ROW]), [{ ...ROW, aircraftType: "PA28" }]);
    s.eq("a misread value is wrong, not missed", r.fields.get("aircraftType"), { correct: 0, wrong: 1, missed: 0, spurious: 0 });
  }
  {
    const r = newReport();
    // null is how the schema says "couldn't read it" — same as omitted.
    score(r, target([ROW]), [{ ...ROW, pic: null }]);
    s.eq("a field the model declined to read is missed", r.fields.get("pic"), { correct: 0, wrong: 0, missed: 1, spurious: 0 });
  }
  {
    const r = newReport();
    const blank: Rec = { ...ROW };
    delete blank.se;
    score(r, target([blank]), [{ ...ROW, se: 9.9 }]);
    s.eq("a value invented where the page is blank is spurious", r.fields.get("se"), { correct: 0, wrong: 0, missed: 0, spurious: 1 });
  }

  // ---- whole rows ----
  {
    const r = newReport();
    const second: Rec = { ...ROW, date: "2026-07-18", from: "CYPK", to: "CYNJ" };
    score(r, target([ROW, second]), [{ ...ROW }]);
    s.check("a row never extracted is counted missed", r.rows.missed === 1 && r.rows.matched === 1);
    s.check("a missed row loses every labelled field at once", (r.fields.get("date")?.missed ?? 0) === 1);

    const r2 = newReport();
    score(r2, target([ROW]), [{ ...ROW }, { ...second }]);
    s.check("a row the model invented is counted spurious", r2.rows.spurious === 1);
    s.check("an invented row is a false positive on each field it filled", (r2.fields.get("date")?.spurious ?? 0) === 1);
  }

  // ---- row alignment ----
  {
    const a: Rec = { ...ROW };
    const b: Rec = { ...ROW, date: "2026-07-18", registration: "C-GXYZ", se: 0.9 };
    // Predictions arrive in the opposite order: index-order matching would call
    // both rows wrong on every field.
    const { matched } = pairRows([a, b], [{ ...b }, { ...a }], FIELDS);
    s.check("rows pair on identity, not position", matched.length === 2);

    const r = newReport();
    score(r, target([a, b]), [{ ...b }, { ...a }]);
    const t = overallTally(r);
    s.check("out-of-order pages still score clean", t.wrong === 0 && t.missed === 0 && t.spurious === 0);

    // Nothing in common — pairing them would invent a comparison.
    const far: Rec = { date: "1999-01-01", registration: "C-FZZZ" };
    const { matched: none } = pairRows([a], [far], FIELDS);
    s.check("rows with nothing in common are not paired", none.length === 0);
  }

  // ---- normalisation: forgiving about form, strict about substance ----
  {
    const r = newReport();
    score(r, target([ROW]), [{
      ...ROW,
      se: 1.20,                 // same hours, different literal
      registration: "cgabc",    // cosmetic punctuation + case
      pic: "smith,   j",        // case + collapsed whitespace
    }]);
    const t = overallTally(r);
    s.check("cosmetic differences are not errors", t.correct === 7 && t.wrong === 0);

    const r2 = newReport();
    score(r2, target([ROW]), [{ ...ROW, se: 1.3 }]);
    s.check("a real difference in hours IS an error", (r2.fields.get("se")?.wrong ?? 0) === 1);
  }

  // ---- ignoreFields ----
  {
    const r = newReport();
    const fields = FIELDS.filter((f) => f !== "pic");
    score(r, target([ROW], fields), [{ ...ROW, pic: "WRONG NAME" }]);
    s.check("an unscored column cannot fail the run", r.fields.get("pic") === undefined && overallTally(r).wrong === 0);
  }

  // ---- review-flag calibration ----
  {
    const r = newReport();
    score(r, target([ROW]), [{
      ...ROW,
      aircraftType: "PA28",             // wrong AND flagged — the good case
      from: "CYYZ",                     // wrong and NOT flagged — reaches the pilot silently
      uncertain: ["aircraftType", "to"], // "to" flagged but actually correct
    }]);
    s.eq("flag calibration counts flagged/wrong/both", r.flags, { flagged: 2, wrong: 2, flaggedAndWrong: 1 });
    s.check("flag precision is measurable", r.flags.flaggedAndWrong / r.flags.flagged === 0.5);
    s.check("flag recall is measurable", r.flags.flaggedAndWrong / r.flags.wrong === 0.5);

    const r2 = newReport();
    score(r2, target([ROW]), [{ ...ROW, pic: null, uncertain: ["pic"] }]);
    s.check("flagging a field you didn't answer is not credited", r2.flags.flagged === 0 && r2.flags.wrong === 0);
  }

  // ---- the arithmetic ----
  {
    // Deliberately asymmetric (missed ≠ spurious) so precision and recall come
    // out different — equal counts would pass even if the denominators were
    // swapped. precision = 6/(6+2+0), recall = 6/(6+2+4).
    const t = { correct: 6, wrong: 2, missed: 4, spurious: 0 };
    s.check("precision excludes misses, recall excludes spurious", precision(t) === 0.75 && recall(t) === 0.5);
    s.check("F1 is the harmonic mean", Math.abs(f1(t) - 0.6) < 1e-12);
    s.check("a field nobody labelled is not a penalty", precision({ correct: 0, wrong: 0, missed: 0, spurious: 0 }) === 1);
    s.check("all-wrong scores zero, not NaN", f1({ correct: 0, wrong: 3, missed: 0, spurious: 0 }) === 0);
  }

  s.probe(
    "greedy pairing on near-identical rows",
    "rows are paired best-score-first, so two rows that genuinely share a date AND registration (a circuit session logged as several entries on one aircraft, same day) can pair against the wrong twin — the field tallies still count correctly in aggregate, but per-row attribution is arbitrary between them. Hours differ in those cases, which is what shows up as `wrong`. Label such pages with distinct notes/times, or accept the noise.",
  );

  s.probe(
    "what this suite cannot cover",
    "everything network-side of the scorer: that the extraction schema is one the API accepts, that stop_reason branches map to the right message, and the actual read accuracy on a page. Those need evals/scanAccuracy.live.ts, an API key, and real fixtures.",
  );

  return s;
}
