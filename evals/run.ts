// Eval runner — `npx tsx evals/run.ts`
// Runs every feature suite in importance order and prints a scoreboard.
// checks = hard assertions (failures are defects); probes = recorded behavior
// findings that feed EVALS.md.

import * as merge from "./merge.eval";
import * as migrate from "./migrate.eval";
import * as clientStore from "./clientStore.eval";
import * as documents from "./documents.eval";
import * as csv from "./csv.eval";
import * as importMap from "./importMap.eval";
import * as scan from "./scan.eval";
import * as currency from "./currency.eval";
import * as pilots from "./pilots.eval";
import * as core from "./core.eval";
import * as entitlement from "./entitlement.eval";
import * as dashboard from "./dashboard.eval";
import * as dutyLimits from "./dutyLimits.eval";
import * as pdf from "./pdf.eval";
import * as fleet from "./fleet.eval";
import * as logbook from "./logbook.eval";
import * as flightColumns from "./flightColumns.eval";
import * as airports from "./airports.eval";
import * as checkout from "./checkout.eval";
import * as claims from "./claims.eval";
import * as recentErrors from "./recentErrors.eval";
import * as notifications from "./notifications.eval";
import * as demoData from "./demoData.eval";
import { Suite } from "./harness";

// Most important first. Some suites are async (they set env or stub browser
// globals before importing the module under eval), so every runner is awaited.
const runners: (() => Suite | Promise<Suite>)[] = [
  merge.run, migrate.run, clientStore.run, documents.run, csv.run,
  importMap.run, scan.run, currency.run, pilots.run, core.run,
  entitlement.run, dashboard.run, dutyLimits.run, pdf.run, fleet.run,
  logbook.run, flightColumns.run, airports.run, checkout.run, claims.run,
  recentErrors.run, notifications.run, demoData.run,
];

async function main(): Promise<void> {
  const suites: Suite[] = [];
  for (const r of runners) suites.push(await r());

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
  if (totalFail > 0) {
    console.log("RESULT: FAILURES PRESENT — see ✗ lines above");
    process.exitCode = 1;
  } else {
    console.log("RESULT: all checks green");
  }
}

void main();
