// Eval #2 — data migration (src/lib/migrate.ts).
// Runs on every load for every user; must upgrade any historical shape without
// dropping or corrupting anything, and must be idempotent.

import { migrateData } from "../src/lib/migrate";
import { DEFAULT_FLIGHT_COLUMN_KEYS } from "../src/lib/flightColumns";
import { AppData, Flight } from "../src/lib/types";
import { Suite, deepEq } from "./harness";
import { clone } from "./fixtures";

// Legacy rows arrive from storage without the fields migrate back-fills, so
// fixtures are intentionally partial.
const legacy = (over: Record<string, unknown>): Flight => over as unknown as Flight;

export function run(): Suite {
  const s = new Suite(2, "Data migration (migrate.ts)", "Runs on every load; a bad upgrade corrupts every user's stored logbook at once.");

  // -- null / brand-new user --
  {
    const d = migrateData(null);
    s.check("null input yields a complete empty AppData", Array.isArray(d.flights) && Array.isArray(d.pilots) && typeof d.duty === "object");
    s.check("brand-new user keeps profile null (wizard must run)", d.profile === null);
    s.eq("flightColumns default to the canonical set", d.flightColumns, DEFAULT_FLIGHT_COLUMN_KEYS);
    s.check("fleet initialized to an empty array", Array.isArray(d.fleet) && d.fleet.length === 0);
  }

  // -- fleet back-filled on legacy data that predates it --
  {
    const d = migrateData({ flights: [] } as Partial<AppData>);
    s.check("legacy data without a fleet gets an empty fleet array", Array.isArray(d.fleet));
  }

  // -- legacy year/month/day and civilIdent upgrades --
  {
    const d = migrateData({
      flights: [legacy({ id: "f1", year: 2019, month: 3, day: 7, civilIdent: "C-FABC", pic: "Ben Pearce" })],
    } as Partial<AppData>);
    const f = d.flights[0];
    s.check("year/month/day promoted to zero-padded date", f.date === "2019-03-07");
    s.check("civilIdent promoted to registration", f.registration === "C-FABC");
    s.check("free-text PIC promoted to a real pilot profile", d.pilots.length === 1 && d.pilots[0].firstName === "Ben" && d.pilots[0].lastName === "Pearce");
    s.check("picId back-filled to the promoted pilot", f.picId === d.pilots[0].id);
    s.check("flight ownership (pilotId) back-filled from picId", f.pilotId === f.picId);
    s.check("currentPilotId set to the first pilot", d.currentPilotId === d.pilots[0].id);
    s.check("numeric hour fields back-filled to 0", f.dayHours === 0 && f.nightHours === 0);
    s.check("loggedRole defaulted", f.loggedRole === "Captain");
  }

  // -- the same free-text name across flights maps to ONE pilot --
  {
    const d = migrateData({
      flights: [
        legacy({ id: "f1", year: 2020, month: 1, day: 1, pic: "Ben Pearce" }),
        legacy({ id: "f2", year: 2020, month: 1, day: 2, pic: "ben pearce" }),
        legacy({ id: "f3", year: 2020, month: 1, day: 3, sic: "BEN PEARCE" }),
      ],
    } as Partial<AppData>);
    s.check("case-insensitive name reuse creates a single pilot", d.pilots.length === 1);
    s.check("all three references point at that one pilot", d.flights[0].picId === d.flights[1].picId && d.flights[1].picId === d.flights[2].sicId);
  }

  // -- legacy duty upgrades --
  {
    const d = migrateData({
      duty: {
        "2020-01-01": true,
        "2020-01-02": { start: "08:00", end: "16:00" },
      } as unknown as AppData["duty"],
    } as Partial<AppData>);
    s.check("duty `true` upgraded to {on:true}", deepEq(d.duty["2020-01-01"], { on: true }));
    s.check("duty object without `on` gains on:true", d.duty["2020-01-02"].on === true && d.duty["2020-01-02"].start === "08:00");
  }

  // -- flightColumns normalization --
  {
    const d = migrateData({ flightColumns: ["route", "bogus-key", "route", "se"] } as Partial<AppData>);
    s.eq("unknown keys dropped, dupes collapsed, order kept", d.flightColumns, ["route", "se"]);
    const e = migrateData({ flightColumns: ["all-bogus"] } as Partial<AppData>);
    s.eq("all-invalid stored columns fall back to the default set", e.flightColumns, DEFAULT_FLIGHT_COLUMN_KEYS);
  }

  // -- existing users get a synthesized, onboarded profile --
  {
    const d = migrateData({
      flights: [legacy({ id: "f1", year: 2021, month: 6, day: 1, pic: "Zoheb Karmali" })],
      lastLoggedRole: "First Officer",
    } as Partial<AppData>);
    s.check("existing user is never sent back through onboarding", d.profile !== null && d.profile.onboarded === true);
    s.check("synthesized profile mirrors the primary pilot", d.profile?.firstName === "Zoheb" && d.profile?.pilotId === d.currentPilotId);
    s.check("synthesized profile picks up lastLoggedRole", d.profile?.role === "First Officer");
  }

  // -- legacy pilotName promotion --
  {
    const d = migrateData({ pilotName: "Amelia Mowbray" } as Partial<AppData>);
    s.check("legacy pilotName promoted to a pilot profile", d.pilots.some((p) => p.firstName === "Amelia" && p.lastName === "Mowbray"));
  }

  // -- idempotence: a second run is a no-op --
  {
    const first = migrateData({
      flights: [legacy({ id: "f1", year: 2019, month: 3, day: 7, civilIdent: "C-FABC", pic: "Ben Pearce" })],
      duty: { "2020-01-01": true } as unknown as AppData["duty"],
      pilotName: "Ben Pearce",
    } as Partial<AppData>);
    const second = migrateData(clone(first));
    s.check("migrate(migrate(x)) is a fixed point", deepEq(second, first));
  }

  // -- picId: undefined triggers promotion, empty string does not --
  {
    const d = migrateData({
      flights: [legacy({ id: "f1", year: 2020, month: 1, day: 1, picId: "", pic: "Ghost Name" })],
    } as Partial<AppData>);
    s.probe(
      "empty-string picId with free text",
      d.pilots.length === 0
        ? "picId:\"\" is treated as 'resolved' — the free-text name 'Ghost Name' is NOT promoted (only picId:undefined promotes); a row cleared by applyDeletePilot keeps its text mirror empty so this is consistent, but a hand-imported row with empty ids and text names would silently skip promotion"
        : "empty-string picId also promotes",
    );
  }

  return s;
}
