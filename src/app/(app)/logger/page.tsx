"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData } from "@/context/DataContext";
import { useEntitlement } from "@/hooks/useEntitlement";
import FlightForm from "@/components/FlightForm";
import FlightTable from "@/components/FlightTable";
import ImportWizard, { WizardInput } from "@/components/ImportWizard";
import ScanImport from "@/components/ScanImport";
import {
  currentPilot, flightsForCurrentPilot, pilotName, flightDate,
} from "@/lib/logbook";
import { toCSV, parseCSV, detectStructuredLogbook, buildCombinedHeaders } from "@/lib/csv";

export default function LoggerPage() {
  const { data, currentUser } = useData();
  const router = useRouter();
  const { has, ready: entReady } = useEntitlement();
  // `has` is false until the entitlement resolves, so guard the ACTION with it
  // (fails closed) but only badge the button once we actually know — otherwise
  // a subscriber sees a PRO flash on every load. The button stays disabled
  // until then, so neither tier can act on a half-loaded answer.
  const pdfAllowed = has("proPdf");
  const pdfGated = entReady && !pdfAllowed;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [csvMsg, setCsvMsg] = useState<{ text: string; kind: "ok" | "error" | "info" } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [wizard, setWizard] = useState<WizardInput | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-open the new-flight form when the widget "Log Flight" button is tapped.
  // The event covers the warm-app case; the sessionStorage flag (parked by the
  // app layout's deep-link handler) covers a cold launch where this page wasn't
  // mounted yet when the event fired.
  useEffect(() => {
    function onNewFlight() {
      try { sessionStorage.removeItem("plb_pending_new_flight"); } catch { /* ignore */ }
      setFormOpen(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    try {
      if (sessionStorage.getItem("plb_pending_new_flight")) onNewFlight();
    } catch { /* ignore */ }
    window.addEventListener("plb-new-flight", onNewFlight);
    return () => window.removeEventListener("plb-new-flight", onNewFlight);
  }, []);

  const flights = flightsForCurrentPilot(data);
  const cp = currentPilot(data);

  function edit(id: string) {
    setEditingId(id);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeForm() {
    setEditingId(null);
    setFormOpen(false);
  }

  async function exportPdf() {
    // Professional PDF export is a Pro feature — route non-subscribers to pricing.
    if (!pdfAllowed) { router.push("/pricing"); return; }
    if (!data.flights.length) { setCsvMsg({ text: "No flights to export.", kind: "error" }); return; }
    setPdfBusy(true);
    try {
      // Dynamic import keeps jsPDF (~400 KB) out of the page bundle.
      const { generateLogbookPdf } = await import("@/lib/pdfRender");
      await generateLogbookPdf(data, `logbook_${currentUser}_${new Date().toISOString().slice(0, 10)}.pdf`);
      setCsvMsg({ text: "PDF exported (summary + logbook pages).", kind: "ok" });
    } catch (e) {
      setCsvMsg({ text: `PDF export failed: ${e instanceof Error ? e.message : String(e)}`, kind: "error" });
    } finally {
      setPdfBusy(false);
    }
  }

  function exportCsv() {
    if (!data.flights.length) { setCsvMsg({ text: "No flights to export.", kind: "error" }); return; }
    const csv = toCSV([...data.flights].sort((a, b) => flightDate(b).getTime() - flightDate(a).getTime()));
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logbook_${currentUser}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setCsvMsg({ text: `Exported ${data.flights.length} flight${data.flights.length === 1 ? "" : "s"}.`, kind: "ok" });
  }

  // Parse the file and open the import wizard (mapping review → identity →
  // preview). The wizard owns the rest of the flow.
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(String(reader.result));
      if (rows.length < 2) {
        setCsvMsg({ text: "Import failed: file has no data rows.", kind: "error" });
        return;
      }
      if (!data.pilots.length) {
        setCsvMsg({ text: "Add a Pilot Profile first — your logbook needs a pilot to own these flights.", kind: "error" });
        return;
      }
      const structIdx = detectStructuredLogbook(rows);
      const structured = structIdx >= 0;
      setCsvMsg(null);
      setWizard({
        headers: structured ? buildCombinedHeaders(rows, structIdx) : rows[0],
        rows,
        dataStart: structured ? structIdx + 1 : 1,
        structured,
      });
    };
    reader.onerror = () => setCsvMsg({ text: "Could not read file.", kind: "error" });
    reader.readAsText(file);
    e.target.value = "";
  }

  const msgColor = csvMsg?.kind === "error" ? "text-red-400" : csvMsg?.kind === "ok" ? "text-emerald-400" : "text-slate-400";

  return (
    <>
      {formOpen || editingId ? (
        <FlightForm editingId={editingId} onDone={closeForm} />
      ) : (
        <div className="mb-6">
          <button
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 rounded-lg transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add a Flight
          </button>
        </div>
      )}

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Logged Flights</h2>
            <span className="text-sm text-slate-400">
              {flights.length} {flights.length === 1 ? "flight" : "flights"}
              {cp ? ` for ${pilotName(data, cp.id)}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ScanImport mode="flights" />
            <button onClick={exportCsv} className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-3 py-1.5 rounded-lg transition">Export CSV</button>
            <button onClick={() => void exportPdf()} disabled={pdfBusy || !entReady} title={pdfGated ? "Professional PDF export is a Pro feature" : "Export a summary + TC-style logbook PDF"} className="text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-200 font-medium px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1.5">{pdfBusy ? "Building PDF…" : "Export PDF"}{pdfGated && <span className="text-[10px] font-semibold bg-brand-600 text-white px-1.5 py-0.5 rounded">PRO</span>}</button>
            <button onClick={() => fileRef.current?.click()} className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-3 py-1.5 rounded-lg transition">Import CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </div>
        </div>
        {csvMsg && <p className={"text-sm mb-3 " + msgColor}>{csvMsg.text}</p>}

        {flights.length ? (
          <FlightTable onFullEdit={edit} />
        ) : (
          /* First run is the moment a switching pilot decides whether this is
             worth it, and "import my existing logbook" is the thing they came
             to do. It used to be a small tertiary button beside the exports,
             so it's spelled out here as an equal option. */
          <div className="py-8 max-w-2xl mx-auto">
            <h3 className="text-center font-semibold text-slate-100">Let&apos;s get your flying in here</h3>
            <p className="text-center text-sm text-slate-400 mt-1">
              Already keep a logbook somewhere else? Bring it over — you don&apos;t have to retype years of flights.
            </p>
            <div className="grid gap-3 sm:grid-cols-3 mt-6">
              <button
                onClick={() => fileRef.current?.click()}
                className="text-left p-4 rounded-xl border border-brand-500/40 bg-brand-500/5 hover:border-brand-400 transition"
              >
                <svg className="w-5 h-5 text-brand-300 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                <div className="font-medium text-sm text-slate-100">Import a CSV</div>
                <div className="text-xs text-slate-400 mt-1">From another logbook app or a spreadsheet. We&apos;ll match up the columns.</div>
              </button>

              <button
                onClick={() => setFormOpen(true)}
                className="text-left p-4 rounded-xl border border-slate-700 hover:border-slate-600 transition"
              >
                <svg className="w-5 h-5 text-slate-300 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                <div className="font-medium text-sm text-slate-100">Log a flight</div>
                <div className="text-xs text-slate-400 mt-1">Type one in. The form remembers your aircraft and route next time.</div>
              </button>

              <div className="p-4 rounded-xl border border-slate-800">
                <svg className="w-5 h-5 text-slate-400 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" /></svg>
                <div className="font-medium text-sm text-slate-300">Scan paper pages</div>
                <div className="text-xs text-slate-400 mt-1">
                  Photograph a page and let AI read it — use Scan Logbook above. <span className="text-slate-500">Pro feature.</span>
                </div>
              </div>
            </div>
            <p className="text-center text-xs text-slate-500 mt-5">
              Not sure what your file needs? See the <Link href="/help#import-csv" className="text-brand-300 hover:text-brand-200">import guide</Link>.
            </p>
          </div>
        )}
      </div>

      {wizard && (
        <ImportWizard
          input={wizard}
          onClose={() => setWizard(null)}
          onDone={(msg) => { setWizard(null); setCsvMsg(msg); }}
        />
      )}
    </>
  );
}
