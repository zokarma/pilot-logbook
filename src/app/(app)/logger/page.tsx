"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/context/DataContext";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [csvMsg, setCsvMsg] = useState<{ text: string; kind: "ok" | "error" | "info" } | null>(null);
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
            <button onClick={() => fileRef.current?.click()} className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-3 py-1.5 rounded-lg transition">Import CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </div>
        </div>
        {csvMsg && <p className={"text-sm mb-3 " + msgColor}>{csvMsg.text}</p>}

        {flights.length ? (
          <FlightTable onFullEdit={edit} />
        ) : (
          <p className="text-center text-slate-400 py-8">No flights logged yet. Add your first flight above.</p>
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
