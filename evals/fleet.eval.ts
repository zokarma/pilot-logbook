// Eval #10 — fleet manager (src/lib/aircraft.ts + AppData.fleet).
// Per-user custom aircraft types layered on the built-in catalog. The picker
// list must merge, de-dupe, and sort predictably, and names must resolve.

import { fleetTypes, normalizeAircraftCode, aircraftName, AIRCRAFT_TYPES } from "../src/lib/aircraft";
import { Suite } from "./harness";

export function run(): Suite {
  const s = new Suite(15, "Fleet manager (aircraft.ts + AppData.fleet)", "Custom aircraft types feed every flight picker; merge/dedupe/sort must be predictable.");

  // -- code normalization (the dedup key) --
  s.eq("normalize uppercases + strips spaces", normalizeAircraftCode("c 172"), "C172");
  s.eq("normalize trims", normalizeAircraftCode("  da40 "), "DA40");
  s.eq("normalize of empty is empty", normalizeAircraftCode("   "), "");

  // -- built-ins only --
  {
    const list = fleetTypes(null);
    s.check("null fleet returns the built-in catalog", list.length === AIRCRAFT_TYPES.length);
    s.check("built-ins are flagged builtIn:true", list.every((t) => t.builtIn));
    const codes = list.map((t) => t.code);
    s.check("list is sorted by code", codes.every((c, i) => i === 0 || codes[i - 1].localeCompare(c) <= 0));
  }

  // -- custom types added --
  {
    const custom = [
      { code: "C210", name: "Cessna 210" },
      { code: "AAA1", name: "Test Type" },
    ];
    const list = fleetTypes(custom);
    s.check("custom types are appended", list.length === AIRCRAFT_TYPES.length + 2);
    s.check("custom types flagged builtIn:false", list.find((t) => t.code === "C210")?.builtIn === false);
    const codes = list.map((t) => t.code);
    s.check("combined list stays sorted by code", codes.every((c, i) => i === 0 || codes[i - 1].localeCompare(c) <= 0));
  }

  // -- de-dup: custom cannot shadow a built-in --
  {
    const list = fleetTypes([{ code: "c172", name: "My Renamed 172" }]);
    const c172 = list.filter((t) => normalizeAircraftCode(t.code) === "C172");
    s.check("a custom duplicate of a built-in is dropped", c172.length === 1 && c172[0].builtIn);
    s.check("no size change when custom only duplicates a built-in", list.length === AIRCRAFT_TYPES.length);
  }

  // -- de-dup: custom vs custom by normalized code --
  {
    const list = fleetTypes([{ code: "C210", name: "First" }, { code: "c 210", name: "Second" }]);
    s.check("custom-vs-custom duplicates collapse to one", list.filter((t) => normalizeAircraftCode(t.code) === "C210").length === 1);
  }

  // -- blank custom codes are ignored --
  {
    const list = fleetTypes([{ code: "  ", name: "Nameless" }]);
    s.check("blank custom code is skipped", list.length === AIRCRAFT_TYPES.length);
  }

  // -- name resolution --
  s.eq("aircraftName resolves a built-in", aircraftName("C172"), "Cessna 172");
  s.eq("aircraftName resolves a custom type", aircraftName("C210", [{ code: "C210", name: "Cessna 210" }]), "Cessna 210");
  s.eq("aircraftName is normalization-insensitive", aircraftName("c 172"), "Cessna 172");
  s.eq("aircraftName falls back to the code for unknowns", aircraftName("ZZZZ"), "ZZZZ");
  s.eq("aircraftName of empty is empty", aircraftName(""), "");

  return s;
}
