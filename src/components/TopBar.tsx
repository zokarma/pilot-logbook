"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useData, SyncState } from "@/context/DataContext";
import BugReporter from "./BugReporter";
import { NAV } from "./Sidebar";

const THEME_KEY = "plb_theme";

const SYNC: Record<Exclude<SyncState, null>, { text: string; cls: string }> = {
  syncing: { text: "↻ Syncing…", cls: "text-sky-300" },
  ok: { text: "☁ Synced", cls: "text-emerald-300" },
  offline: { text: "⚡ Offline", cls: "text-amber-300" },
  error: { text: "✗ Sync Error", cls: "text-red-400" },
};

export default function TopBar({ navOpen, onToggleNav }: { navOpen: boolean; onToggleNav: () => void }) {
  const { data, currentUser, cloud, syncState, logout } = useData();
  const router = useRouter();
  const pathname = usePathname();
  const sync = cloud && syncState ? SYNC[syncState] : null;

  // Theme is applied to <html data-theme> before first paint by the inline
  // script in the root layout; this state just drives the toggle icon.
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  }

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
    // No backdrop-blur: backdrop-filter on a sticky header forces WKWebView to
    // recomposite every scroll frame — a major scroll-jank source on iOS.
    <header className="sticky top-0 z-10 bg-slate-950/95 border-b border-slate-800 safe-top">
      <div className="px-4 lg:px-8 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onToggleNav}
            aria-label={navOpen ? "Hide navigation" : "Show navigation"}
            title={navOpen ? "Hide navigation" : "Show navigation"}
            className="p-2 -ml-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-white truncate">{pageTitle}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {sync && <span className={"text-xs font-medium " + sync.cls}>{sync.text}</span>}
          <span className="hidden sm:inline text-slate-400">
            Hi, <span className="font-medium text-slate-100">{currentUser}</span>
          </span>
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="p-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition"
          >
            {theme === "dark" ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>
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
