"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useData } from "@/context/DataContext";
import { pilotName } from "@/lib/logbook";
import { uid } from "@/lib/id";
import { getRecentErrors } from "@/lib/recentErrors";
import { APP_VERSION, BugReport } from "@/lib/types";

// variant "toolbar" (default) renders the original compact button; "nav"
// renders a Sidebar-style item so it can live where Settings used to be.
export default function BugReporter({ variant = "toolbar" }: { variant?: "toolbar" | "nav" }) {
  const { data, cloud, currentUser, mutate } = useData();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [screenshot, setScreenshot] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const tab = (pathname.split("/")[1] || "").trim();

  const gatherContext = useCallback(() => ({
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "",
    app_version: APP_VERSION,
    tab,
    url: typeof window !== "undefined" ? window.location.href : "",
    app_state: {
      pilot_count: data.pilots.length,
      flight_count: data.flights.length,
      current_pilot_id: data.currentPilotId || null,
      current_pilot_name: pilotName(data, data.currentPilotId) || null,
      cloud_sync: cloud,
    },
    recent_errors: getRecentErrors(),
  }), [data, cloud, tab]);

  function reset() {
    setSeverity("medium");
    setDescription("");
    setSteps("");
    setScreenshot("");
    setMsg(null);
  }

  function openModal() {
    reset();
    setOpen(true);
  }

  function readImage(file: File) {
    // Reject oversized files before reading them into memory; the data-URL
    // length check below stays as a backstop (base64 inflates by ~4/3).
    if (file.size > 2_000_000) {
      setMsg({ text: "Screenshot too large — please use one under 2MB.", ok: false });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (url.length > 2_500_000) {
        setMsg({ text: "Screenshot too large — please use one under 2MB.", ok: false });
        return;
      }
      setScreenshot(url);
    };
    reader.readAsDataURL(file);
  }

  // Paste an image from the clipboard while the modal is open.
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      for (const item of e.clipboardData?.items || []) {
        if (item.type && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) { readImage(file); e.preventDefault(); return; }
        }
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setMsg({ text: "Description is required.", ok: false });
      return;
    }
    const ctx = gatherContext();
    const report: BugReport = {
      id: uid("bug_"),
      username: currentUser || "(anonymous)",
      created_at: new Date().toISOString(),
      status: "open",
      severity,
      description: description.trim(),
      steps: steps.trim(),
      tab: ctx.tab,
      url: ctx.url,
      user_agent: ctx.user_agent,
      viewport: ctx.viewport,
      app_version: ctx.app_version,
      app_state: ctx.app_state,
      recent_errors: ctx.recent_errors,
      screenshot: screenshot || "",
    };
    mutate((d) => { d.bugReports.push(report); });
    setMsg({ text: "Submitted — thank you!", ok: true });
    setTimeout(() => setOpen(false), 800);
  }

  return (
    <>
      {variant === "nav" ? (
        <button
          onClick={openModal}
          title="Report a bug"
          className="nav-item w-full flex items-center justify-start gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border-l-2 text-slate-400 border-transparent hover:bg-slate-800/60 hover:text-slate-100"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8a4 4 0 0 1 4 4v3a4 4 0 1 1-8 0v-3a4 4 0 0 1 4-4z" /><path d="M8 12H3M21 12h-5M9 6l-2-2M15 6l2-2M9 18l-2 2M15 18l2 2M8 9l-2-1M16 9l2-1" />
          </svg>
          <span>Report Bug</span>
        </button>
      ) : (
        <button
          onClick={openModal}
          title="Report a bug"
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium px-3 py-1.5 rounded-lg transition"
        >
          Report Bug
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="modal-card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Report a Bug</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">&times;</button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Severity</label>
                <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full px-3 py-2 border border-slate-700 rounded-lg text-sm">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="data-loss">Data loss</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">What went wrong?</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full px-3 py-2 border border-slate-700 rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Steps to reproduce <span className="text-slate-400">(optional)</span></label>
                <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-700 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Screenshot <span className="text-slate-400">(optional)</span></label>
                <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) readImage(f); }} className="text-sm" />
                <p className="text-xs text-slate-400 mt-1">Or paste an image (Ctrl+V) while this modal is open.</p>
                {screenshot && (
                  <div className="mt-2 border border-slate-700 rounded-lg p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={screenshot} alt="Screenshot preview" className="max-h-40 rounded" />
                    <button type="button" onClick={() => setScreenshot("")} className="text-xs text-red-500 hover:text-red-700 mt-1">Remove</button>
                  </div>
                )}
              </div>
              <p className={"text-sm min-h-[1.25rem] " + (msg ? (msg.ok ? "text-emerald-400" : "text-red-400") : "")}>{msg?.text || ""}</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-lg hover:bg-slate-800">Cancel</button>
                <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition">Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
