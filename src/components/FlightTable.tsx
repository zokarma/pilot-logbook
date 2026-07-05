"use client";

import { useMemo, useRef, useState } from "react";
import { useData } from "@/context/DataContext";
import { AIRCRAFT_TYPES, CREW_ROLES } from "@/lib/aircraft";
import {
  flightsForCurrentPilot, flightDateStr, ifrHours, num, pilotName, syncFlightMirrors,
} from "@/lib/logbook";
import { DayNight, Flight } from "@/lib/types";

type InlineForm = {
  date: string; aircraftType: string; registration: string; from: string; to: string;
  loggedRole: string; picId: string; sicId: string; socId: string;
  se: string; me: string; xc: string; ifrActual: string; ifrSim: string;
  takeoff: DayNight; landing: DayNight;
};

function toInline(fl: Flight): InlineForm {
  return {
    date: fl.date || flightDateStr(fl), aircraftType: fl.aircraftType || "",
    registration: fl.registration || fl.civilIdent || "", from: fl.from || "", to: fl.to || "",
    loggedRole: fl.loggedRole || "Captain", picId: fl.picId || "", sicId: fl.sicId || "", socId: fl.socId || "",
    se: String(fl.se ?? 0), me: String(fl.me ?? 0), xc: String(fl.xc ?? 0),
    ifrActual: String(fl.ifrActual ?? 0), ifrSim: String(fl.ifrSim ?? 0),
    takeoff: (fl.takeoff as DayNight) || "Day", landing: (fl.landing as DayNight) || "Day",
  };
}

type BulkField =
  | "aircraftType" | "registration" | "loggedRole" | "picId" | "sicId" | "socId"
  | "from" | "to" | "takeoff" | "landing";

const BULK_FIELDS: { key: BulkField; label: string; kind: "aircraft" | "role" | "pilot" | "daynight" | "text" }[] = [
  { key: "aircraftType", label: "Aircraft Type", kind: "aircraft" },
  { key: "registration", label: "Registration", kind: "text" },
  { key: "loggedRole", label: "Role", kind: "role" },
  { key: "picId", label: "PIC", kind: "pilot" },
  { key: "sicId", label: "Student / FO", kind: "pilot" },
  { key: "socId", label: "Third Crew", kind: "pilot" },
  { key: "from", label: "From (ICAO)", kind: "text" },
  { key: "to", label: "To (ICAO)", kind: "text" },
  { key: "takeoff", label: "Takeoff", kind: "daynight" },
  { key: "landing", label: "Landing", kind: "daynight" },
];

function emptyBulk(): Record<BulkField, { on: boolean; value: string }> {
  return Object.fromEntries(BULK_FIELDS.map((f) => [f.key, { on: false, value: "" }])) as Record<
    BulkField,
    { on: boolean; value: string }
  >;
}

const cellIn = "w-full bg-slate-900/70 border border-slate-700 rounded px-1.5 py-1 text-sm";
const numIn = "w-14 bg-slate-900/70 border border-slate-700 rounded px-1 py-1 text-sm";

export default function FlightTable({ onFullEdit }: { onFullEdit: (id: string) => void }) {
  const { data, mutate } = useData();
  const flights = flightsForCurrentPilot(data);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const [inlineId, setInlineId] = useState<string | null>(null);
  const [form, setForm] = useState<InlineForm | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState(emptyBulk());

  const aircraftTypes = useMemo(() => {
    const codes = new Set(AIRCRAFT_TYPES.map((t) => t.code));
    const extra = Array.from(new Set(data.flights.map((f) => f.aircraftType).filter((c) => c && !codes.has(c))));
    return { known: AIRCRAFT_TYPES, extra };
  }, [data.flights]);

  const set = <K extends keyof InlineForm>(k: K, v: InlineForm[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  /* ----- selection ----- */
  function onRowCheck(idx: number, id: string, shift: boolean) {
    // Capture the anchor now: the setSelected updater below runs at React's
    // flush (after this handler returns), by which point anchor.current would
    // already be reassigned to idx and collapse the range to one row.
    const start = anchor.current;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && start !== null) {
        const [a, b] = [start, idx].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) next.add(flights[i].id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    anchor.current = idx;
  }
  const allSelected = flights.length > 0 && flights.every((f) => selected.has(f.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(flights.map((f) => f.id)));
  }
  const clearSel = () => setSelected(new Set());

  /* ----- inline edit ----- */
  function startInline(fl: Flight) {
    setInlineId(fl.id);
    setForm(toInline(fl));
  }
  function cancelInline() {
    setInlineId(null);
    setForm(null);
  }
  function saveInline() {
    if (!inlineId || !form) return;
    mutate((d) => {
      const fl = d.flights.find((x) => x.id === inlineId);
      if (!fl) return;
      fl.date = form.date;
      fl.aircraftType = form.aircraftType;
      fl.registration = form.registration;
      fl.from = form.from; fl.to = form.to;
      fl.loggedRole = form.loggedRole;
      fl.picId = form.picId; fl.sicId = form.sicId; fl.socId = form.socId;
      fl.se = num(form.se); fl.me = num(form.me); fl.xc = num(form.xc);
      fl.ifrActual = num(form.ifrActual); fl.ifrSim = num(form.ifrSim);
      fl.takeoff = form.takeoff; fl.landing = form.landing;
      syncFlightMirrors(d, fl);
    });
    cancelInline();
  }
  function onInlineKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); saveInline(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelInline(); }
  }

  /* ----- bulk ----- */
  function applyBulk() {
    const enabled = BULK_FIELDS.filter((f) => bulk[f.key].on);
    if (!enabled.length || !selected.size) return;
    mutate((d) => {
      d.flights.forEach((fl) => {
        if (!selected.has(fl.id)) return;
        if (bulk.aircraftType.on) fl.aircraftType = bulk.aircraftType.value;
        if (bulk.registration.on) fl.registration = bulk.registration.value;
        if (bulk.loggedRole.on) fl.loggedRole = bulk.loggedRole.value;
        if (bulk.picId.on) fl.picId = bulk.picId.value;
        if (bulk.sicId.on) fl.sicId = bulk.sicId.value;
        if (bulk.socId.on) fl.socId = bulk.socId.value;
        if (bulk.from.on) fl.from = bulk.from.value;
        if (bulk.to.on) fl.to = bulk.to.value;
        if (bulk.takeoff.on) fl.takeoff = bulk.takeoff.value as DayNight;
        if (bulk.landing.on) fl.landing = bulk.landing.value as DayNight;
        syncFlightMirrors(d, fl);
      });
    });
    setBulk(emptyBulk());
    setBulkOpen(false);
    clearSel();
  }
  function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected flight${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    mutate((d) => { d.flights = d.flights.filter((f) => !selected.has(f.id)); });
    clearSel();
  }
  function delOne(id: string) {
    if (!confirm("Delete this flight? This cannot be undone.")) return;
    mutate((d) => { d.flights = d.flights.filter((x) => x.id !== id); });
    if (inlineId === id) cancelInline();
  }

  /* ----- shared field controls ----- */
  const pilotOpts = (
    <>
      <option value="">— none —</option>
      {data.pilots.map((p) => <option key={p.id} value={p.id}>{pilotName(data, p.id) || "(unnamed)"}</option>)}
    </>
  );
  const AircraftSelect = ({ value, onChange, cls }: { value: string; onChange: (v: string) => void; cls: string }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
      <option value="">—</option>
      {aircraftTypes.known.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
      {aircraftTypes.extra.map((c) => <option key={c} value={c}>{c}</option>)}
      {value && !aircraftTypes.known.some((t) => t.code === value) && !aircraftTypes.extra.includes(value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );

  const cols = 16;

  return (
    <div>
      {/* Selection toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-2.5 rounded-lg bg-brand-600/10 border border-brand-500/30">
          <span className="text-sm font-medium text-brand-200">{selected.size} selected</span>
          <button onClick={() => setBulkOpen((v) => !v)} className="text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition">
            Bulk edit
          </button>
          <button onClick={deleteSelected} className="text-sm font-medium bg-red-600/90 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition">
            Delete
          </button>
          <button onClick={clearSel} className="text-sm text-slate-300 hover:text-white px-2 py-1.5">Clear</button>
        </div>
      )}

      {/* Bulk edit panel */}
      {bulkOpen && selected.size > 0 && (
        <div className="card p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold">Edit {selected.size} flight{selected.size === 1 ? "" : "s"}</h4>
            <button onClick={() => setBulkOpen(false)} className="text-slate-400 hover:text-slate-200 text-xl leading-none">&times;</button>
          </div>
          <p className="text-xs text-slate-400 mb-3">Tick a field to overwrite it on every selected flight. Unticked fields are left as-is.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {BULK_FIELDS.map((f) => {
              const st = bulk[f.key];
              const setVal = (value: string) => setBulk((b) => ({ ...b, [f.key]: { ...b[f.key], value } }));
              const setOn = (on: boolean) => setBulk((b) => ({ ...b, [f.key]: { ...b[f.key], on } }));
              return (
                <div key={f.key} className={"rounded-lg border p-2.5 " + (st.on ? "border-brand-500/50 bg-slate-900/40" : "border-slate-800")}>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-200 mb-2 cursor-pointer select-none">
                    <input type="checkbox" checked={st.on} onChange={(e) => setOn(e.target.checked)} className="accent-cyan-500 w-4 h-4" />
                    {f.label}
                  </label>
                  {f.kind === "aircraft" && <AircraftSelect value={st.value} onChange={setVal} cls={cellIn} />}
                  {f.kind === "role" && (
                    <select value={st.value} onChange={(e) => setVal(e.target.value)} className={cellIn} disabled={!st.on}>
                      <option value="">—</option>
                      {CREW_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                  {f.kind === "pilot" && (
                    <select value={st.value} onChange={(e) => setVal(e.target.value)} className={cellIn} disabled={!st.on}>{pilotOpts}</select>
                  )}
                  {f.kind === "daynight" && (
                    <select value={st.value || "Day"} onChange={(e) => setVal(e.target.value)} className={cellIn} disabled={!st.on}>
                      <option value="Day">Day</option><option value="Night">Night</option>
                    </select>
                  )}
                  {f.kind === "text" && (
                    <input value={st.value} onChange={(e) => setVal(e.target.value.toUpperCase())} className={cellIn + " uppercase"} disabled={!st.on} placeholder="—" />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={applyBulk} className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2 rounded-lg transition">Apply to {selected.size}</button>
            <button onClick={() => setBulkOpen(false)} className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
        </div>
      )}

      {flights.length > 0 && (
        <p className="text-xs text-slate-500 mb-2">
          Tip: double-click a row to quick-edit · click checkboxes (Shift-click for a range) to select, then Bulk edit.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="py-2 pr-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-cyan-500 w-4 h-4" aria-label="Select all" />
              </th>
              {["Date", "Aircraft", "Reg", "Route", "Role", "PIC", "Student / FO", "Third", "SE", "ME", "XC", "IFR", "T/O", "Ldg"].map((h) => (
                <th key={h} className="py-2 pr-3 font-medium">{h}</th>
              ))}
              <th className="py-2 pr-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((fl, idx) => {
              const isSel = selected.has(fl.id);
              const isEditing = inlineId === fl.id && form;
              if (isEditing) {
                return (
                  <tr key={fl.id} className="border-b border-brand-500/40 bg-slate-800/70" onKeyDown={onInlineKey}>
                    <td className="py-1.5 pr-2 align-top pt-2">
                      <input type="checkbox" checked={isSel} readOnly onClick={(e) => onRowCheck(idx, fl.id, e.shiftKey)} className="accent-cyan-500 w-4 h-4" />
                    </td>
                    <td className="py-1.5 pr-2"><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={cellIn} autoFocus /></td>
                    <td className="py-1.5 pr-2"><AircraftSelect value={form.aircraftType} onChange={(v) => set("aircraftType", v)} cls={cellIn} /></td>
                    <td className="py-1.5 pr-2"><input value={form.registration} onChange={(e) => set("registration", e.target.value.toUpperCase())} className={cellIn + " uppercase w-20"} /></td>
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1">
                        <input value={form.from} onChange={(e) => set("from", e.target.value.toUpperCase())} className={cellIn + " uppercase w-16"} placeholder="From" />
                        <span className="text-slate-500">→</span>
                        <input value={form.to} onChange={(e) => set("to", e.target.value.toUpperCase())} className={cellIn + " uppercase w-16"} placeholder="To" />
                      </div>
                    </td>
                    <td className="py-1.5 pr-2">
                      <select value={form.loggedRole} onChange={(e) => set("loggedRole", e.target.value)} className={cellIn}>
                        {CREW_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2"><select value={form.picId} onChange={(e) => set("picId", e.target.value)} className={cellIn}>{pilotOpts}</select></td>
                    <td className="py-1.5 pr-2"><select value={form.sicId} onChange={(e) => set("sicId", e.target.value)} className={cellIn}>{pilotOpts}</select></td>
                    <td className="py-1.5 pr-2"><select value={form.socId} onChange={(e) => set("socId", e.target.value)} className={cellIn}>{pilotOpts}</select></td>
                    <td className="py-1.5 pr-2"><input type="number" step="0.1" min="0" value={form.se} onChange={(e) => set("se", e.target.value)} className={numIn} /></td>
                    <td className="py-1.5 pr-2"><input type="number" step="0.1" min="0" value={form.me} onChange={(e) => set("me", e.target.value)} className={numIn} /></td>
                    <td className="py-1.5 pr-2"><input type="number" step="0.1" min="0" value={form.xc} onChange={(e) => set("xc", e.target.value)} className={numIn} /></td>
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1" title="IFR actual / simulated">
                        <input type="number" step="0.1" min="0" value={form.ifrActual} onChange={(e) => set("ifrActual", e.target.value)} className="w-11 bg-slate-900/70 border border-slate-700 rounded px-1 py-1 text-sm" />
                        <span className="text-slate-600 text-xs">/</span>
                        <input type="number" step="0.1" min="0" value={form.ifrSim} onChange={(e) => set("ifrSim", e.target.value)} className="w-11 bg-slate-900/70 border border-slate-700 rounded px-1 py-1 text-sm" />
                      </div>
                    </td>
                    <td className="py-1.5 pr-2">
                      <select value={form.takeoff} onChange={(e) => set("takeoff", e.target.value as DayNight)} className={cellIn}>
                        <option value="Day">Day</option><option value="Night">Night</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <select value={form.landing} onChange={(e) => set("landing", e.target.value as DayNight)} className={cellIn}>
                        <option value="Day">Day</option><option value="Night">Night</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap align-middle">
                      <button onClick={saveInline} className="text-emerald-400 hover:text-emerald-300 font-medium mr-3">Save</button>
                      <button onClick={cancelInline} className="text-slate-400 hover:text-slate-200 font-medium">Cancel</button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr
                  key={fl.id}
                  onDoubleClick={() => startInline(fl)}
                  className={"border-b border-slate-800/60 cursor-default " + (isSel ? "bg-brand-600/10" : "hover:bg-slate-800/60")}
                >
                  <td className="py-2 pr-2" onDoubleClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSel} readOnly onClick={(e) => onRowCheck(idx, fl.id, e.shiftKey)} className="accent-cyan-500 w-4 h-4" />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{flightDateStr(fl)}</td>
                  <td className="py-2 pr-3">{fl.aircraftType}</td>
                  <td className="py-2 pr-3">{fl.registration || fl.civilIdent || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap font-medium">{fl.from || "?"} → {fl.to || "?"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{fl.loggedRole || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{pilotName(data, fl.picId) || fl.pic || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{pilotName(data, fl.sicId) || fl.sic || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{pilotName(data, fl.socId) || fl.soc || "—"}</td>
                  <td className="py-2 pr-3">{num(fl.se).toFixed(1)}</td>
                  <td className="py-2 pr-3">{num(fl.me).toFixed(1)}</td>
                  <td className="py-2 pr-3">{num(fl.xc).toFixed(1)}</td>
                  <td className="py-2 pr-3">{ifrHours(fl).toFixed(1)}</td>
                  <td className="py-2 pr-3">{fl.takeoff}</td>
                  <td className="py-2 pr-3">{fl.landing}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap" onDoubleClick={(e) => e.stopPropagation()}>
                    <button onClick={() => startInline(fl)} className="text-cyan-400 hover:text-cyan-300 font-medium mr-3">Quick</button>
                    <button onClick={() => onFullEdit(fl.id)} className="text-slate-300 hover:text-white font-medium mr-3">Edit</button>
                    <button onClick={() => delOne(fl.id)} className="text-red-500 hover:text-red-400 font-medium">Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
