"use client";

import { useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { uid } from "@/lib/id";
import {
  builtinCurrencyStatuses, customCurrencyStatuses, CurrencyStatus,
  CURRENCY_METRICS, METRIC_LABELS, CurrencyMetric,
} from "@/lib/currency";
import { documentStatus, STATUS_META } from "@/lib/documents";
import { fleetTypes, normalizeAircraftCode } from "@/lib/aircraft";
import { CurrencyRule } from "@/lib/types";
import { useUi } from "@/components/UiProvider";

// A currency that lapses within this many days shows amber.
const WARN_DAYS = 30;

function daysUntil(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((new Date(y, (m || 1) - 1, d || 1).getTime() - today) / 86400000);
}

function StatusCard({ s, onDelete, hidden, onToggleHide }: { s: CurrencyStatus; onDelete?: () => void; hidden?: boolean; onToggleHide?: () => void }) {
  const days = s.lapsesOn ? daysUntil(s.lapsesOn) : null;
  const tone = !s.ok ? "red" : days !== null && days <= WARN_DAYS ? "amber" : "green";
  const toneCls = tone === "red" ? "border-red-500/40" : tone === "amber" ? "border-amber-400/40" : "border-emerald-500/30";
  const badge = tone === "red"
    ? <span className="text-xs font-semibold text-red-400">NOT CURRENT</span>
    : tone === "amber"
      ? <span className="text-xs font-semibold text-amber-300">LAPSES IN {days}d</span>
      : <span className="text-xs font-semibold text-emerald-400">CURRENT</span>;

  return (
    <div className={`card p-4 border ${toneCls}` + (hidden ? " opacity-50" : "")}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="font-semibold text-sm">{s.name}{hidden && <span className="text-slate-500 font-normal"> · hidden</span>}</h3>
          {s.regRef && <p className="text-[11px] text-slate-500">{s.regRef} · reference only</p>}
        </div>
        <span className="flex items-center gap-3">
          {badge}
          {onToggleHide && (
            <button onClick={onToggleHide} className="text-xs text-slate-400 hover:text-slate-200">{hidden ? "Show" : "Hide"}</button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-300">Remove</button>
          )}
        </span>
      </div>
      <div className="space-y-1.5">
        {s.components.map((c) => (
          <div key={c.metric} className="text-sm">
            <div className="flex justify-between text-xs mb-0.5">
              <span className={c.ok ? "text-slate-300" : "text-red-300"}>{c.label}</span>
              <span className={c.ok ? "text-slate-400" : "text-red-300"}>
                {c.value} / {c.threshold}{!c.ok && ` — ${Math.ceil((c.threshold - c.value) * 10) / 10} to go`}
              </span>
            </div>
            <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded ${c.ok ? "bg-emerald-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(100, (c.value / Math.max(c.threshold, 0.001)) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {s.ok && s.lapsesOn && (
        <p className="text-[11px] text-slate-500 mt-2">Current until {s.lapsesOn} (if nothing new is logged)</p>
      )}
    </div>
  );
}

export default function CurrencyPage() {
  const { data, mutate } = useData();
  const { toast } = useUi();
  const [form, setForm] = useState({ name: "", metric: "landings" as CurrencyMetric, threshold: "3", windowDays: "90", aircraftType: "" });
  const [msg, setMsg] = useState("");
  // The add-rule form is collapsed behind the header button (same pattern as
  // the logger's "Add a Flight") so it's discoverable without scrolling.
  const [showAdd, setShowAdd] = useState(false);

  const builtins = useMemo(() => builtinCurrencyStatuses(data), [data]);
  const customs = useMemo(() => customCurrencyStatuses(data), [data]);

  const hiddenSet = useMemo(() => new Set(data.currencyHidden ?? []), [data.currencyHidden]);
  function toggleHidden(key: string) {
    mutate((draft) => {
      if (!Array.isArray(draft.currencyHidden)) draft.currencyHidden = [];
      draft.currencyHidden = draft.currencyHidden.includes(key)
        ? draft.currencyHidden.filter((k) => k !== key)
        : [...draft.currencyHidden, key];
    });
  }

  // 24-month recurrent training rides on the Documents system.
  const recurrentDoc = useMemo(() => {
    const docs = data.documents.filter((d) => d.type === "Recurrent Training");
    if (!docs.length) return null;
    return [...docs].sort((a, b) => (b.expiryDate || "").localeCompare(a.expiryDate || ""))[0];
  }, [data.documents]);
  const recurrentStatus = recurrentDoc ? documentStatus(recurrentDoc) : null;

  function addRule(e: React.FormEvent) {
    e.preventDefault();
    const threshold = parseFloat(form.threshold);
    const windowDays = parseInt(form.windowDays, 10);
    if (!(threshold > 0)) { setMsg("Threshold must be a positive number."); return; }
    if (!(windowDays > 0)) { setMsg("Window must be a positive number of days."); return; }
    mutate((draft) => {
      if (!Array.isArray(draft.currencyRules)) draft.currencyRules = [];
      const rule: CurrencyRule = {
        id: uid("cr"),
        name: form.name.trim(),
        metric: form.metric,
        threshold,
        windowDays,
        ...(form.aircraftType ? { aircraftType: normalizeAircraftCode(form.aircraftType) } : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      draft.currencyRules.push(rule);
    });
    setForm({ name: "", metric: "landings", threshold: "3", windowDays: "90", aircraftType: "" });
    setMsg("");
    setShowAdd(false);
  }

  function deleteRule(id: string) {
    const removed = (data.currencyRules || []).find((r) => r.id === id);
    if (!removed) return;
    mutate((draft) => {
      draft.currencyRules = (draft.currencyRules || []).filter((r) => r.id !== id);
    });
    toast("Currency rule removed", {
      actionLabel: "Undo",
      onAction: () => mutate((draft) => {
        if (!Array.isArray(draft.currencyRules)) draft.currencyRules = [];
        draft.currencyRules.push(structuredClone(removed));
      }),
    });
  }

  const inputCls = "w-full px-3 py-2 border border-slate-700 rounded-lg";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Currency</h1>
          <p className="text-sm text-slate-400 mt-1">
            Recency at a glance, computed from your logged flights (flights without a landing count are treated as one
            takeoff and one landing). Use <span className="text-slate-200">Hide</span> on any card to drop it here and
            from the dashboard widget. These gauges are a simplified reference — the CARs, and your company minima, govern.
          </p>
        </div>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Rule
          </button>
        )}
      </div>

      {showAdd && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold">Add a custom rule</h2>
            <button onClick={() => { setShowAdd(false); setMsg(""); }} className="text-sm text-slate-400 hover:text-slate-200">Close</button>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Company or personal minima, e.g. “3 landings in 90 days on C172”.
          </p>
          <form onSubmit={addRule} className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">Name (optional)</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Company: 3 in 90 on type" className={inputCls} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-slate-400 mb-1">Requirement</label>
              <select value={form.metric} onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value as CurrencyMetric }))} className={inputCls}>
                {CURRENCY_METRICS.map((m) => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">At least</label>
              <input inputMode="decimal" value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">In the last (days)</label>
              <input inputMode="numeric" value={form.windowDays} onChange={(e) => setForm((f) => ({ ...f, windowDays: e.target.value }))} className={inputCls} />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-slate-400 mb-1">Aircraft type (optional)</label>
              <select value={form.aircraftType} onChange={(e) => setForm((f) => ({ ...f, aircraftType: e.target.value }))} className={inputCls}>
                <option value="">Any type</option>
                {fleetTypes(data.fleet, data.fleetHidden).map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
              </select>
            </div>
            <div className="col-span-2 lg:col-span-6 flex items-center gap-3">
              <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 rounded-lg transition">
                Add rule
              </button>
              {msg && <p className="text-sm text-red-400">{msg}</p>}
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {builtins.map((s) => (
          <StatusCard key={s.key} s={s} hidden={hiddenSet.has(s.key)} onToggleHide={() => toggleHidden(s.key)} />
        ))}

        {/* Recurrent training — document-driven */}
        <div className={`card p-4 border ${!recurrentStatus ? "border-slate-700" : recurrentStatus.status === "expired" ? "border-red-500/40" : recurrentStatus.status === "expiring" ? "border-amber-400/40" : "border-emerald-500/30"}` + (hiddenSet.has("recurrent-training") ? " opacity-50" : "")}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <h3 className="font-semibold text-sm">Recurrent training — 24 months{hiddenSet.has("recurrent-training") && <span className="text-slate-500 font-normal"> · hidden</span>}</h3>
              <p className="text-[11px] text-slate-500">CAR 401.05(2) · reference only</p>
            </div>
            <span className="flex items-center gap-3">
              {recurrentStatus ? (
                <span className={`text-xs font-semibold ${STATUS_META[recurrentStatus.status].cls}`}>
                  {STATUS_META[recurrentStatus.status].short.toUpperCase()}
                </span>
              ) : (
                <span className="text-xs font-semibold text-slate-400">NOT ON FILE</span>
              )}
              <button onClick={() => toggleHidden("recurrent-training")} className="text-xs text-slate-400 hover:text-slate-200">
                {hiddenSet.has("recurrent-training") ? "Show" : "Hide"}
              </button>
            </span>
          </div>
          {recurrentStatus ? (
            <p className="text-sm text-slate-300">{recurrentStatus.label}</p>
          ) : (
            <p className="text-sm text-slate-400">
              Add a <span className="text-slate-200">Recurrent Training</span> document on the Documents page (expiry
              auto-calculates at 24 months from the issue date).
            </p>
          )}
        </div>

        {customs.map((s) => (
          <StatusCard key={s.key} s={s} hidden={hiddenSet.has(s.key)} onToggleHide={() => toggleHidden(s.key)} onDelete={() => deleteRule(s.key)} />
        ))}
      </div>

      <p className="text-[11px] text-slate-500">
        Tip: log landing and approach counts on each flight (the flight form has Landings and Approaches fields) so
        these gauges track reality — older flights without counts are assumed to be one takeoff and one landing.
      </p>
    </div>
  );
}
