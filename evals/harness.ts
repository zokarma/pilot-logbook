// Tiny eval harness — no test framework in this repo, so suites are plain TS
// run with `npx tsx evals/run.ts`. Two kinds of results:
//   check(...)  — must pass; a failure is a defect in the code under eval.
//   probe(...)  — records observed behavior that is *worth knowing* but is not
//                 a pass/fail assertion (design limits, domain-accuracy gaps).
// Findings from both feed EVALS.md.

export interface CaseResult {
  name: string;
  ok: boolean;
  note?: string;
}

export interface ProbeResult {
  name: string;
  observed: string;
}

// Stable stringify (sorted keys) so deep comparisons ignore key order, same as
// the app's jsonb round-trips do.
export function stable(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    const keys = Object.keys(r).filter((k) => r[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(r[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "undefined";
}

export const deepEq = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
export const approx = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

export class Suite {
  cases: CaseResult[] = [];
  probes: ProbeResult[] = [];

  constructor(
    public rank: number,
    public feature: string,
    public why: string,
  ) {}

  check(name: string, ok: boolean, note?: string): void {
    this.cases.push({ name, ok, note });
  }

  eq(name: string, got: unknown, want: unknown): void {
    const ok = deepEq(got, want);
    this.cases.push({ name, ok, note: ok ? undefined : `got ${stable(got)} want ${stable(want)}` });
  }

  probe(name: string, observed: string): void {
    this.probes.push({ name, observed });
  }

  get passed(): number {
    return this.cases.filter((c) => c.ok).length;
  }
  get failed(): number {
    return this.cases.filter((c) => !c.ok).length;
  }
}
