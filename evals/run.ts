// Eval runner — `npx tsx evals/run.ts`
// Runs every feature suite in importance order and prints a scoreboard.
// checks = hard assertions (failures are defects); probes = recorded behavior
// findings that feed EVALS.md.

import * as merge from "./merge.eval";
import * as migrate from "./migrate.eval";
import * as documents from "./documents.eval";
import * as csv from "./csv.eval";
import * as scan from "./scan.eval";
import * as pilots from "./pilots.eval";
import * as core from "./core.eval";
import * as dashboard from "./dashboard.eval";
import * as airports from "./airports.eval";
import { Suite } from "./harness";

const suites: Suite[] = [
  merge.run(), migrate.run(), documents.run(), csv.run(), scan.run(),
  pilots.run(), core.run(), dashboard.run(), airports.run(),
];

let totalPass = 0, totalFail = 0, totalProbes = 0;

for (const s of suites) {
  totalPass += s.passed; totalFail += s.failed; totalProbes += s.probes.length;
  const badge = s.failed === 0 ? "PASS" : "FAIL";
  console.log(`\n#${s.rank} ${s.feature} — ${badge} (${s.passed}/${s.cases.length} checks, ${s.probes.length} probes)`);
  for (const c of s.cases) {
    if (!c.ok) console.log(`   ✗ ${c.name}${c.note ? ` — ${c.note}` : ""}`);
  }
  for (const p of s.probes) console.log(`   ◆ probe: ${p.name} → ${p.observed}`);
}

console.log(`\n${"=".repeat(60)}`);
console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed, ${totalProbes} probes across ${suites.length} features`);
if (totalFail > 0) console.log("RESULT: FAILURES PRESENT — see ✗ lines above");
else console.log("RESULT: all checks green");
