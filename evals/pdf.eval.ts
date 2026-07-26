// Eval #12 — PDF export model (src/lib/pdf.ts).
// The rendered PDF is a legal-looking document: page totals, forward totals
// and grand totals must be exact, chronological, and scoped to the pilot.

import { buildPdfModel, PDF_LOG_COLUMNS, PDF_NUMERIC_COLS, fmtCell, fmtTotal } from "../src/lib/pdf";
import { Suite, approx } from "./harness";
import { mkData, mkFlight, mkPilot } from "./fixtures";

export function run(): Suite {
  const s = new Suite(14, "PDF export model (pdf.ts)", "Totals math on a document pilots hand to examiners/insurers.");

  // -- chunking + totals --
  {
    // 20 flights, 1.0 SE each → rowsPerPage 8 gives pages of 8/8/4.
    const flights = Array.from({ length: 20 }, (_, i) =>
      mkFlight(`f${i}`, { date: `2026-01-${String(i + 1).padStart(2, "0")}`, se: 1.0, dayHours: 1.0 }),
    );
    const m = buildPdfModel(mkData({ flights }), 8);
    s.check("chunking: 20 rows at 8/page → 3 pages of 8,8,4", m.pages.length === 3 && m.pages[0].rows.length === 8 && m.pages[2].rows.length === 4);

    const seIdx = PDF_NUMERIC_COLS.indexOf(7); // SE column
    s.check("page totals: 8.0 SE on a full page", approx(m.pages[0].pageTotals[seIdx], 8));
    s.check("forward totals accumulate (8 → 16 → 20)", approx(m.pages[0].forwardTotals[seIdx], 8) && approx(m.pages[1].forwardTotals[seIdx], 16) && approx(m.pages[2].forwardTotals[seIdx], 20));
    s.check("grand totals = last forward totals", approx(m.grandTotals[seIdx], 20));
    s.check("rows are chronological (paper-logbook order)", m.pages[0].rows[0][0] === "2026-01-01" && m.pages[2].rows[3][0] === "2026-01-20");
    s.check("landings default to 1 per flight in the Ldg total", m.grandTotals[PDF_NUMERIC_COLS.indexOf(13)] === 20);
    s.check("summary career totals match", approx(m.summary.totalHours, 20) && m.summary.flights === 20);
  }

  // -- circuits: a multi-landing flight contributes its full count everywhere --
  {
    const ldgIdx = PDF_NUMERIC_COLS.indexOf(13);
    const m = buildPdfModel(mkData({ flights: [
      mkFlight("solo", { date: "2026-03-01", se: 1.0 }),                       // default 1 landing
      mkFlight("circuits", { date: "2026-03-02", se: 1.5, landings: 6 }),      // 6 circuits
      mkFlight("pm", { date: "2026-03-03", se: 1.0, landing: "None", landings: 4 }), // monitoring → 0
    ] }), 50);
    s.check("circuits flight shows 6 in its Ldg cell", m.pages[0].rows[1][13] === "6");
    s.check("pilot-monitoring leg shows blank Ldg (0)", m.pages[0].rows[2][13] === "");
    s.check("Ldg grand total sums circuits (1 + 6 + 0 = 7)", m.grandTotals[ldgIdx] === 7);
    s.check("summary landings total also counts circuits", m.summary.landings === 7);
  }

  // -- float-safe totals --
  {
    const flights = Array.from({ length: 10 }, (_, i) => mkFlight(`f${i}`, { date: `2026-02-0${(i % 9) + 1}`, se: 0.1 }));
    const m = buildPdfModel(mkData({ flights }), 50);
    s.check("0.1×10 rounds cleanly to 1.0 (no float dust)", m.grandTotals[PDF_NUMERIC_COLS.indexOf(7)] === 1);
  }

  // -- pilot scoping --
  {
    const m = buildPdfModel(mkData({
      currentPilotId: "me",
      pilots: [mkPilot("me", "Zoheb", "Karmali")],
      flights: [
        mkFlight("mine", { pilotId: "me", se: 2 }),
        mkFlight("theirs", { pilotId: "them", se: 9 }),
      ],
    }));
    s.check("only the current pilot's flights are exported", m.summary.flights === 1 && approx(m.summary.se, 2));
  }

  // -- by-type aggregation resolves custom fleet names --
  {
    const m = buildPdfModel(mkData({
      fleet: [{ id: "a1", code: "C210", name: "Cessna 210", createdAt: "2026-01-01T00:00:00.000Z" }],
      flights: [
        mkFlight("a", { aircraftType: "C210", se: 3 }),
        mkFlight("b", { aircraftType: "C210", se: 1 }),
        mkFlight("c", { aircraftType: "C172", se: 1 }),
      ],
    }));
    s.check("hours grouped by type, sorted desc, custom names resolved",
      m.summary.byType[0].code === "C210" && approx(m.summary.byType[0].hours, 4) && m.summary.byType[0].name === "Cessna 210");
  }

  // -- empty logbook --
  {
    const m = buildPdfModel(mkData());
    s.check("empty logbook: zero pages, zeroed grand totals", m.pages.length === 0 && m.grandTotals.every((n) => n === 0));
  }

  // -- formatting helpers --
  s.check("hours cells print one decimal, zeros stay blank", fmtCell(7, 1.2) === "1.2" && fmtCell(7, 0) === "");
  s.check("landing cells are whole numbers", fmtCell(13, 2) === "2");
  s.check("hour totals keep one decimal, landing totals are integers", fmtTotal(7, 12) === "12.0" && fmtTotal(13, 12.0) === "12");
  s.check("totals row alignment: numeric col count matches", PDF_NUMERIC_COLS.length === 7 && PDF_LOG_COLUMNS.length === 15);

  return s;
}
