"use client";

import { useState } from "react";
import { useData } from "@/context/DataContext";
import { useUi } from "@/components/UiProvider";

const SEV_COLOR: Record<string, string> = {
  "data-loss": "bg-red-500/15 text-red-300",
  high: "bg-orange-500/15 text-orange-300",
  medium: "bg-amber-500/15 text-amber-300",
};

export default function BugsPage() {
  const { data, mutate } = useData();
  const { toast } = useUi();
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");

  const reports = (data.bugReports || [])
    .slice()
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const filtered = reports.filter(
    (r) =>
      filter === "all" ||
      (filter === "open" && r.status !== "resolved") ||
      (filter === "resolved" && r.status === "resolved"),
  );

  function setStatus(id: string, status: string) {
    mutate((d) => {
      const r = d.bugReports.find((x) => x.id === id);
      if (r) r.status = status;
    });
  }

  function del(id: string) {
    const removed = (data.bugReports || []).find((r) => r.id === id);
    if (!removed) return;
    mutate((d) => { d.bugReports = d.bugReports.filter((r) => r.id !== id); });
    toast("Bug report deleted", {
      actionLabel: "Undo",
      onAction: () => mutate((d) => { d.bugReports.push(structuredClone(removed)); }),
    });
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold">Bug Reports</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="text-sm border border-slate-700 rounded-lg px-3 py-2">
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      <div className="space-y-3">
        {filtered.map((r) => {
          const sevColor = SEV_COLOR[r.severity] || "bg-slate-700/50 text-slate-300";
          const when = (r.created_at || "").replace("T", " ").slice(0, 16);
          const shortDesc = (r.description || "").slice(0, 200);
          return (
            <div key={r.id} className="border border-slate-800 rounded-lg p-3">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === "resolved" ? (
                    <span className="text-xs bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded-full">resolved</span>
                  ) : (
                    <span className="text-xs bg-sky-500/15 text-sky-300 px-2 py-0.5 rounded-full">open</span>
                  )}
                  <span className={"text-xs px-2 py-0.5 rounded-full " + sevColor}>{r.severity || "—"}</span>
                  <span className="text-xs text-slate-400">{when} · {r.username} · <i>{r.tab}</i></span>
                </div>
                <div className="flex gap-2">
                  {r.status === "resolved" ? (
                    <button onClick={() => setStatus(r.id, "open")} className="text-xs text-sky-400 hover:text-sky-300">Reopen</button>
                  ) : (
                    <button onClick={() => setStatus(r.id, "resolved")} className="text-xs text-emerald-400 hover:text-emerald-300">Mark resolved</button>
                  )}
                  <button onClick={() => del(r.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                </div>
              </div>
              <div className="text-sm text-slate-100 mb-2 whitespace-pre-line">
                {shortDesc}{r.description && r.description.length > 200 ? "…" : ""}
              </div>
              {r.steps && <div className="text-xs text-slate-400 mb-2 whitespace-pre-line"><b>Steps:</b> {r.steps}</div>}
              {r.screenshot && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-200">View screenshot</summary>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.screenshot} alt="Bug screenshot" className="mt-2 max-h-64 rounded border border-slate-700" />
                </details>
              )}
              <details className="text-xs text-slate-400 mt-1">
                <summary className="cursor-pointer hover:text-slate-200">Diagnostics</summary>
                <pre className="mt-1 p-2 bg-slate-900/60 rounded text-[10px] leading-relaxed overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify({ tab: r.tab, url: r.url, user_agent: r.user_agent, viewport: r.viewport, app_version: r.app_version, app_state: r.app_state, recent_errors: r.recent_errors }, null, 2)}
                </pre>
              </details>
            </div>
          );
        })}
      </div>
      {!filtered.length && (
        <p className="text-center text-slate-400 py-8">
          No bug reports yet. Click <b>Report Bug</b> in the header to file one.
        </p>
      )}
    </div>
  );
}
