// Eval #4 — CSV export/import (src/lib/csv.ts).
// The de-facto backup/restore path. Round-trip fidelity and the structured
// Transport-Canada logbook import are the high-risk areas.

import {
  toCSV, parseCSV, parseAnyDate, expandTwoDigitYear, importCSV, normalizeName, ownerRoleForRow,
} from "../src/lib/csv";
import { Suite } from "./harness";
import { mkData, mkFlight, mkPilot, clone } from "./fixtures";

export function run(): Suite {
  const s = new Suite(4, "CSV import/export (csv.ts)", "Bulk ingestion and the only backup path — silent row corruption multiplies across a whole logbook.");

  // -- RFC-4180 parsing --
  s.eq("parseCSV: quoted commas, escaped quotes, embedded newline",
    parseCSV('a,"b,c","d""e","f\ng"\r\nh,i,j,k'),
    [["a", "b,c", 'd"e', "f\ng"], ["h", "i", "j", "k"]]);
  s.eq("parseCSV: blank lines dropped", parseCSV("a,b\n\n , \nc,d"), [["a", "b"], ["c", "d"]]);

  // -- date parsing matrix --
  s.eq("ISO date", parseAnyDate("2026-07-17"), [2026, 7, 17]);
  s.eq("D/M/Y when day > 12 disambiguates", parseAnyDate("17/07/2026"), [2026, 7, 17]);
  s.eq("M/D/Y American style", parseAnyDate("07/17/2026"), [2026, 7, 17]);
  s.eq("dd-Mon-yy", parseAnyDate("17-Jul-26"), [2026, 7, 17]);
  s.eq("Month d, yyyy", parseAnyDate("Jul 17, 2026"), [2026, 7, 17]);
  s.eq("day + month name needs a fallback year", parseAnyDate("5 May"), null);
  s.eq("day + month name with fallback year", parseAnyDate("5 May", 2026), [2026, 5, 5]);
  s.eq("two-digit year split: 49 → 2049", expandTwoDigitYear(49), 2049);
  s.eq("two-digit year split: 50 → 1950", expandTwoDigitYear(50), 1950);
  {
    const amb = parseAnyDate("05/06/2026");
    s.probe("ambiguous 05/06/2026", `parsed as ${amb?.[1]}/${amb?.[2]} (month/day) — an all-numeric date with both parts ≤ 12 silently assumes the US M/D order; Canadian D/M logbooks importing "05/06" mean June 5 and get May 6. No warning is surfaced.`);
  }

  // -- owner matching on initials --
  {
    const hit = ownerRoleForRow("", "K.", [normalizeName("Zoheb Karmali")]);
    s.probe(
      "ownerRoleForRow substring matching",
      `a bare initial "K." in the student column returns ${JSON.stringify(hit)} — normalizeName("K.") is "k" and the bidirectional includes() finds "k" inside "zohebkarmali", so 1–2 letter crew initials (common in TC logbooks) can claim rows for the owner and mislabel roles.`,
    );
  }

  // -- flat CSV round-trip (export → import) --
  {
    const flights = [
      mkFlight("f1", { date: "2026-07-01", civilIdent: "C-GABC", notes: 'He said "go, now"\nthen left', se: 1.2, year: 2026, month: 7, day: 1 }),
      mkFlight("f2", { date: "2026-07-02", civilIdent: "C-FXYZ", takeoff: "Night", landing: "Night", nightHours: 1.5, se: 1.5, dayHours: 0, year: 2026, month: 7, day: 2 }),
      mkFlight("f3", { date: "2026-07-03", civilIdent: "C-GQRS", me: 2.1, se: 0, loggedRole: "First Officer", year: 2026, month: 7, day: 3 }),
    ];
    const text = toCSV(flights);

    // Backup round-trip: the app must be able to re-import its OWN export.
    // Regression guard for D2 — "Single Engine" in the flat export header used
    // to trip detectStructuredLogbook and route the backup into the structured
    // path, where it died with "Couldn't find a Date column".
    const res = importCSV(mkData(), text, []);
    s.check(
      "the app can re-import its OWN export (backup round-trip)",
      res.added === 3 && res.skipped === 0,
      `added=${res.added} error=${res.error ?? "none"}`,
    );
    const [g1, g2, g3] = [res.data.flights[0], res.data.flights[1], res.data.flights[2]];
    s.check("round-trip: dates survive", g1?.date === "2026-07-01" && g3?.date === "2026-07-03");
    s.check("round-trip: gnarly notes survive exactly", g1?.notes === 'He said "go, now"\nthen left');
    s.check("round-trip: night takeoff/landing survive", g2?.takeoff === "Night" && g2?.landing === "Night");
    s.check("round-trip: hours survive", g1?.se === 1.2 && g2?.nightHours === 1.5 && g3?.me === 2.1);
    s.check("round-trip: registration restored from the Registration column", g1?.registration === "C-GABC");
    s.check("round-trip: logged role survives", g3?.loggedRole === "First Officer");

    const again = importCSV(clone(res.data), text, []);
    s.probe("re-importing the same file", `no dedupe on flat import — importing the same CSV twice yields ${again.data.flights.length} flights from 3 rows. The scan confirm sheet flags duplicates; the CSV path does not.`);
  }

  // -- rejection / skip accounting --
  {
    const res = importCSV(mkData(), "Date,se\nbanana,1.0\n2026-07-01,1.0", []);
    s.check("unparseable date rows are skipped and counted", res.added === 1 && res.skipped === 1);
    const err = importCSV(mkData(), "Aircraft Type,PIC\nC172,Me", []);
    s.check("missing date columns produce a clear error", !!err.error && /date/i.test(err.error));
  }

  // -- structured Transport-Canada logbook import --
  {
    // 3 stacked header rows: groups / day-night / field names — the shape
    // detectStructuredLogbook + buildCombinedHeaders are built for.
    const rows = [
      ["", "", "", "", "", "", "", "", "SINGLE ENGINE", "", "MULTI ENGINE", "", "CROSS COUNTRY", ""],
      ["", "", "", "", "", "", "", "", "DAY", "NIGHT", "DAY", "NIGHT", "DAY", "NIGHT"],
      ["YEAR", "DATE", "TYPE", "IDENT", "PIC", "STUDENT OR PASSENGER", "FROM", "TO", "", "", "", "", "", ""],
      ["2026", "May 5", "C172", "c-gabc", "PEARCE, B", "", "CYNJ", "CYPK", "1.2", "", "", "", "1.2", ""],
      ["2026", "6 May", "PA28", "C-GXYZ", "Zoheb Karmali", "", "CYPK", "CYNJ", "", "1.0", "", "", "", ""],
      ["2026", "7 May", "C172", "C-GABC", "PEARCE, B", "Zoheb Karmali", "CYNJ", "CYNJ", "1.1", "", "", "", "", ""],
    ];
    const quote = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
    const text = rows.map((r) => r.map(quote).join(",")).join("\r\n");

    // Realistic setup: the owner onboarded first, so their pilot exists and is current.
    const me = mkPilot("me", "Zoheb", "Karmali");
    const data = mkData({ pilots: [me], currentPilotId: "me", profile: { firstName: "Zoheb", lastName: "Karmali", role: "Captain", pilotId: "me", onboarded: true } });
    const res = importCSV(data, text, [normalizeName("Zoheb Karmali")]);

    s.check("structured layout detected", res.format === "structured-logbook");
    s.check("all three data rows imported (header echo rows skipped)", res.added === 3);
    const [r1, r2, r3] = res.data.flights;
    s.check("Year column + 'May 5' style dates combine", r1.date === "2026-05-05" && r2.date === "2026-05-06" && r3.date === "2026-05-07");
    s.check("SE day hours land in se + dayHours", r1.se === 1.2 && r1.dayHours === 1.2 && r1.nightHours === 0);
    s.check("SE night hours land in se + nightHours", r2.se === 1.0 && r2.nightHours === 1.0);
    s.check("cross-country day sums into xc", r1.xc === 1.2);
    s.check("registrations uppercased", r1.registration === "C-GABC");
    s.check("owner in PIC column → Captain row re-pointed to owner", r2.loggedRole === "Captain" && r2.picId === "me");
    s.check("owner in student column → Student row, sicId = owner", r3.loggedRole === "Student" && r3.sicId === "me");
    s.check("every imported row belongs to the owner's logbook", res.data.flights.every((f) => f.pilotId === "me"));
    s.check("crew names promoted to pilot profiles", res.data.pilots.some((p) => `${p.firstName} ${p.lastName}`.includes("PEARCE")));
    s.probe("structured import + night hours", `row 2 carries nightHours=${r2.nightHours} but takeoff/landing are hard-coded "${r2.takeoff}"/"${r2.landing}" — the mirrors disagree with the hour split until the pilot edits the row.`);
  }

  // -- structured import into a brand-new empty account --
  {
    const rows = [
      ["", "", "", "", "SINGLE ENGINE", ""],
      ["", "", "", "", "DAY", "NIGHT"],
      ["YEAR", "DATE", "TYPE", "PIC", "", ""],
      ["2026", "May 5", "C172", "PEARCE, B", "1.2", ""],
    ];
    const res = importCSV(mkData(), rows.map((r) => r.join(",")).join("\n"), [normalizeName("Zoheb Karmali")]);
    const owner = res.data.pilots.find((p) => p.id === res.data.currentPilotId);
    s.probe(
      "structured import into an empty account",
      `currentPilotId lands on "${owner?.firstName} ${owner?.lastName}" — with no pre-existing owner pilot, the post-import ownership pass uses the first *crew name encountered* as "me", so an un-onboarded import attributes the logbook to a crew member. Onboarding-first (the real flow) avoids this.`,
    );
  }

  return s;
}
