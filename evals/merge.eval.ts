// Eval #1 — sync merge engine (src/lib/merge.ts).
// Highest-stakes feature: a wrong merge silently loses flights from a legal
// record. Cases mirror the real two-device sync flows DataContext drives.

import { mergeAppData, stampChanges, deepEqual, sameStamp } from "../src/lib/merge";
import { AppData } from "../src/lib/types";
import { Suite, deepEq } from "./harness";
import { mkData, mkFlight, mkPilot, clone, stampAt } from "./fixtures";

const ids = (d: AppData) => d.flights.map((f) => f.id).sort();

export function run(): Suite {
  const s = new Suite(1, "Sync merge engine (merge.ts)", "Two-device conflict resolution for a legal record — data loss here is the worst possible failure.");

  // -- offline adds on two devices union --
  {
    const base = mkData();
    const local = mkData({ flights: [mkFlight("f1", { updated_at: stampAt(1000) })] });
    const remote = mkData({ flights: [mkFlight("f2", { updated_at: stampAt(2000) })] });
    const out = mergeAppData(base, local, remote);
    s.eq("offline adds on two devices union", ids(out), ["f1", "f2"]);
  }

  // -- deletes propagate via the base (no tombstones) --
  {
    const f1 = mkFlight("f1", { updated_at: stampAt(0) });
    const base = mkData({ flights: [clone(f1)] });
    const localDeleted = mkData({ flights: [] });
    const remoteUnchanged = mkData({ flights: [clone(f1)] });
    s.eq("local delete propagates (remote unchanged)", ids(mergeAppData(base, localDeleted, remoteUnchanged)), []);
    s.eq("remote delete propagates (local unchanged)", ids(mergeAppData(base, remoteUnchanged, localDeleted)), []);
  }

  // -- an edit beats a delete, in both directions --
  {
    const f1 = mkFlight("f1", { updated_at: stampAt(0) });
    const base = mkData({ flights: [clone(f1)] });
    const edited = clone(f1);
    edited.notes = "1.2 corrected to 1.3 per journey log";
    edited.updated_at = stampAt(5000);
    const localEdit = mkData({ flights: [edited] });
    const remoteDelete = mkData({ flights: [] });
    const a = mergeAppData(base, localEdit, remoteDelete);
    s.check("local edit beats remote delete", a.flights.length === 1 && a.flights[0].notes.includes("corrected"));
    const b = mergeAppData(base, remoteDelete, localEdit);
    s.check("remote edit beats local delete", b.flights.length === 1 && b.flights[0].notes.includes("corrected"));
  }

  // -- concurrent edits: newer stamp wins --
  {
    const f1 = mkFlight("f1", { updated_at: stampAt(0) });
    const base = mkData({ flights: [clone(f1)] });
    const older = clone(f1); older.se = 1.1; older.updated_at = stampAt(1000);
    const newer = clone(f1); newer.se = 1.4; newer.updated_at = stampAt(9000);
    const a = mergeAppData(base, mkData({ flights: [older] }), mkData({ flights: [newer] }));
    s.check("remote newer stamp wins", a.flights[0].se === 1.4);
    const b = mergeAppData(base, mkData({ flights: [newer] }), mkData({ flights: [older] }));
    s.check("local newer stamp wins", b.flights[0].se === 1.4);
    const c = mergeAppData(base, mkData({ flights: [older] }), mkData({ flights: [clone(f1)] }));
    s.check("stamped edit beats stampless remote copy", c.flights[0].se === 1.1);
  }

  // -- equal-stamp conflict: does the merge converge on both devices? --
  {
    const f1 = mkFlight("f1", { updated_at: stampAt(0) });
    const base = mkData({ flights: [clone(f1)] });
    const va = clone(f1); va.notes = "device A"; va.updated_at = stampAt(7777);
    const vb = clone(f1); vb.notes = "device B"; vb.updated_at = stampAt(7777);
    const onA = mergeAppData(base, mkData({ flights: [va] }), mkData({ flights: [vb] }));
    const onB = mergeAppData(base, mkData({ flights: [vb] }), mkData({ flights: [va] }));
    const converged = deepEq(onA.flights[0], onB.flights[0]);
    s.probe(
      "equal-stamp conflict convergence",
      converged
        ? "converges"
        : `does NOT converge: device A keeps "${onA.flights[0].notes}", device B keeps "${onB.flights[0].notes}" — pickNewer keeps local on stamp ties, so two clients with identical millisecond stamps each keep their own copy until a later edit`,
    );
  }

  // -- no base (pre-upgrade cache): degrade to union, never lose --
  {
    const f1 = mkFlight("f1", { updated_at: stampAt(0) });
    const out = mergeAppData(null, mkData({ flights: [] }), mkData({ flights: [clone(f1)] }));
    s.eq("no-base merge resurrects rather than loses", ids(out), ["f1"]);
  }

  // -- duty record three-way (keyed by date, updatedAt stamps) --
  {
    const base = mkData({ duty: { "2026-07-10": { on: true, hours: 8, updatedAt: stampAt(0) } } });
    const local = mkData({
      duty: {
        "2026-07-10": { on: true, hours: 8, updatedAt: stampAt(0) }, // untouched
        "2026-07-11": { on: true, hours: 6, updatedAt: stampAt(1000) }, // local add
      },
    });
    const remote = mkData({
      duty: { "2026-07-12": { on: true, hours: 4, updatedAt: stampAt(2000) } }, // deleted 07-10, added 07-12
    });
    const out = mergeAppData(base, local, remote);
    s.eq("duty: delete propagates, adds from both sides survive", Object.keys(out.duty).sort(), ["2026-07-11", "2026-07-12"]);

    const be = mkData({ duty: { d: { on: true, hours: 8, updatedAt: stampAt(0) } } });
    const le = mkData({ duty: { d: { on: true, hours: 9, updatedAt: stampAt(1000) } } });
    const re = mkData({ duty: { d: { on: true, hours: 12, updatedAt: stampAt(2000) } } });
    s.check("duty: concurrent edit resolves to newer stamp", mergeAppData(be, le, re).duty["d"].hours === 12);
    // D1 regression: both devices must land on the same value (the fix that
    // makes mergeById actually see the duty entry's updatedAt).
    const dutyA = mergeAppData(be, le, re).duty["d"].hours;
    const dutyB = mergeAppData(be, re, le).duty["d"].hours;
    s.check("duty: both devices converge on the newer value", dutyA === 12 && dutyB === 12);
    s.check("duty: merged entry keeps its updatedAt stamp", mergeAppData(be, le, re).duty["d"].updatedAt === stampAt(2000));
  }

  // -- singleton fields: changed-from-base side wins --
  {
    const profA = { firstName: "Zoheb", lastName: "K", role: "Captain", onboarded: true };
    const profB = { ...profA, role: "First Officer" };
    const base = mkData({ profile: clone(profA) });
    const localChanged = mkData({ profile: clone(profB) });
    const remoteSame = mkData({ profile: clone(profA) });
    s.check("singleton: locally-changed profile wins", mergeAppData(base, localChanged, remoteSame).profile?.role === "First Officer");
    s.check("singleton: remotely-changed profile wins", mergeAppData(base, remoteSame, localChanged).profile?.role === "First Officer");
    const remoteOther = mkData({ profile: { ...clone(profA), role: "Flight Instructor" } });
    const both = mergeAppData(base, localChanged, remoteOther);
    s.probe("singleton both-changed conflict", `local wins silently (kept role "${both.profile?.role}"); the other device's profile/column-layout edit is dropped without surfacing`);
  }

  // -- unknown top-level keys survive the round trip --
  {
    const base = mkData();
    const remote = mkData() as AppData & { futureFeature?: string };
    remote.futureFeature = "written by v0.11";
    const out = mergeAppData(base, mkData(), remote) as AppData & { futureFeature?: string };
    s.check("unknown top-level key from a newer client survives", out.futureFeature === "written by v0.11");
  }

  // -- pilots list merges on updatedAt --
  {
    const p = mkPilot("p1", "Ben", "Pearce", { updatedAt: stampAt(0) });
    const base = mkData({ pilots: [clone(p)] });
    const le = clone(p); le.licenseNumber = "TC-111"; le.updatedAt = stampAt(1000);
    const re = clone(p); re.licenseNumber = "TC-999"; re.updatedAt = stampAt(2000);
    const out = mergeAppData(base, mkData({ pilots: [le] }), mkData({ pilots: [re] }));
    s.check("pilots: newer updatedAt wins", out.pilots[0].licenseNumber === "TC-999");
  }

  // -- stampChanges stamps exactly the changed entities --
  {
    const prev = mkData({
      flights: [mkFlight("f1", { updated_at: stampAt(0) }), mkFlight("f2", { updated_at: stampAt(0) })],
      duty: { "2026-07-10": { on: true, hours: 8, updatedAt: stampAt(0) } },
    });
    const next = clone(prev);
    next.flights[0].se = 2.2; // edit f1
    next.flights.push(mkFlight("f3")); // add f3
    next.duty["2026-07-10"].hours = 9;
    const now = stampAt(50000);
    stampChanges(prev, next, now);
    s.check("stampChanges: edited flight restamped (updated_at)", next.flights[0].updated_at === now);
    s.check("stampChanges: untouched flight keeps its stamp", next.flights[1].updated_at === stampAt(0));
    s.check("stampChanges: added flight stamped", next.flights[2].updated_at === now);
    s.check("stampChanges: edited duty entry restamped (updatedAt)", next.duty["2026-07-10"].updatedAt === now);
  }

  // -- equality primitives the whole engine rests on --
  s.check("deepEqual ignores key order", deepEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }));
  s.check("deepEqual treats k:undefined as absent (jsonb drops it)", deepEqual({ a: 1, b: undefined }, { a: 1 }));
  s.check("deepEqual is order-sensitive for arrays", !deepEqual([1, 2], [2, 1]));
  s.check("sameStamp equates Z and +00:00 spellings", sameStamp("2026-07-17T00:00:00.000Z", "2026-07-17T00:00:00+00:00"));
  s.check("sameStamp rejects different instants", !sameStamp("2026-07-17T00:00:00Z", "2026-07-17T00:00:01Z"));

  // -- self-merge is the identity --
  {
    const x = mkData({ flights: [mkFlight("f1", { updated_at: stampAt(0) })], duty: { d: { on: true, updatedAt: stampAt(0) } } });
    const out = mergeAppData(clone(x), clone(x), clone(x));
    s.check("merge(X, X, X) = X", deepEq(out, x));
  }

  return s;
}
