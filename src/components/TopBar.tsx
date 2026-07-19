"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useData, SyncState } from "@/context/DataContext";
import { NAV } from "./Sidebar";
import SettingsModal from "./SettingsModal";
import ProfileModal from "./ProfileModal";

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
  // Pages reachable outside the sidebar NAV still need a heading.
  const EXTRA_TITLES: Record<string, string> = { "/bugs": "Bug Reports" };
  const pageTitle = NAV.find((n) => n.href === currentPath)?.label ?? EXTRA_TITLES[currentPath] ?? "Logbook";

  const profile = data.profile;
  const holderName =
    (profile?.displayName?.trim()) ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();
  const logbookTitle = holderName ? `${holderName}'s Logbook` : "Pilot Logbook";

  // Profile menu (avatar dropdown) + the modals it opens.
  const [menuOpen, setMenuOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  const menuItemCls = "w-full text-left px-4 py-2.5 text-sm hover:bg-slate-800 transition flex items-center gap-2.5";

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
          <span className="hidden sm:inline font-medium text-slate-300 truncate max-w-[16rem]">{logbookTitle}</span>
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
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Profile menu"
              title="Profile menu"
              className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center text-white overflow-hidden ring-offset-2 ring-offset-slate-950 hover:ring-2 hover:ring-brand-400 transition"
            >
              {profile?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21a8 8 0 1 0-16 0" /><circle cx="12" cy="8" r="4" />
                </svg>
              )}
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-800 bg-slate-900 shadow-xl shadow-black/40 py-2 z-50">
                <div className="px-4 pb-2 mb-1 border-b border-slate-800">
                  <p className="text-sm font-medium text-slate-100 truncate">{holderName || "Pilot"}</p>
                  <p className="text-xs text-slate-500 truncate">{currentUser}</p>
                </div>
                <button onClick={() => { setMenuOpen(false); setShowProfile(true); }} className={menuItemCls + " text-slate-200"}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21a8 8 0 1 0-16 0" /><circle cx="12" cy="8" r="4" />
                  </svg>
                  Pilot Profile
                </button>
                <button onClick={() => { setMenuOpen(false); setShowSettings(true); }} className={menuItemCls + " text-slate-200"}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Settings
                </button>
                <div className="my-1 border-t border-slate-800" />
                <button onClick={() => { setMenuOpen(false); void onLogout(); }} className={menuItemCls + " text-red-400 hover:text-red-300"}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </header>
  );
}
