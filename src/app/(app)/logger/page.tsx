"use client";

import { useRef, useState } from "react";
import { useData } from "@/context/DataContext";
import FlightForm from "@/components/FlightForm";
import FlightTable from "@/components/FlightTable";
import {
  currentPilot, flightsForCurrentPilot, pilotName,
} from "@/lib/logbook";
import { flightDate } from "@/lib/logbook";
import { toCSV, importCSV, parseCSV, detectStructuredLogbook, normalizeName } from "@/lib/csv";
import { migrateData } from "@/lib/migrate";

export default function LoggerPage() {
  const { data, replace, currentUser } = useData();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [csvMsg, setCsvMsg] = useState<{ text: string; kind: "ok" | "error" | "info" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flights = flightsForCurrentPilot(data);
  const cp = currentPilot(data);

  function edit(id: string) {
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      let ownerNames: string[] = [];
      const peek = parseCSV(text);
      if (detectStructuredLogbook(peek) >= 0) {
        if (!data.pilots.length) {
          setCsvMsg({ text: "Add a Pilot Profile first — your logbook needs a pilot to own these flights.", kind: "error" });
          return;
        }
        const suggested = cp ? `${(cp.firstName || "").charAt(0)}.${cp.lastName || ""}`.replace(/^\.|\.$/g, "") : "";
        const reply = window.prompt(
          "This looks like a multi-column logbook with PIC and Student columns.\n\n" +
            "What name represents YOU in the spreadsheet?\n\n" +
            "Examples:  B.Pearce   |   Smith, J   |   John Smith\n" +
            "If your name appears in more than one form, separate variations with commas.",
          suggested,
        );
        if (reply === null) return;
        ownerNames = reply.split(",").map((s) => normalizeName(s.trim())).filter(Boolean);
        if (!ownerNames.length && !confirm("No name entered — every flight will be imported as Captain by default. Continue?")) return;
      }
      const working = migrateData(structuredClone(data));
      const res = importCSV(working, text, ownerNames);
      if (res.error) { setCsvMsg({ text: "Import failed: " + res.error, kind: "error" }); return; }
      replace(res.data);
      let m = `Imported ${res.added} flight${res.added === 1 ? "" : "s"}`;
      if (res.roleCounts && (res.roleCounts.Captain || res.roleCounts.Student)) {
        m += ` — ${res.roleCounts.Captain || 0} as Captain, ${res.roleCounts.Student || 0} as Student`;
      }
      if (res.skipped) m += `, skipped ${res.skipped} invalid row${res.skipped === 1 ? "" : "s"}`;
      setCsvMsg({ text: m + ".", kind: res.added ? "ok" : "error" });
    };
    reader.onerror = () => setCsvMsg({ text: "Could not read file.", kind: "error" });
    reader.readAsText(file);
    e.target.value = "";
  }

  const msgColor = csvMsg?.kind === "error" ? "text-red-400" : csvMsg?.kind === "ok" ? "text-emerald-400" : "text-slate-400";

  return (
    <>
      <FlightForm editingId={editingId} onDone={() => setEditingId(null)} />

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
    </>
  );
}
