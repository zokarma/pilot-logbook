// Eval #6 — pilot dedupe + merge/delete (src/lib/pilots.ts).
// Destructive operations that re-point every flight reference — an error here
// re-attributes or orphans logbook rows.

import { pilotDupKey, findDuplicateClusters, flightRefCount, applyMerge, applyDeletePilot } from "../src/lib/pilots";
import { Suite } from "./harness";
import { mkData, mkFlight, mkPilot } from "./fixtures";

export function run(): Suite {
  const s = new Suite(9, "Pilot dedupe & merge (pilots.ts)", "Merging/deleting profiles rewrites flight references; mistakes re-attribute legal records.");

  // -- dup keys: initial+surname normalization --
  s.check("'Ben Pearce' and 'B. Pearce' share a dup key", pilotDupKey(mkPilot("a", "Ben", "Pearce")) === pilotDupKey(mkPilot("b", "B.", "Pearce")));
  s.check("'A. MOWBRAY' normalizes case and punctuation", pilotDupKey(mkPilot("a", "A.", "MOWBRAY")) === "a:mowbray");
  s.check("different surnames do not collide", pilotDupKey(mkPilot("a", "Ben", "Pearce")) !== pilotDupKey(mkPilot("b", "Ben", "Piercey")));
  s.check("empty names yield no key (never cluster)", pilotDupKey(mkPilot("a", "", "")) === "");

  {
    const data = mkData({
      pilots: [mkPilot("p1", "Ben", "Pearce"), mkPilot("p2", "B.", "Pearce"), mkPilot("p3", "Amelia", "Mowbray")],
    });
    const clusters = findDuplicateClusters(data);
    s.check("clusters group only the true duplicates", clusters.length === 1 && clusters[0].length === 2);
  }

  // -- merge folds references into the target --
  {
    const data = mkData({
      pilots: [
        mkPilot("t", "Ben", "Pearce", { employeeNumber: "" }),
        mkPilot("s1", "B.", "Pearce", { employeeNumber: "E42", licenseNumber: "TC-1" }),
        mkPilot("s2", "Ben", "Pearce"),
      ],
      currentPilotId: "s2",
      flights: [
        mkFlight("f1", { picId: "s1", pic: "B. Pearce" }),
        mkFlight("f2", { sicId: "s2", socId: "s1", pilotId: "s2" }),
        mkFlight("f3", { picId: "t" }),
      ],
    });
    applyMerge(data, "t", ["s1", "s2"]);
    s.check("source profiles removed, target kept", data.pilots.length === 1 && data.pilots[0].id === "t");
    s.check("picId re-pointed and text mirror refreshed", data.flights[0].picId === "t" && data.flights[0].pic === "Ben Pearce");
    s.check("sicId, socId and ownership re-pointed", data.flights[1].sicId === "t" && data.flights[1].socId === "t" && data.flights[1].pilotId === "t");
    s.check("untouched references stay put", data.flights[2].picId === "t");
    s.check("empty employee/licence numbers filled from a source", data.pilots[0].employeeNumber === "E42" && data.pilots[0].licenseNumber === "TC-1");
    s.check("currentPilotId follows the merge", data.currentPilotId === "t");
  }

  // -- delete clears references without reassigning history --
  {
    const data = mkData({
      pilots: [mkPilot("p1", "Ben", "Pearce"), mkPilot("p2", "Amelia", "Mowbray")],
      currentPilotId: "p1",
      flights: [mkFlight("f1", { pilotId: "p1", picId: "p1", pic: "Ben Pearce", sicId: "p2" })],
    });
    applyDeletePilot(data, "p1");
    s.check("deleted pilot removed from the roster", !data.pilots.some((p) => p.id === "p1"));
    s.check("ownership cleared to null (not reassigned)", data.flights[0].pilotId === null);
    s.check("picId and its text mirror cleared", data.flights[0].picId === "" && data.flights[0].pic === "");
    s.check("other crew references untouched", data.flights[0].sicId === "p2");
    s.check("currentPilotId falls back to a surviving pilot", data.currentPilotId === "p2");
  }

  // -- ref counting counts flights, not slots --
  {
    const data = mkData({ flights: [mkFlight("f1", { picId: "x", sicId: "x" }), mkFlight("f2", { socId: "x" })] });
    s.check("flightRefCount counts each flight once", flightRefCount(data, ["x"]) === 2);
  }

  // -- guard-rail probe: target inside the source list --
  {
    const data = mkData({
      pilots: [mkPilot("t", "Ben", "Pearce"), mkPilot("s", "B.", "Pearce")],
      flights: [mkFlight("f1", { picId: "s" })],
    });
    applyMerge(data, "t", ["t", "s"]);
    const orphaned = data.flights[0].picId === "t" && !data.pilots.some((p) => p.id === "t");
    s.probe(
      "applyMerge with target ∈ sources",
      orphaned
        ? "the target is deleted with the sources and flights point at a ghost id — applyMerge has no guard; the UI must never offer this, and a one-line filter would make it impossible"
        : "target survives (guarded)",
    );
  }

  /* -------- merging a pilot into themselves must be a no-op, not a delete ------ */
  // Previously the target was removed at the end, leaving every flight pointing
  // at an id with no pilot behind it. The UI never offers this; the guard makes
  // it impossible however applyMerge is reached.
  {
    const d = mkData({
      pilots: [mkPilot("a", "Alex", "Reid"), mkPilot("b", "Sam", "Rivard")],
      currentPilotId: "a",
      flights: [mkFlight("f1", { pilotId: "a", picId: "a" })],
    });
    applyMerge(d, "a", ["a"]);
    s.check("the target pilot still exists", d.pilots.some((p) => p.id === "a"));
    s.check("flights still point at a real pilot", d.flights.every((f) => d.pilots.some((p) => p.id === f.picId)));

    // Self-id mixed in with a real source: the real merge still happens.
    const d2 = mkData({
      pilots: [mkPilot("a", "Alex", "Reid"), mkPilot("b", "Alex", "Reid")],
      currentPilotId: "a",
      flights: [mkFlight("f1", { pilotId: "b", picId: "b" })],
    });
    applyMerge(d2, "a", ["a", "b"]);
    s.check("the duplicate is still merged away", !d2.pilots.some((p) => p.id === "b"));
    s.check("its flights moved to the target", d2.flights.every((f) => f.picId === "a"));
    s.check("and the target survived", d2.pilots.some((p) => p.id === "a"));
  }

  return s;
}
