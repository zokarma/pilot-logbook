"use client";

import { usePathname, useRouter } from "next/navigation";
import { useData, SyncState } from "@/context/DataContext";
import BugReporter from "./BugReporter";
import { NAV } from "./Sidebar";

const SYNC: Record<Exclude<SyncState, null>, { text: string; cls: string }> = {
  syncing: { text: "↻ Syncing…", cls: "text-sky-300" },
  ok: { text: "☁ Synced", cls: "text-emerald-300" },
  offline: { text: "⚡ Offline", cls: "text-amber-300" },
  error: { text: "✗ Sync Error", cls: "text-red-400" },
};

export default function TopBar() {
  const { data, currentUser, cloud, syncState, logout } = useData();
  const router = useRouter();
  const pathname = usePathname();
  const sync = cloud && syncState ? SYNC[syncState] : null;

  // Show the current page's name (from the same nav list the Sidebar uses).
  // Normalise the trailing slash added by the static export before matching.
  const currentPath = pathname.replace(/\/+$/, "") || "/";
  const pageTitle = NAV.find((n) => n.href === currentPath)?.label ?? "Logbook";

  const profile = data.profile;
  const holderName =
    (profile?.displayName?.trim()) ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();
  const logbookTitle = holderName ? `${holderName}'s Logbook` : "Pilot Logbook";

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800">
      <div className="px-4 lg:px-8 py-4 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-white">{pageTitle}</h1>
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
        <span className="font-semibold text-slate-200">{logbookTitle}</span>
        {profile?.role && <span className="text-xs text-slate-500">· {profile.role}</span>}
      </div>
    </header>
  );
}
