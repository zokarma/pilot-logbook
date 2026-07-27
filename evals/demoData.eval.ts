// Eval #23 — demo logbook (src/lib/demoData.ts).
// /demo is a public surface: a visitor's first look at the product is this
// data rendered by the real app. It must be deterministic (same page for
// everyone), internally consistent (hour splits that don't contradict the
// totals), and always "alive" — currency current and a document expiring soon,
// whenever the page happens to be visited.

import { buildDemoData } from "../src/lib/demoData";
import { totalHours, flightsForCurrentPilot } from "../src/lib/logbook";
import { builtinCurrencyStatuses } from "../src/lib/currency";
import { documentStatus } from "../src/lib/documents";
import { Suite } from "./harness";

export function run(): Suite {
  const s = new Suite(23, "Demo logbook (demoData.ts)", "The public /demo — a visitor's first impression of the product.");

  const today = new Date(2026, 6, 26);
  const d = buildDemoData(today);

  // -- determinism: everyone sees the same demo --
  s.check("same date in → byte-identical logbook", JSON.stringify(buildDemoData(today)) === JSON.stringify(d));
  s.check("ids are stable, not random", d.flights[0].id.startsWith("demo-f-"));

  // -- substance: enough data that the app looks used --
  s.check("a career's worth of flights", d.flights.length > 150);
  s.check("several aircraft types", new Set(d.flights.map((f) => f.aircraftType)).size >= 3);
  s.check("several registrations", new Set(d.flights.map((f) => f.registration)).size >= 4);
  s.check("meaningful total time", d.flights.reduce((x, f) => x + totalHours(f), 0) > 200);

  // -- consistency: the numbers must not contradict each other --
  {
    const mismatched = d.flights.filter((f) => Math.abs(f.dayHours + f.nightHours - totalHours(f)) > 0.051);
    s.check("day + night hours always equal the flight total", mismatched.length === 0, `${mismatched.length} bad`);
    const badLdg = d.flights.filter((f) => (f.landings ?? 1) < 1);
    s.check("every flight logs at least one landing", badLdg.length === 0);
    s.check("all flights belong to the demo pilot", flightsForCurrentPilot(d).length === d.flights.length);
    s.check("profile is onboarded (demo skips the wizard)", d.profile?.onboarded === true);
    s.check("demo skips the guided tour", d.profile?.tourSeen === true);
  }

  // -- alive: gauges and reminders must never render a dead-looking app --
  {
    const cur = builtinCurrencyStatuses(d);
    s.check("built-in currencies all read current", cur.length > 0 && cur.every((c) => c.ok), cur.filter((c) => !c.ok).map((c) => c.name).join(","));
    const statuses = d.documents.map((doc) => documentStatus(doc).status);
    s.check("at least one document is expiring soon (shows the reminder)", statuses.includes("expiring"));
    s.check("nothing is already expired (demo shouldn't look neglected)", !statuses.includes("expired"));
    s.check("a recurrent flight check is on file", d.documents.some((doc) => doc.type.includes("Proficiency Check")));
  }

  // -- relative dating: the demo ages with the calendar, never goes stale --
  {
    const later = buildDemoData(new Date(2027, 0, 15));
    s.check("dates follow `today` rather than being hardcoded", later.flights[0].date !== d.flights[0].date);
    const cur = builtinCurrencyStatuses(later);
    s.check("still current a year later", cur.every((c) => c.ok));
  }

  return s;
}
