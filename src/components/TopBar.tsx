"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData, SyncState } from "@/context/DataContext";
import { pilotName } from "@/lib/logbook";
import BugReporter from "./BugReporter";

const SYNC: Record<Exclude<SyncState, null>, { text: string; cls: string }> = {
  syncing: { text: "↻ Syncing…", cls: "text-sky-300" },
  ok: { text: "☁ Synced", cls: "text-emerald-300" },
  offline: { text: "⚡ Offline", cls: "text-amber-300" },
  error: { text: "✗ Sync Error", cls: "text-red-400" },
};

export default function TopBar() {
  const { data, currentUser, cloud, syncState, logout, mutate } = useData();
  const router = useRouter();
  const sync = cloud && syncState ? SYNC[syncState] : null;

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800">
      <div className="px-4 lg:px-8 py-4 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">LOGBOOK</h1>
        <div className="flex items-center gap-3 text-sm">
          {sync && <span className={"text-xs font-medium " + sync.cls}>{sync.text}</span>}
          <span className="hidden sm:inline text-slate-400">
            Hi, <span className="font-medium text-slate-100">{currentUser}</span>
          </span>
          <BugReporter />
          <button onClick={onLogout} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg transition">
            Log Out
          </button>
          <div className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center text-white shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21a8 8 0 1 0-16 0" /><circle cx="12" cy="8" r="4" />
            </svg>
          </div>
        </div>
      </div>
      <div className="px-4 lg:px-8 pb-3 flex items-center gap-2 text-sm flex-wrap">
        <span className="text-slate-400">Logbook for:</span>
        {data.pilots.length ? (
          <select
            value={data.currentPilotId ?? ""}
            onChange={(e) => mutate((d) => { d.currentPilotId = e.target.value || null; })}
            className="bg-slate-800 text-slate-100 text-sm rounded-lg px-2 py-1 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          >
            {data.pilots.map((p) => (
              <option key={p.id} value={p.id}>{pilotName(data, p.id) || "(unnamed)"}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-amber-300">
            No pilot profiles yet —{" "}
            <Link href="/pilots" className="underline hover:text-white">add one in the Pilots tab</Link>
          </span>
        )}
      </div>
    </header>
  );
}
