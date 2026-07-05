"use client";

import { useEffect, useState } from "react";
import { useData } from "@/context/DataContext";
import { uid } from "@/lib/id";
import { pilotName } from "@/lib/logbook";
import { applyDeletePilot, applyMerge, findDuplicateClusters, flightRefCount } from "@/lib/pilots";
import { Pilot } from "@/lib/types";

export default function PilotsPage() {
  const { data, mutate } = useData();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dupesDismissed, setDupesDismissed] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", employeeNumber: "", licenseNumber: "" });

  const editing = editingId ? data.pilots.find((p) => p.id === editingId) : null;

  useEffect(() => {
    if (editing) {
      setForm({
        firstName: editing.firstName || "", lastName: editing.lastName || "",
        employeeNumber: editing.employeeNumber || "", licenseNumber: editing.licenseNumber || "",
      });
    } else {
      setForm({ firstName: "", lastName: "", employeeNumber: "", licenseNumber: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = editingId || uid("p");
    mutate((d) => {
      const pilot: Pilot = {
        id,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        employeeNumber: form.employeeNumber.trim(),
        licenseNumber: form.licenseNumber.trim(),
        createdAt: editing?.createdAt || new Date().toISOString(),
      };
      const i = d.pilots.findIndex((p) => p.id === id);
      if (i > -1) d.pilots[i] = pilot;
      else { d.pilots.push(pilot); if (!d.currentPilotId) d.currentPilotId = pilot.id; }
    });
    setEditingId(null);
    setForm({ firstName: "", lastName: "", employeeNumber: "", licenseNumber: "" });
  }

  function del(id: string) {
    const count = data.flights.filter((f) => f.pilotId === id || f.picId === id || f.sicId === id || f.socId === id).length;
    const warn = count
      ? `Delete this pilot profile? ${count} flight${count === 1 ? "" : "s"} reference this pilot — those references will be cleared but the flights stay.`
      : "Delete this pilot profile?";
    if (!confirm(warn)) return;
    mutate((d) => applyDeletePilot(d, id));
    if (editingId === id) setEditingId(null);
  }

  function mergeInto(sourceId: string, targetId: string) {
    if (!targetId || sourceId === targetId) return;
    const refs = flightRefCount(data, [sourceId]);
    if (!confirm(
      `Merge "${pilotName(data, sourceId)}" into "${pilotName(data, targetId)}"?\n\n` +
        `${refs} flight reference${refs === 1 ? "" : "s"} will be reassigned, then "${pilotName(data, sourceId)}" will be deleted.\n\nThis cannot be undone.`,
    )) return;
    mutate((d) => applyMerge(d, targetId, [sourceId]));
  }

  const clusters = findDuplicateClusters(data);
  const inputCls = "w-full px-3 py-2 border border-slate-700 rounded-lg";

  return (
    <>
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{editing ? "Edit Pilot Profile" : "Add Pilot Profile"}</h2>
          {editing && <button onClick={() => setEditingId(null)} className="text-sm text-slate-400 hover:text-slate-200">Cancel edit</button>}
        </div>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">First Name</label>
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Last Name</label>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Employee #</label>
            <input value={form.employeeNumber} onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">License #</label>
            <input value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} className={inputCls} />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 rounded-lg transition">
              {editing ? "Save Changes" : "Add Pilot"}
            </button>
          </div>
        </form>
      </div>

      {clusters.length > 0 && !dupesDismissed && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-amber-300">Possible duplicate pilots</h3>
            <button onClick={() => setDupesDismissed(true)} className="text-xs text-amber-300 hover:text-amber-200">Dismiss</button>
          </div>
          <div className="space-y-3">
            {clusters.map((group, gi) => (
              <DuplicateGroup key={gi} group={group} data={data} onMerge={(target, sources) => mutate((d) => applyMerge(d, target, sources))} />
            ))}
          </div>
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold">Pilot Profiles</h2>
          <span className="text-sm text-slate-400">{data.pilots.length} {data.pilots.length === 1 ? "profile" : "profiles"}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                {["Name", "Employee #", "License #", "Flights"].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}
                <th className="py-2 pr-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.pilots.map((p) => {
                const flightCount = data.flights.filter((f) => f.pilotId === p.id).length;
                const others = data.pilots.filter((x) => x.id !== p.id);
                return (
                  <tr key={p.id} className="border-b border-slate-800/60 hover:bg-slate-800/60">
                    <td className="py-2 pr-3 font-medium">{pilotName(data, p.id) || "(unnamed)"}</td>
                    <td className="py-2 pr-3">{p.employeeNumber || "—"}</td>
                    <td className="py-2 pr-3">{p.licenseNumber || "—"}</td>
                    <td className="py-2 pr-3">{flightCount}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {others.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) mergeInto(p.id, v); }}
                          className="text-xs border border-slate-700 rounded px-1.5 py-1 mr-2"
                        >
                          <option value="">Merge into…</option>
                          {others.map((o) => <option key={o.id} value={o.id}>{pilotName(data, o.id)}</option>)}
                        </select>
                      )}
                      <button onClick={() => setEditingId(p.id)} className="text-cyan-400 hover:text-cyan-300 font-medium mr-3">Edit</button>
                      <button onClick={() => del(p.id)} className="text-red-500 hover:text-red-700 font-medium">Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data.pilots.length && <p className="text-center text-slate-400 py-8">No pilot profiles yet. Add your first above.</p>}
      </div>
    </>
  );
}

// Standalone so its "keep" select keeps state across parent re-renders.
function DuplicateGroup({
  group, data, onMerge,
}: {
  group: Pilot[];
  data: import("@/lib/types").AppData;
  onMerge: (target: string, sources: string[]) => void;
}) {
  const counted = group
    .map((p) => ({ p, n: flightRefCount(data, [p.id]) }))
    .sort((a, b) => b.n - a.n);
  const [target, setTarget] = useState(counted[0].p.id);

  function doMerge() {
    const sources = counted.map((c) => c.p.id).filter((id) => id !== target);
    if (!sources.length) return;
    const refs = flightRefCount(data, sources);
    const names = sources.map((id) => `"${pilotName(data, id)}"`).join(", ");
    if (!confirm(
      `Merge ${names} into "${pilotName(data, target)}"?\n\n` +
        `${refs} flight reference${refs === 1 ? "" : "s"} will be reassigned, then ${sources.length} duplicate profile${sources.length === 1 ? "" : "s"} will be deleted.\n\nThis cannot be undone.`,
    )) return;
    onMerge(target, sources);
  }

  return (
    <div className="bg-slate-900/60 rounded-lg p-3 border border-amber-500/20">
      <div className="text-sm text-slate-300 mb-2">Group: <b>{group.map((p) => pilotName(data, p.id)).join(", ")}</b></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-400">Keep:</label>
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="text-sm border border-slate-700 rounded px-2 py-1">
          {counted.map(({ p, n }) => <option key={p.id} value={p.id}>{pilotName(data, p.id) || "(unnamed)"} — {n} flight{n === 1 ? "" : "s"}</option>)}
        </select>
        <button onClick={doMerge} className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3 py-1.5 rounded transition">
          Merge {group.length - 1} duplicate{group.length - 1 === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}
