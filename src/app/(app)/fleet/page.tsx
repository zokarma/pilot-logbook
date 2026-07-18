"use client";

import { useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { uid } from "@/lib/id";
import { fleetTypes, normalizeAircraftCode } from "@/lib/aircraft";
import { AircraftType } from "@/lib/types";

export default function FleetPage() {
  const { data, mutate } = useData();
  const [form, setForm] = useState({ code: "", name: "" });
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");

  // How many logged flights reference each type code (by normalized code).
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    data.flights.forEach((f) => {
      const k = normalizeAircraftCode(f.aircraftType);
      if (k) m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }, [data.flights]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fleetTypes(data.fleet).filter(
      (t) => !q || t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
    );
  }, [data.fleet, query]);

  const customCount = data.fleet?.length ?? 0;

  function add(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeAircraftCode(form.code);
    const name = form.name.trim();
    if (!code) { setMsg("Enter an aircraft code, e.g. C210."); return; }
    if (fleetTypes(data.fleet).some((t) => normalizeAircraftCode(t.code) === code)) {
      setMsg(`"${code}" already exists — built-in or already in your fleet.`);
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
    setForm({ code: "", name: "" });
    setMsg("");
  }

  function remove(id: string, code: string) {
    const used = usage.get(normalizeAircraftCode(code)) || 0;
    const warn = used > 0
      ? `Remove "${code}" from your fleet? ${used} logged flight${used === 1 ? "" : "s"} use it — those flights keep the code, but it won't appear in the picker anymore.`
      : `Remove "${code}" from your fleet?`;
    if (!confirm(warn)) return;
    mutate((draft) => {
      draft.fleet = (draft.fleet || []).filter((a) => a.id !== id);
    });
  }

  const inputCls = "w-full px-3 py-2 border border-slate-700 rounded-lg";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Fleet</h1>
        <p className="text-sm text-slate-400 mt-1">
          Aircraft types available when logging flights. The built-in catalog is shared by everyone; anything you add
          here is saved to your own logbook and syncs across your devices.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="text-lg font-semibold mb-3">Add an aircraft type</h2>
        <form onSubmit={add} className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Code</label>
            <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="C210" className={inputCls + " uppercase"} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Cessna 210 Centurion" className={inputCls} />
          </div>
          <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 rounded-lg transition">
            Add
          </button>
        </form>
        {msg && <p className="text-sm text-red-400 mt-2">{msg}</p>}
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold">
            All types <span className="text-slate-400 font-normal text-sm">({rows.length} shown · {customCount} custom)</span>
          </h2>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search code or name…" className="px-3 py-2 border border-slate-700 rounded-lg text-sm w-56 max-w-full" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Source</th>
                <th className="py-2 pr-4 font-medium">Flights</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const used = usage.get(normalizeAircraftCode(t.code)) || 0;
                const custom = data.fleet?.find((a) => normalizeAircraftCode(a.code) === normalizeAircraftCode(t.code) && !t.builtIn);
                return (
                  <tr key={t.code} className="border-b border-slate-800/60">
                    <td className="py-2 pr-4 font-medium">{t.code}</td>
                    <td className="py-2 pr-4 text-slate-300">{t.name}</td>
                    <td className="py-2 pr-4">
                      {t.builtIn
                        ? <span className="text-slate-400">Built-in</span>
                        : <span className="text-brand-400">Custom</span>}
                    </td>
                    <td className="py-2 pr-4 text-slate-400">{used || "—"}</td>
                    <td className="py-2 text-right">
                      {!t.builtIn && custom && (
                        <button onClick={() => remove(custom.id, t.code)} className="text-xs text-red-400 hover:text-red-300">
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={5} className="py-4 text-slate-400">No aircraft types match “{query}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
