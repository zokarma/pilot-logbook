"use client";

// CSV import wizard — the "staging area" between picking a file and committing
// flights. Three steps:
//   1. Match columns   — auto-proposed mapping (heuristics or a saved
//                        template), user reviews/fixes via dropdowns.
//   2. Who are you?    — only when PIC/SIC name columns are mapped; replaces
//                        the old window.prompt() identity question.
//   3. Preview & import — dry-run stats + first rows as they'd land.
// All real logic lives in src/lib/importMap.ts (pure); this file is UI only.

import { useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { migrateData } from "@/lib/migrate";
import { normalizeName } from "@/lib/csv";
import {
  ColumnMapping, TARGET_FIELDS, applyMappedImport, applyTemplate, collectCrewNames,
  findTemplate, mappingHasDate, planImport, proposeMapping,
} from "@/lib/importMap";

export interface WizardInput {
  headers: string[];
  rows: string[][];
  dataStart: number;   // index of the first data row
  structured: boolean; // came from a multi-header paper-logbook export
}

const FIELD_GROUPS: { group: string; fields: typeof TARGET_FIELDS }[] = (() => {
  const groups: { group: string; fields: typeof TARGET_FIELDS }[] = [];
  for (const f of TARGET_FIELDS) {
    const g = groups.find((x) => x.group === f.group);
    if (g) g.fields.push(f);
    else groups.push({ group: f.group, fields: [f] });
  }
  return groups;
})();

function confidenceBadge(c: ColumnMapping) {
  if (!c.field) {
    return <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 whitespace-nowrap">needs review</span>;
  }
  if (c.source === "user") return <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">you</span>;
  if (c.source === "template") return <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">saved</span>;
  if (c.confidence >= 0.9) return <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">auto</span>;
  return <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">guess</span>;
}

export default function ImportWizard({
  input, onClose, onDone,
}: {
  input: WizardInput;
  onClose: () => void;
  onDone: (msg: { text: string; kind: "ok" | "error" }) => void;
}) {
  const { data, replace } = useData();
  const { headers, rows, dataStart } = input;

  const [mapping, setMapping] = useState<ColumnMapping[]>(() => {
    const tpl = findTemplate(data, headers);
    return tpl ? applyTemplate(tpl, headers, rows, dataStart) : proposeMapping(headers, rows, dataStart);
  });
  const fromTemplate = useMemo(() => !!findTemplate(data, headers), [data, headers]);

  // Identity step state.
  const crewNames = useMemo(() => collectCrewNames(rows, dataStart, mapping), [rows, dataStart, mapping]);
  const [ownerSel, setOwnerSel] = useState<Set<string>>(new Set());
  const [ownerExtra, setOwnerExtra] = useState("");
  const identityApplies = crewNames.length > 0;

  const steps = identityApplies ? ["Match columns", "Who are you?", "Preview"] : ["Match columns", "Preview"];
  const [stepIdx, setStepIdx] = useState(0);
  const onPreviewStep = stepIdx === steps.length - 1;
  const [busy, setBusy] = useState(false);

  const ownerNames = useMemo(() => {
    const names = [...ownerSel, ...ownerExtra.split(",")].map((s) => normalizeName(s.trim())).filter(Boolean);
    return Array.from(new Set(names));
  }, [ownerSel, ownerExtra]);

  const dateOk = mappingHasDate(mapping);
  const mappedCount = mapping.filter((c) => c.field).length;

  const plan = useMemo(
    () => (onPreviewStep ? planImport(rows, dataStart, mapping, ownerNames) : null),
    [onPreviewStep, rows, dataStart, mapping, ownerNames],
  );

  function setField(index: number, field: string | null) {
    setMapping((prev) => prev.map((c) => {
      if (c.index === index) return { ...c, field, confidence: field ? 1 : 0, source: (field ? "user" : "none") as ColumnMapping["source"] };
      if (field && c.field === field) return { ...c, field: null, confidence: 0, source: "none" as const }; // one column per field
      return c;
    }));
  }

  function resetAuto() {
    setMapping(proposeMapping(headers, rows, dataStart));
  }

  function commit() {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const working = migrateData(structuredClone(data));
      const res = applyMappedImport(working, rows, dataStart, mapping, ownerNames);
      replace(res.data);
      let msg = `Imported ${res.added} flight${res.added === 1 ? "" : "s"}`;
      if (ownerNames.length && (res.roleCounts.Captain || res.roleCounts.Student)) {
        msg += ` — ${res.roleCounts.Captain} as Captain, ${res.roleCounts.Student} as Student`;
      }
      if (res.skipped) msg += `, skipped ${res.skipped} row${res.skipped === 1 ? "" : "s"}`;
      onDone({ text: msg + ".", kind: res.added ? "ok" : "error" });
    } catch {
      setBusy(false);
      onDone({ text: "Import failed — please check the file and try again.", kind: "error" });
    }
  }

  // Aggregate skip reasons for the preview summary.
  const skipReasons = useMemo(() => {
    if (!plan) return [];
    const counts = new Map<string, number>();
    plan.rows.forEach((p) => { if (!p.ok && p.reason) counts.set(p.reason, (counts.get(p.reason) || 0) + 1); });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [plan]);

  const previewRows = useMemo(() => (plan ? plan.rows.slice(0, 15) : []), [plan]);

  const selectCls = "bg-slate-900/70 border border-slate-700 rounded-lg px-2 py-1.5 text-sm w-full";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card w-full max-w-3xl p-6 max-h-[90vh] flex flex-col">
        {/* Header + progress */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Import CSV</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">&times;</button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            {steps.map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1 min-w-0">
                <span className={"w-5 h-5 shrink-0 rounded-full text-[11px] flex items-center justify-center font-semibold " + (i <= stepIdx ? "bg-brand-600 text-white" : "bg-slate-800 text-slate-400")}>{i + 1}</span>
                <span className={"text-xs truncate " + (i === stepIdx ? "text-slate-200 font-medium" : "text-slate-500")}>{label}</span>
                {i < steps.length - 1 && <span className={"h-px flex-1 " + (i < stepIdx ? "bg-brand-500" : "bg-slate-800")} />}
              </div>
            ))}
          </div>
        </div>

        {/* Step: match columns */}
        {stepIdx === 0 && (
          <>
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-sm text-slate-400">
                {fromTemplate
                  ? "Recognized this file layout from a previous import — mapping restored."
                  : <>Matched <b className="text-slate-200">{mappedCount}</b> of {mapping.filter((c) => c.header).length} columns automatically. Fix anything amber, or set columns to “Don’t import”.</>}
                {input.structured && <span className="block text-xs text-slate-500 mt-1">Multi-row logbook headers were combined (e.g. “Single Engine · Day”).</span>}
              </p>
              <button onClick={resetAuto} className="text-xs text-slate-400 hover:text-slate-200 shrink-0">Reset to auto</button>
            </div>
            <div className="overflow-y-auto flex-1 -mx-2 px-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs border-b border-slate-800">
                    <th className="py-1.5 pr-3 font-medium">Your column</th>
                    <th className="py-1.5 pr-3 font-medium">Sample values</th>
                    <th className="py-1.5 pr-3 font-medium w-52">Imports as</th>
                    <th className="py-1.5 font-medium w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.filter((c) => c.header).map((c) => (
                    <tr key={c.index} className="border-b border-slate-800/60 align-top">
                      <td className="py-2 pr-3 font-medium text-slate-200">{c.header}</td>
                      <td className="py-2 pr-3 text-xs text-slate-500 max-w-[180px]">
                        <span className="line-clamp-2">{c.samples.join(" · ") || "—"}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <select value={c.field ?? ""} onChange={(e) => setField(c.index, e.target.value || null)} className={selectCls}>
                          <option value="">— don’t import —</option>
                          {FIELD_GROUPS.map((g) => (
                            <optgroup key={g.group} label={g.group}>
                              {g.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 text-right">{confidenceBadge(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-slate-800">
              <p className="text-xs min-h-[1rem] text-amber-300">
                {!dateOk && "Map a Date column (or Year + Month + Day) to continue."}
              </p>
              <div className="flex gap-2 shrink-0">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-slate-800">Cancel</button>
                <button
                  onClick={() => setStepIdx(1)}
                  disabled={!dateOk}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm transition"
                >
                  Continue
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step: identity (only when name columns are mapped) */}
        {identityApplies && stepIdx === 1 && (
          <>
            <p className="text-sm text-slate-400 mb-1">
              These names appear in the crew columns. <b className="text-slate-200">Tick the ones that are you</b> — matching
              flights are logged as Captain (you as PIC) or Student (you in the student/FO seat).
            </p>
            <p className="text-xs text-slate-500 mb-3">Leave everything unticked to import every flight as Captain.</p>
            <div className="overflow-y-auto flex-1 -mx-2 px-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {crewNames.map((n) => (
                  <label key={n} className={"flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm cursor-pointer select-none " + (ownerSel.has(n) ? "border-brand-500/60 bg-brand-600/10 text-white" : "border-slate-800 text-slate-300 hover:border-slate-600")}>
                    <input
                      type="checkbox"
                      checked={ownerSel.has(n)}
                      onChange={(e) => setOwnerSel((prev) => { const next = new Set(prev); if (e.target.checked) next.add(n); else next.delete(n); return next; })}
                      className="accent-cyan-500 w-4 h-4 shrink-0"
                    />
                    <span className="truncate">{n}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4">
                <label className="block text-xs font-medium text-slate-400 mb-1">Other spellings of your name <span className="text-slate-600">(optional, comma-separated)</span></label>
                <input value={ownerExtra} onChange={(e) => setOwnerExtra(e.target.value)} placeholder="e.g. B.Pearce, Ben Pearce" className="w-full px-3 py-2 border border-slate-700 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-slate-800">
              <button onClick={() => setStepIdx(0)} className="text-sm text-slate-400 hover:text-slate-200">← Back</button>
              <button onClick={() => setStepIdx(2)} className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2 rounded-lg text-sm transition">Continue</button>
            </div>
          </>
        )}

        {/* Step: preview & import */}
        {onPreviewStep && plan && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 font-medium">{plan.added} will import</span>
              {plan.skipped > 0 && <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300">{plan.skipped} skipped</span>}
              {ownerNames.length > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-sky-500/15 text-sky-300">{plan.roleCounts.Captain} Captain · {plan.roleCounts.Student} Student</span>
              )}
            </div>
            {skipReasons.length > 0 && (
              <p className="text-xs text-slate-500 mb-2">
                Skipped: {skipReasons.map(([reason, n]) => `${n}× ${reason}`).join(", ")}
              </p>
            )}
            <div className="overflow-y-auto flex-1 -mx-2 px-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs border-b border-slate-800">
                    {["", "Date", "Aircraft", "Reg", "Route", "Hrs", "Role"].map((h, i) => <th key={i} className="py-1.5 pr-3 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((p) => (
                    <tr key={p.row} className={"border-b border-slate-800/60 " + (p.ok ? "" : "opacity-50")}>
                      <td className="py-1.5 pr-2">{p.ok ? <span className="text-emerald-400">✓</span> : <span className="text-amber-400" title={p.reason}>⚠</span>}</td>
                      {p.ok && p.flight ? (
                        <>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{p.flight.date}</td>
                          <td className="py-1.5 pr-3">{p.flight.aircraftType || "—"}</td>
                          <td className="py-1.5 pr-3">{p.flight.registration || "—"}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{p.flight.from || "?"} → {p.flight.to || "?"}</td>
                          <td className="py-1.5 pr-3">{(p.flight.se + p.flight.me).toFixed(1)}</td>
                          <td className="py-1.5 pr-3">{p.flight.loggedRole}</td>
                        </>
                      ) : (
                        <td colSpan={6} className="py-1.5 pr-3 text-xs text-slate-500">Row {p.row + 1}: {p.reason}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.rows.length > previewRows.length && (
                <p className="text-xs text-slate-600 mt-2">…and {plan.rows.length - previewRows.length} more rows.</p>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-slate-800">
              <button onClick={() => setStepIdx(stepIdx - 1)} className="text-sm text-slate-400 hover:text-slate-200">← Back</button>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-slate-800">Cancel</button>
                <button
                  onClick={commit}
                  disabled={busy || plan.added === 0}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm transition"
                >
                  {busy ? "Importing…" : `Import ${plan.added} flight${plan.added === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
