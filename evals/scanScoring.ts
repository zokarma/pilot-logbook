// Scoring for the scan-accuracy eval: row alignment, field tallies,
// precision/recall, and review-flag calibration.
//
// Split out from scanAccuracy.live.ts on purpose. That file needs the network,
// an API key and fixtures nobody can commit; this one is pure, so the
// measuring instrument itself is verified offline by scanScoring.eval.ts in the
// normal sweep. A scorer with a bug in it is worse than no scorer — it reports
// a number, and numbers get believed.

export type Rec = Record<string, unknown> & { uncertain?: string[] };

export interface ScoreTarget {
  /** Columns being scored — a fixture's ignoreFields are already removed. */
  fields: readonly string[];
  truth: Rec[];
}

/* ------------------------------ comparison ------------------------------ */

export type Kind = "hours" | "reg" | "code" | "text";

export const KIND: Record<string, Kind> = {
  date: "code", aircraftType: "code", registration: "reg", loggedRole: "text",
  from: "code", to: "code",
  se: "hours", me: "hours", xc: "hours", dayHours: "hours",
  nightHours: "hours", ifrActual: "hours", ifrSim: "hours",
  notes: "text", pic: "text", sic: "text",
  type: "text", number: "code", issueDate: "code", examDate: "code", expiryDate: "code",
};

// Compare what the pilot would actually see, not raw model output: hours to the
// tenth (the resolution a logbook is written in), idents without cosmetic
// punctuation, names case-insensitively. A stricter comparison would report
// failures the app doesn't have.
export function norm(v: unknown, kind: Kind): string | number | undefined {
  if (v === undefined || v === null) return undefined;
  if (kind === "hours") {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isFinite(n) ? Math.round(n * 10) / 10 : undefined;
  }
  let s = String(v).trim().toUpperCase();
  if (kind === "reg") s = s.replace(/[^A-Z0-9]/g, "");
  if (kind === "text") s = s.replace(/\s+/g, " ");
  return s === "" ? undefined : s;
}

export const present = (v: unknown, field: string): boolean =>
  norm(v, KIND[field] ?? "text") !== undefined;

export const same = (a: unknown, b: unknown, field: string): boolean => {
  const kind = KIND[field] ?? "text";
  const na = norm(a, kind), nb = norm(b, kind);
  return na !== undefined && na === nb;
};

/* ------------------------------ row alignment ------------------------------ */

// How well do these two rows describe the same flight? Identity fields carry
// the weight — two rows on one page can share hours but not a date+registration.
export function rowScore(t: Rec, p: Rec, fields: readonly string[]): number {
  let score = 0;
  for (const f of fields) {
    if (t[f] === undefined || p[f] === undefined) continue;
    if (!same(t[f], p[f], f)) continue;
    score += f === "date" || f === "registration" ? 3 : 1;
  }
  return score;
}

export interface Pairing {
  matched: { t: Rec; p: Rec }[];
  missedRows: Rec[];
  spuriousRows: Rec[];
}

// Greedy best-first pairing. n is a page of rows (≤60), so O(n²) is free and
// beats index-order matching, which collapses the moment one row is missed:
// every later row would then be compared against its neighbour and score as
// wrong, turning one miss into a page of failures.
export function pairRows(truth: Rec[], pred: Rec[], fields: readonly string[]): Pairing {
  const pairs: { t: number; p: number; score: number }[] = [];
  truth.forEach((t, ti) =>
    pred.forEach((p, pi) => {
      const score = rowScore(t, p, fields);
      if (score > 0) pairs.push({ t: ti, p: pi, score });
    }),
  );
  pairs.sort((a, b) => b.score - a.score);

  const tUsed = new Set<number>(), pUsed = new Set<number>();
  const matched: { t: Rec; p: Rec }[] = [];
  for (const { t, p } of pairs) {
    if (tUsed.has(t) || pUsed.has(p)) continue;
    tUsed.add(t); pUsed.add(p);
    matched.push({ t: truth[t], p: pred[p] });
  }
  return {
    matched,
    missedRows: truth.filter((_, i) => !tUsed.has(i)),
    spuriousRows: pred.filter((_, i) => !pUsed.has(i)),
  };
}

/* ------------------------------ tallies ------------------------------ */

export interface Tally {
  correct: number;  // truth present, prediction agrees
  wrong: number;    // truth present, prediction present and different
  missed: number;   // truth present, prediction absent
  spurious: number; // truth absent, prediction present (invented)
}

export const newTally = (): Tally => ({ correct: 0, wrong: 0, missed: 0, spurious: 0 });

export const precision = (t: Tally): number => {
  const d = t.correct + t.wrong + t.spurious;
  return d ? t.correct / d : 1;
};
export const recall = (t: Tally): number => {
  const d = t.correct + t.wrong + t.missed;
  return d ? t.correct / d : 1;
};
export const f1 = (t: Tally): number => {
  const p = precision(t), r = recall(t);
  return p + r ? (2 * p * r) / (p + r) : 0;
};

export interface Report {
  fields: Map<string, Tally>;
  rows: { matched: number; missed: number; spurious: number };
  // Does `uncertain` point at the fields that are actually wrong? This is the
  // confirm sheet's whole value proposition, measured.
  flags: { flaggedAndWrong: number; flagged: number; wrong: number };
  errors: string[];
  usage: { input: number; output: number };
}

export const newReport = (): Report => ({
  fields: new Map(),
  rows: { matched: 0, missed: 0, spurious: 0 },
  flags: { flaggedAndWrong: 0, flagged: 0, wrong: 0 },
  errors: [],
  usage: { input: 0, output: 0 },
});

export function tallyOf(r: Report, field: string): Tally {
  let t = r.fields.get(field);
  if (!t) { t = newTally(); r.fields.set(field, t); }
  return t;
}

export function overallTally(r: Report): Tally {
  const overall = newTally();
  for (const t of r.fields.values()) {
    overall.correct += t.correct; overall.wrong += t.wrong;
    overall.missed += t.missed; overall.spurious += t.spurious;
  }
  return overall;
}

/* ------------------------------ scoring ------------------------------ */

export function score(r: Report, target: ScoreTarget, pred: Rec[]): void {
  const { matched, missedRows, spuriousRows } = pairRows(target.truth, pred, target.fields);
  r.rows.matched += matched.length;
  r.rows.missed += missedRows.length;
  r.rows.spurious += spuriousRows.length;

  for (const { t, p } of matched) {
    const flagged = new Set(p.uncertain ?? []);
    for (const f of target.fields) {
      const tally = tallyOf(r, f);
      const tHas = present(t[f], f);
      const pHas = present(p[f], f);

      if (tHas && pHas) same(t[f], p[f], f) ? tally.correct++ : tally.wrong++;
      else if (tHas) tally.missed++;
      else if (pHas) tally.spurious++;

      // Flag calibration only makes sense where the model committed to a value.
      if (!pHas) continue;
      const isWrong = !tHas || !same(t[f], p[f], f);
      if (isWrong) r.flags.wrong++;
      if (flagged.has(f)) {
        r.flags.flagged++;
        if (isWrong) r.flags.flaggedAndWrong++;
      }
    }
  }

  // A row the model never produced loses every labelled field; a row it
  // invented is a false positive on every field it filled in.
  for (const t of missedRows) {
    for (const f of target.fields) if (present(t[f], f)) tallyOf(r, f).missed++;
  }
  for (const p of spuriousRows) {
    for (const f of target.fields) if (present(p[f], f)) tallyOf(r, f).spurious++;
  }
}
