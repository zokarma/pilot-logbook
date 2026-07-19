"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { fleetTypes, normalizeAircraftCode, CREW_ROLES } from "@/lib/aircraft";
import { uid } from "@/lib/id";
import { num, pilotName } from "@/lib/logbook";
import { AircraftType, DayNight, Flight } from "@/lib/types";
import AirportDatalist from "./AirportDatalist";

function todayStr(): string {
  const t = new Date();
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  return `${t.getFullYear()}-${mm}-${dd}`;
}

type FormState = {
  date: string; aircraftType: string; registration: string; loggedRole: string;
  picId: string; sicId: string; socId: string; from: string; to: string;
  takeoff: DayNight; landing: DayNight;
  se: string; me: string; xc: string; dayHours: string; nightHours: string;
  ifrActual: string; ifrSim: string; landings: string; approaches: string; notes: string;
};

function blankForm(role: string): FormState {
  return {
    date: todayStr(), aircraftType: "", registration: "", loggedRole: role,
    picId: "", sicId: "", socId: "", from: "", to: "", takeoff: "Day", landing: "Day",
    se: "0", me: "0", xc: "0", dayHours: "0", nightHours: "0", ifrActual: "0", ifrSim: "0",
    landings: "1", approaches: "0", notes: "",
  };
}

export default function FlightForm({
  editingId,
  onDone,
}: {
  editingId: string | null;
  onDone: () => void;
}) {
  const { data, mutate } = useData();
  const editing = editingId ? data.flights.find((f) => f.id === editingId) || null : null;
  const [form, setForm] = useState<FormState>(() => blankForm(data.lastLoggedRole || "Captain"));
  const [msg, setMsg] = useState("");
  // Inline "add a new aircraft type" panel, shown when the picker's
  // "+ Add new type…" option is chosen. Adds to the pilot's per-user fleet.
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState({ code: "", name: "" });
  const [typeMsg, setTypeMsg] = useState("");

  const aircraftOptions = useMemo(() => fleetTypes(data.fleet), [data.fleet]);

  useEffect(() => {
    if (editing) {
      setForm({
        date: editing.date || todayStr(),
        aircraftType: editing.aircraftType || "",
        registration: editing.registration || editing.civilIdent || "",
        loggedRole: editing.loggedRole || "Captain",
        picId: editing.picId || "", sicId: editing.sicId || "", socId: editing.socId || "",
        from: editing.from || "", to: editing.to || "",
        takeoff: (editing.takeoff as DayNight) || "Day",
        landing: (editing.landing as DayNight) || "Day",
        se: String(editing.se ?? 0), me: String(editing.me ?? 0), xc: String(editing.xc ?? 0),
        dayHours: String(editing.dayHours ?? 0), nightHours: String(editing.nightHours ?? 0),
        ifrActual: String(editing.ifrActual ?? 0), ifrSim: String(editing.ifrSim ?? 0),
        landings: String(editing.landings ?? 1), approaches: String(editing.approaches ?? 0),
        notes: editing.notes || "",
      });
    } else {
      setForm(blankForm(data.lastLoggedRole || "Captain"));
    }
    setMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const regList = useMemo(() => {
    const seen = new Set<string>();
    data.flights.forEach((f) => {
      const r = (f.registration || f.civilIdent || "").trim().toUpperCase();
      if (r) seen.add(r);
    });
    return Array.from(seen).sort();
  }, [data.flights]);

  const pilotOptions = data.pilots.map((p) => (
    <option key={p.id} value={p.id}>{pilotName(data, p.id) || "(unnamed)"}</option>
  ));

  const aircraftKnown = aircraftOptions.some((t) => t.code === form.aircraftType);

  // Add a custom aircraft type to the pilot's fleet and select it on the form.
  function addAircraftType() {
    const code = normalizeAircraftCode(newType.code);
    const name = newType.name.trim();
    if (!code) { setTypeMsg("Enter an aircraft code, e.g. C210."); return; }
    if (aircraftOptions.some((t) => normalizeAircraftCode(t.code) === code)) {
      setTypeMsg(`"${code}" is already in your fleet.`);
      return;
    }
    mutate((draft) => {
      if (!Array.isArray(draft.fleet)) draft.fleet = [];
      const entry: AircraftType = {
        id: uid("ac"),
        code,
        name: name || code,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      draft.fleet.push(entry);
    });
    set("aircraftType", code);
    setNewType({ code: "", name: "" });
    setTypeMsg("");
    setAddingType(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!data.pilots.length) { setMsg("Add at least one pilot profile in the Pilots tab first."); return; }
    if (!form.aircraftType) { setMsg("Please pick an aircraft type."); return; }
    if (!form.date) { setMsg("Please pick a date."); return; }

    const [y, m, d] = form.date.split("-").map((n) => parseInt(n, 10));
    const reg = form.registration.trim().toUpperCase();
    const id = editingId || uid("f");

    mutate((draft) => {
      draft.lastLoggedRole = form.loggedRole || "Captain";
      const flight: Flight = {
        id,
        date: form.date,
        aircraftType: form.aircraftType,
        registration: reg,
        pilotId: draft.currentPilotId,
        loggedRole: form.loggedRole,
        picId: form.picId, sicId: form.sicId, socId: form.socId,
        from: form.from.trim().toUpperCase(), to: form.to.trim().toUpperCase(),
        takeoff: form.takeoff, landing: form.landing,
        se: num(form.se), me: num(form.me), xc: num(form.xc),
        dayHours: num(form.dayHours), nightHours: num(form.nightHours),
        ifrActual: num(form.ifrActual), ifrSim: num(form.ifrSim),
        landings: num(form.landings), approaches: num(form.approaches),
        notes: form.notes.trim(),
        year: y, month: m, day: d, civilIdent: reg,
        pic: pilotName(draft, form.picId), sic: pilotName(draft, form.sicId), soc: pilotName(draft, form.socId),
        updated_at: new Date().toISOString(),
      };
      const i = draft.flights.findIndex((x) => x.id === id);
      if (i > -1) draft.flights[i] = flight;
      else draft.flights.push(flight);
    });

    setForm(blankForm(form.loggedRole || "Captain"));
    onDone();
  }

  const inputCls = "w-full px-3 py-2 border border-slate-700 rounded-lg";

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{editing ? "Edit Flight" : "Log a Flight"}</h2>
        <button onClick={onDone} className="text-sm text-slate-400 hover:text-slate-200">
          {editing ? "Cancel edit" : "Close"}
        </button>
      </div>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field label="Date">
          <input type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Aircraft Type">
          <select
            required={!addingType}
            value={addingType ? "__add__" : form.aircraftType}
            onChange={(e) => {
              if (e.target.value === "__add__") { setAddingType(true); setTypeMsg(""); }
              else { setAddingType(false); set("aircraftType", e.target.value); }
            }}
            className={inputCls}
          >
            <option value="">— select —</option>
            {aircraftOptions.map((t) => <option key={t.code} value={t.code}>{t.code} — {t.name}</option>)}
            {form.aircraftType && !aircraftKnown && <option value={form.aircraftType}>{form.aircraftType} (custom)</option>}
            <option value="__add__">+ Add new type…</option>
          </select>
          {addingType && (
            <div className="mt-2 p-2 rounded-lg border border-slate-700 bg-slate-800/40 space-y-2">
              <input
                autoFocus
                placeholder="Code (e.g. C210)"
                value={newType.code}
                onChange={(e) => setNewType((t) => ({ ...t, code: e.target.value.toUpperCase() }))}
                className={inputCls + " uppercase"}
              />
              <input
                placeholder="Name (e.g. Cessna 210)"
                value={newType.name}
                onChange={(e) => setNewType((t) => ({ ...t, name: e.target.value }))}
                className={inputCls}
              />
              {typeMsg && <p className="text-xs text-red-400">{typeMsg}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={addAircraftType} className="text-sm bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition">
                  Add to fleet
                </button>
                <button type="button" onClick={() => { setAddingType(false); setTypeMsg(""); setNewType({ code: "", name: "" }); }} className="text-sm text-slate-400 hover:text-slate-200 px-2">
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-slate-500">Saved to your fleet — available in every flight and manageable on the Fleet page.</p>
            </div>
          )}
        </Field>
        <Field label="Registration">
          <input list="registrationsList" placeholder="e.g. C-GABC" value={form.registration} onChange={(e) => set("registration", e.target.value.toUpperCase())} className={inputCls + " uppercase"} />
          <datalist id="registrationsList">
            {regList.map((r) => <option key={r} value={r} />)}
          </datalist>
        </Field>
        <Field label="Pilot Being Logged Role">
          <select value={form.loggedRole} onChange={(e) => set("loggedRole", e.target.value)} className={inputCls}>
            {CREW_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="PIC">
          <select value={form.picId} onChange={(e) => set("picId", e.target.value)} className={inputCls}>
            <option value="">— none —</option>{pilotOptions}
          </select>
        </Field>
        <Field label="Student / First Officer">
          <select value={form.sicId} onChange={(e) => set("sicId", e.target.value)} className={inputCls}>
            <option value="">— none —</option>{pilotOptions}
          </select>
        </Field>
        <Field label="Third Crew (optional)">
          <select value={form.socId} onChange={(e) => set("socId", e.target.value)} className={inputCls}>
            <option value="">— none —</option>{pilotOptions}
          </select>
        </Field>
        <div />
        <Field label="ICAO From">
          <input list="icaoList" maxLength={6} placeholder="CYYZ" value={form.from} onChange={(e) => set("from", e.target.value.toUpperCase())} className={inputCls + " uppercase"} />
        </Field>
        <Field label="ICAO To">
          <input list="icaoList" maxLength={6} placeholder="CYVR" value={form.to} onChange={(e) => set("to", e.target.value.toUpperCase())} className={inputCls + " uppercase"} />
        </Field>
        <AirportDatalist id="icaoList" />
        <Field label="Takeoff">
          <select value={form.takeoff} onChange={(e) => set("takeoff", e.target.value as DayNight)} className={inputCls}>
            <option value="Day">Day</option><option value="Night">Night</option><option value="None">None</option>
          </select>
        </Field>
        <Field label="Landing">
          <select value={form.landing} onChange={(e) => set("landing", e.target.value as DayNight)} className={inputCls}>
            <option value="Day">Day</option><option value="Night">Night</option><option value="None">None</option>
          </select>
        </Field>
        <NumField label="Single Engine (hrs)" value={form.se} onChange={(v) => set("se", v)} />
        <NumField label="Multi Engine (hrs)" value={form.me} onChange={(v) => set("me", v)} />
        <NumField label="Cross Country (hrs)" value={form.xc} onChange={(v) => set("xc", v)} />
        <div />
        <NumField label="Day (hrs)" value={form.dayHours} onChange={(v) => set("dayHours", v)} />
        <NumField label="Night (hrs)" value={form.nightHours} onChange={(v) => set("nightHours", v)} />
        <NumField label="IFR Actual (hrs)" value={form.ifrActual} onChange={(v) => set("ifrActual", v)} />
        <NumField label="IFR Simulated (hrs)" value={form.ifrSim} onChange={(v) => set("ifrSim", v)} />
        <NumField label="Landings (count)" value={form.landings} onChange={(v) => set("landings", v)} />
        <NumField label="Approaches (count)" value={form.approaches} onChange={(v) => set("approaches", v)} />
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="block text-xs font-medium text-slate-400 mb-1">Notes / Remarks</label>
          <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2 lg:col-span-4 flex gap-3 items-center">
          <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 rounded-lg transition">
            {editing ? "Save Changes" : "Add Flight"}
          </button>
          <p className="text-sm text-red-500">{msg}</p>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input type="number" step="0.1" min="0" value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
    </Field>
  );
}
