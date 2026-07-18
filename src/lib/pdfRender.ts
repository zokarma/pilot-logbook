// PDF export — the RENDER half. Takes the pure model from lib/pdf.ts and
// draws it with jsPDF + autotable. Both libraries are dynamically imported so
// they only load when the pilot actually exports (they're ~400 KB).

import { AppData } from "./types";
import { APP_VERSION } from "./types";
import { buildPdfModel, PDF_LOG_COLUMNS, PDF_NUMERIC_COLS, fmtTotal } from "./pdf";

const SLATE = 51; // dark gray text
const HEAD_FILL: [number, number, number] = [15, 23, 42]; // slate-900

export async function generateLogbookPdf(data: AppData, filename: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const m = buildPdfModel(data);

  const doc = new jsPDF({ unit: "mm", format: "a4" }); // portrait: summary page
  const withY = doc as unknown as { lastAutoTable?: { finalY: number } };

  /* ---------------- summary cover page ---------------- */
  doc.setTextColor(SLATE);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Pilot Logbook", 14, 20);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(m.pilotName + (m.licence ? `  ·  ${m.licence}` : ""), 14, 28);
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generated ${m.generatedOn} · pilotlogbook.ca v${APP_VERSION} · Summary is for reference only`, 14, 34);
  doc.setTextColor(SLATE);

  const s = m.summary;
  autoTable(doc, {
    startY: 40,
    head: [["Career totals", ""]],
    body: [
      ["Total hours", s.totalHours.toFixed(1)],
      ["Flights", String(s.flights)],
      ["Single engine", s.se.toFixed(1)],
      ["Multi engine", s.me.toFixed(1)],
      ["Cross country", s.xc.toFixed(1)],
      ["Day", s.day.toFixed(1)],
      ["Night", s.night.toFixed(1)],
      ["IFR (actual + sim)", s.ifr.toFixed(1)],
      ["Landings", String(s.landings)],
    ],
    theme: "grid",
    styles: { fontSize: 9, textColor: SLATE },
    headStyles: { fillColor: HEAD_FILL, fontSize: 9 },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: 14, right: 110 },
  });
  const leftY = withY.lastAutoTable?.finalY ?? 40;

  autoTable(doc, {
    startY: 40,
    head: [["Hours by type", "", ""]],
    body: s.byType.slice(0, 12).map((t) => [t.code, t.name === t.code ? "" : t.name, t.hours.toFixed(1)]),
    theme: "grid",
    styles: { fontSize: 9, textColor: SLATE },
    headStyles: { fillColor: HEAD_FILL, fontSize: 9 },
    columnStyles: { 2: { halign: "right" } },
    margin: { left: 110, right: 14 },
  });
  const rightY = withY.lastAutoTable?.finalY ?? 40;

  let y = Math.max(leftY, rightY) + 8;
  if (s.currencies.length) {
    autoTable(doc, {
      startY: y,
      head: [["Currency (reference only)", "Status", "Until"]],
      body: s.currencies.map((c) => [c.name, c.ok ? "Current" : "Not current", c.ok ? c.lapsesOn ?? "" : ""]),
      theme: "grid",
      styles: { fontSize: 9, textColor: SLATE },
      headStyles: { fillColor: HEAD_FILL, fontSize: 9 },
      margin: { left: 14, right: 14 },
    });
    y = (withY.lastAutoTable?.finalY ?? y) + 8;
  }
  if (s.documents.length) {
    autoTable(doc, {
      startY: y,
      head: [["Document", "Status"]],
      body: s.documents.map((d) => [d.type, d.label]),
      theme: "grid",
      styles: { fontSize: 9, textColor: SLATE },
      headStyles: { fillColor: HEAD_FILL, fontSize: 9 },
      margin: { left: 14, right: 14 },
    });
  }

  /* ---------------- TC-style logbook pages (landscape) ---------------- */
  m.pages.forEach((page, idx) => {
    doc.addPage("a4", "landscape");
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`Logbook — ${m.pilotName}`, 14, 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Page ${idx + 1} of ${m.pages.length}`, 283, 12, { align: "right" });
    doc.setTextColor(SLATE);

    const totalsRow = (label: string, totals: number[]): string[] => {
      const row = PDF_LOG_COLUMNS.map(() => "");
      row[6] = label;
      PDF_NUMERIC_COLS.forEach((col, j) => { row[col] = fmtTotal(col, totals[j]); });
      return row;
    };

    autoTable(doc, {
      startY: 16,
      head: [[...PDF_LOG_COLUMNS]],
      body: page.rows,
      foot: [
        totalsRow("TOTALS THIS PAGE", page.pageTotals),
        totalsRow("TOTALS TO DATE", page.forwardTotals),
      ],
      theme: "grid",
      styles: { fontSize: 6.8, cellPadding: 1.2, textColor: SLATE, overflow: "ellipsize" },
      headStyles: { fillColor: HEAD_FILL, fontSize: 6.8 },
      footStyles: { fillColor: [226, 232, 240], textColor: SLATE, fontStyle: "bold", fontSize: 6.8 },
      columnStyles: {
        0: { cellWidth: 18 }, 1: { cellWidth: 14 }, 2: { cellWidth: 16 },
        3: { cellWidth: 13 }, 4: { cellWidth: 13 }, 5: { cellWidth: 18 }, 6: { cellWidth: 26 },
        7: { cellWidth: 11, halign: "right" }, 8: { cellWidth: 11, halign: "right" },
        9: { cellWidth: 11, halign: "right" }, 10: { cellWidth: 11, halign: "right" },
        11: { cellWidth: 11, halign: "right" }, 12: { cellWidth: 11, halign: "right" },
        13: { cellWidth: 10, halign: "right" },
      },
      margin: { left: 10, right: 10 },
    });

    // Certification block on the final page.
    if (idx === m.pages.length - 1) {
      const fy = (withY.lastAutoTable?.finalY ?? 170) + 14;
      doc.setFontSize(9);
      doc.text("I certify that the entries in this logbook are true.", 14, fy);
      doc.line(14, fy + 14, 90, fy + 14);
      doc.text("Signature", 14, fy + 19);
      doc.line(110, fy + 14, 160, fy + 14);
      doc.text("Date", 110, fy + 19);
    }
  });

  if (!m.pages.length) {
    doc.setFontSize(10);
    doc.text("No flights logged yet.", 14, y ? y + 14 : 120);
  }

  doc.save(filename);
}
