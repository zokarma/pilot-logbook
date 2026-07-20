// Eval #14 — CSV Import Wizard mapping engine (src/lib/importMap.ts).
// The largest pure module and a backup/restore path: header→field guessing,
// data-shape veto, saved templates, and the dry-run plan → apply pipeline all
// have to be right or a whole imported logbook lands mis-mapped.

import {
  normHeader, hoursVal, targetField, proposeMapping, collectSamples,
  headerSignature, findTemplate, applyTemplate, collectCrewNames,
  planImport, mappingHasDate, applyMappedImport, ColumnMapping, MatchSource,
} from "../src/lib/importMap";
import { normalizeName } from "../src/lib/csv";
import { ImportTemplate } from "../src/lib/types";
import { Suite } from "./harness";
import { mkData, mkPilot, clone } from "./fixtures";

// Build a confirmed mapping (what the wizard hands to planImport/apply).
function mapCols(headers: string[], fields: (string | null)[]): ColumnMapping[] {
  return headers.map((header, index) => ({
    index, header, samples: [],
    field: fields[index] ?? null,
    confidence: fields[index] ? 1 : 0,
    source: (fields[index] ? "user" : "none") as MatchSource,
  }));
}

const fieldOf = (cols: ColumnMapping[], header: string) =>
  cols.find((c) => c.header === header)?.field ?? null;

export function run(): Suite {
  const s = new Suite(14, "CSV Import Wizard (importMap.ts)", "Header→field mapping, shape veto, templates, and the plan→apply pipeline for bulk import.");

  // ---------- header + value helpers ----------
  s.eq("normHeader strips case + punctuation/space", normHeader("ICAO From "), "icaofrom");
  s.eq("normHeader of junk-only is empty", normHeader("— / —"), "");
  s.check("hoursVal: decimals, h:mm, comma-decimal, blank, junk",
    hoursVal("1.5") === 1.5 && hoursVal("1:30") === 1.5 && hoursVal("1,5") === 1.5 && hoursVal("") === 0 && hoursVal("abc") === 0);
  s.check("hoursVal: h:mm minutes convert (2:15 = 2.25)", hoursVal("2:15") === 2.25);
  s.check("targetField resolves keys and rejects unknowns", targetField("se")?.key === "se" && targetField("nope") === null && targetField(null) === null);

  // ---------- proposeMapping: exact / synonym ----------
  {
    const headers = ["Date", "Aircraft Type", "Registration", "PIC", "From", "To", "Single Engine", "Notes"];
    const rows = [
      ["2026-07-01", "C172", "C-GABC", "Pearce, B", "CYNJ", "CYPK", "1.2", "circuits"],
      ["2026-07-02", "C172", "C-GXYZ", "Karmali, Z", "CYPK", "CYNJ", "1.5", ""],
    ];
    const cols = proposeMapping(headers, rows, 0);
    s.eq("exact header match → field", fieldOf(cols, "Date"), "date");
    s.check("exact match carries confidence 1 / source exact", cols[0].confidence === 1 && cols[0].source === "exact");
    s.eq("multi-word exact ('Aircraft Type')", fieldOf(cols, "Aircraft Type"), "aircraftType");
    s.eq("crew name column maps to pic", fieldOf(cols, "PIC"), "pic");
    s.eq("synonym match ('Single Engine' → se)", fieldOf(cols, "Single Engine"), "se");
    s.check("synonym source recorded", cols.find((c) => c.header === "Single Engine")?.source === "synonym");
    s.eq("route columns", `${fieldOf(cols, "From")}/${fieldOf(cols, "To")}`, "from/to");
  }

  // ---------- proposeMapping: data-shape veto ----------
  {
    // A "PIC" header whose values are hours is PIC *time*, not a name column.
    const headers = ["PIC"];
    const rows = [["1.5"], ["2.0"], ["1.0"]];
    const cols = proposeMapping(headers, rows, 0);
    s.check("numeric samples veto a name-header match (PIC time ≠ PIC name)", cols[0].field === null);
  }

  // ---------- proposeMapping: fuzzy containment ----------
  {
    const headers = ["Total Flight Time Hrs"];
    const rows = [["1.5"], ["2.0"]];
    const cols = proposeMapping(headers, rows, 0);
    s.eq("fuzzy containment maps to total", cols[0].field, "total");
    s.check("fuzzy source + mid confidence", cols[0].source === "fuzzy" && cols[0].confidence > 0.6 && cols[0].confidence < 1);
  }

  // ---------- proposeMapping: short-synonym guard ----------
  {
    const headers = ["Day Landings"];
    const rows = [["3"], ["2"]];
    const cols = proposeMapping(headers, rows, 0);
    s.check("short synonyms ('day') don't hijack unrelated headers", cols[0].field !== "day" && cols[0].field !== "dayHours");
  }

  // ---------- proposeMapping: shape sniffing for unlabeled columns ----------
  {
    const headers = ["Col A", "Col B"];
    const rows = [["2026-07-01", "CYNJ"], ["2026-07-02", "CYPK"], ["2026-07-03", "CYYZ"]];
    const cols = proposeMapping(headers, rows, 0);
    s.eq("unlabeled all-date column sniffed as date", cols[0].field, "date");
    s.check("date-by-shape carries the 'shape' source", cols[0].source === "shape");
    s.eq("unlabeled airport-code column sniffed to a route slot", cols[1].field, "from");
  }

  // ---------- proposeMapping: one column per field ----------
  {
    const headers = ["PIC", "Pilot in Command"];
    const rows = [["Pearce, B", "Pearce, B"], ["Karmali, Z", "Karmali, Z"]];
    const cols = proposeMapping(headers, rows, 0);
    const picCols = cols.filter((c) => c.field === "pic");
    s.check("duplicate targets collapse to one (highest confidence keeps it)", picCols.length === 1 && picCols[0].header === "PIC");
  }

  // ---------- collectSamples ----------
  {
    const rows = [["a"], [""], ["b"], ["c"], ["d"], ["e"]];
    s.eq("collectSamples skips blanks, caps at max", collectSamples(rows, 0, 0, 3), ["a", "b", "c"]);
  }

  // ---------- templates: signature / find / apply ----------
  {
    s.check("headerSignature is normalization-insensitive but order-sensitive",
      headerSignature(["Date", "PIC"]) === headerSignature([" date ", "p.i.c"]) &&
      headerSignature(["Date", "PIC"]) !== headerSignature(["PIC", "Date"]));

    const tpl: ImportTemplate = {
      id: "t1", signature: headerSignature(["Date", "Reg", "SE"]),
      mapping: [{ header: "Date", field: "date" }, { header: "Reg", field: "registration" }, { header: "SE", field: "se" }],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const data = mkData({ importTemplates: [tpl] });
    s.check("findTemplate matches by header signature", findTemplate(data, ["Date", "Reg", "SE"])?.id === "t1");
    s.check("findTemplate misses on a different shape", findTemplate(data, ["Date", "Reg"]) === null);

    const rows = [["2026-07-01", "C-GABC", "1.2"]];
    const applied = applyTemplate(tpl, ["Date", "Reg", "SE"], rows, 0);
    s.eq("applyTemplate rehydrates fields by header", applied.map((c) => c.field), ["date", "registration", "se"]);
    s.check("applyTemplate marks source=template, confidence 1", applied[0].source === "template" && applied[0].confidence === 1);
  }
  {
    // Dupe + renamed-field guards.
    const tpl: ImportTemplate = {
      id: "t2", signature: "sig",
      mapping: [{ header: "A", field: "se" }, { header: "B", field: "se" }, { header: "C", field: "obsoleteField" }],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const applied = applyTemplate(tpl, ["A", "B", "C"], [["1", "2", "3"]], 0);
    s.check("duplicate template field kept once", applied[0].field === "se" && applied[1].field === null);
    s.check("template field no longer in the catalog is dropped", applied[2].field === null);
  }

  // ---------- collectCrewNames ----------
  {
    const cols = mapCols(["PIC", "SIC"], ["pic", "sic"]);
    const rows = [
      ["Pearce, B", "Karmali, Z"],
      ["Pearce, B", "1.5"],       // numeric ignored
      ["2026-07-01", "Mowbray"],  // date-looking ignored
      ["Pearce, B", "Karmali, Z"],
    ];
    const names = collectCrewNames(rows, 0, cols);
    s.check("crew names collected, most-frequent first, junk filtered",
      names[0] === "Pearce, B" && names.includes("Karmali, Z") && names.includes("Mowbray") && !names.some((n) => n === "1.5"));
  }

  // ---------- mappingHasDate ----------
  s.check("mappingHasDate: date column alone is enough", mappingHasDate(mapCols(["D"], ["date"])));
  s.check("mappingHasDate: Y+M+D together", mappingHasDate(mapCols(["Y", "M", "D"], ["year", "month", "day"])));
  s.check("mappingHasDate: partial Y/M is not", !mappingHasDate(mapCols(["Y", "M"], ["year", "month"])));

  // ---------- planImport ----------
  {
    const headers = ["Date", "Reg", "SE Day", "SE Night", "XC Day", "Total", "Takeoff", "Landing", "Role"];
    const mapping = mapCols(headers, ["date", "registration", "seDay", "seNight", "xcDay", "total", "takeoff", "landing", "loggedRole"]);
    const rows = [
      ["2026-07-01", "c-gabc", "1.2", "0.5", "1.0", "", "D", "N", "Captain"],
      ["banana", "C-GXYZ", "", "", "", "2.0", "", "", ""],   // unreadable date → skip
    ];
    const plan = planImport(rows, 0, mapping, []);
    s.check("row accounting: 1 ok, 1 skipped with reason", plan.added === 1 && plan.skipped === 1 && /date/.test(plan.rows[1].reason || ""));
    const f = plan.rows[0].flight!;
    s.check("grouped SE day+night fan out into se + day/night", f.se === 1.7 && f.dayHours === 1.2 && f.nightHours === 0.5);
    s.check("grouped XC day sums into xc", f.xc === 1.0);
    s.check("registration upper-cased + mirrored to civilIdent", f.registration === "C-GABC" && f.civilIdent === "C-GABC");
    s.check("takeoff/landing day-night parsed from D/N", f.takeoff === "Day" && f.landing === "Night");
    s.check("explicit logged role wins", f.loggedRole === "Captain");
  }
  {
    // Total → SE only when no engine hours; Y/M/D date path; 2-digit year.
    const headers = ["Year", "Month", "Day", "Total"];
    const mapping = mapCols(headers, ["year", "month", "day", "total"]);
    const plan = planImport([["23", "6", "5", "2.5"]], 0, mapping, []);
    const f = plan.rows[0].flight!;
    s.check("Y/M/D build a date; 2-digit year expands", f.date === "2023-06-05");
    s.check("total time lands in SE when no engine hours mapped", f.se === 2.5 && f.me === 0);
  }
  {
    // Owner role inference when no explicit role column.
    const headers = ["Date", "PIC", "SIC"];
    const mapping = mapCols(headers, ["date", "pic", "sic"]);
    const owner = [normalizeName("Zoheb Karmali")];
    const rows = [
      ["2026-07-01", "Zoheb Karmali", "Pearce"], // owner is PIC → Captain
      ["2026-07-02", "Pearce", "Zoheb Karmali"], // owner is SIC → Student
    ];
    const plan = planImport(rows, 0, mapping, owner);
    s.check("owner in PIC → Captain; owner in SIC → Student", plan.rows[0].flight!.loggedRole === "Captain" && plan.rows[1].flight!.loggedRole === "Student");
    s.check("roleCounts tallied", plan.roleCounts.Captain === 1 && plan.roleCounts.Student === 1);
  }

  // ---------- applyMappedImport (end-to-end) ----------
  {
    const base = mkData({
      pilots: [mkPilot("me", "Zoheb", "Karmali")],
      currentPilotId: "me",
      profile: { firstName: "Zoheb", lastName: "Karmali", role: "Captain", pilotId: "me", onboarded: true },
    });
    const headers = ["Date", "Reg", "PIC", "SE"];
    const mapping = mapCols(headers, ["date", "registration", "pic", "se"]);
    const rows = [
      ["2026-07-01", "C-GABC", "Zoheb Karmali", "1.2"],
      ["2026-07-02", "C-GXYZ", "Pearce, B", "1.5"],
    ];
    const res = applyMappedImport(clone(base), rows, 0, mapping, [normalizeName("Zoheb Karmali")]);
    s.check("both rows imported", res.added === 2 && res.skipped === 0);
    s.check("every imported flight owned by the current pilot", res.data.flights.every((f) => f.pilotId === "me"));
    const mine = res.data.flights.find((f) => f.registration === "C-GABC")!;
    const other = res.data.flights.find((f) => f.registration === "C-GXYZ")!;
    s.check("owner's PIC row re-pointed to their profile id", mine.picId === "me");
    s.check("non-owner crew name retained as the pic text mirror", other.pic === "Pearce, B");
    s.check("mapping saved as a reusable template", !!findTemplate(res.data, headers));
  }
  {
    // Re-importing the same shape replaces the template (no duplicate signature)
    // and the MAX_TEMPLATES cap holds.
    const seeded: ImportTemplate[] = Array.from({ length: 20 }, (_, i) => ({
      id: `old${i}`, signature: `sig-${i}`, mapping: [],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const base = mkData({
      pilots: [mkPilot("me", "Z", "K")], currentPilotId: "me",
      profile: { firstName: "Z", lastName: "K", role: "Captain", pilotId: "me", onboarded: true },
      importTemplates: seeded,
    });
    const headers = ["Date", "SE"];
    const mapping = mapCols(headers, ["date", "se"]);
    const res = applyMappedImport(clone(base), [["2026-07-01", "1.0"]], 0, mapping, []);
    s.check("template list capped at 20 (oldest dropped)", res.data.importTemplates.length === 20);
    s.check("newest template retained after cap", !!findTemplate(res.data, headers));

    const res2 = applyMappedImport(clone(res.data), [["2026-07-02", "1.0"]], 0, mapping, []);
    const sameSig = res2.data.importTemplates.filter((t) => t.signature === headerSignature(headers));
    s.check("re-import of same shape keeps a single template entry", sameSig.length === 1);
  }

  s.probe(
    "wizard imports don't promote non-owner crew to Pilot profiles",
    "planImport pre-sets picId/sicId to \"\" (not undefined), so migrateData's free-text→profile promotion is skipped for wizard imports — only the owner's own crew slot gets a real id (set explicitly in applyMappedImport). Other crew survive as text mirrors (fl.pic/sic) only. This differs from the legacy structured CSV path and matches migrate finding F3; promoting them would need planImport to leave the ids undefined.",
  );

  s.probe(
    "AI-assisted mapping (phase 2)",
    "proposeMapping is the heuristic proposal source; an edge-function AI proposer is designed to plug in as an alternate stage-1 source with planImport/applyMappedImport unchanged — not yet built, so not covered here.",
  );

  return s;
}
