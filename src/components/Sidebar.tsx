"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useData } from "@/context/DataContext";

export const NAV: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="12" width="8" height="9" rx="1.5" /><rect x="3" y="15" width="8" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/logger",
    label: "Flight Logs",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3v3M16 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /><path d="M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    href: "/routemap",
    label: "Route Map",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 20l-6-3V4l6 3 6-3 6 3v13l-6-3-6 3z" /><path d="M9 7v13M15 4v13" />
      </svg>
    ),
  },
  {
    href: "/duty",
    label: "Duty Tracker",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
      </svg>
    ),
  },
  {
    href: "/documents",
    label: "Documents",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" />
      </svg>
    ),
  },
  {
    href: "/pilots",
    label: "Pilots",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.25" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17.5" cy="9.5" r="2.5" /><path d="M15.5 20a4.5 4.5 0 0 1 6.7-3.9" />
      </svg>
    ),
  },
  {
    href: "/bugs",
    label: "Bug Reports",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8a4 4 0 0 1 4 4v3a4 4 0 1 1-8 0v-3a4 4 0 0 1 4-4z" /><path d="M8 12H3M21 12h-5M9 6l-2-2M15 6l2-2M9 18l-2 2M15 18l2 2M8 9l-2-1M16 9l2-1" />
      </svg>
    ),
  },
];

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { cloud, currentUser, deleteAccount } = useData();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // On phones the sidebar is an overlay drawer — navigating should dismiss it.
  const onNavigate = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) onClose();
  };

  async function onDeleteAccount() {
    if (!confirm("Permanently delete your account and ALL your logbook data? This cannot be undone.")) return;
    if (!confirm("Are you absolutely sure? Deletion is immediate and permanent.")) return;
    setDeleting(true);
    setDeleteErr(null);
    const res = await deleteAccount();
    setDeleting(false);
    if (res.error) { setDeleteErr(res.error); return; }
    setSettingsOpen(false);
    router.replace("/login");
  }

  const itemCls = (active: boolean) =>
    "nav-item w-full flex items-center justify-start gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border-l-2 " +
    (active
      ? "bg-slate-800/80 text-white border-brand-400"
      : "text-slate-400 border-transparent hover:bg-slate-800/60 hover:text-slate-100");

  if (!open) return null;

  return (
    <>
      {/* Phone: drawer over the page; tap the scrim to dismiss. */}
      <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} />
      <aside className="w-60 shrink-0 bg-slate-900 lg:bg-slate-900/80 border-r border-slate-800 flex flex-col py-5 fixed inset-y-0 left-0 lg:sticky lg:top-0 h-screen z-40 lg:z-20 safe-top safe-left">
      <Link
        href="/dashboard"
        title="Go to dashboard"
        onClick={onNavigate}
        className="flex items-center gap-2 px-5 mb-8 justify-start hover:opacity-80 transition"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-brand-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z" />
        </svg>
        <span className="font-bold text-base tracking-tight text-white">pilotlogbook.ca</span>
      </Link>

      <nav className="flex-1 flex flex-col gap-1 px-3">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} title={n.label} onClick={onNavigate} className={itemCls(pathname === n.href)}>
            {n.icon}
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>

      <div className="px-3 mt-4 border-t border-slate-800 pt-3">
        <button onClick={() => setSettingsOpen(true)} title="Cloud sync status" className={itemCls(false)}>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Settings</span>
        </button>
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
          <div className="modal-card w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Settings</h3>
              <button onClick={() => setSettingsOpen(false)} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">&times;</button>
            </div>
            {cloud ? (
              <p className="text-sm text-slate-300">
                <span className="text-emerald-400 font-medium">Connected.</span> Your data syncs to Supabase (secured by
                per-user Row Level Security) and is mirrored to this device for offline use.
                {currentUser && <> Signed in as <span className="text-slate-100">{currentUser}</span>.</>}
              </p>
            ) : (
              <p className="text-sm text-slate-300">
                <span className="text-amber-300 font-medium">Local-only mode.</span> Supabase isn&apos;t configured, so your
                data lives in this browser only. Set the Supabase environment variables to enable cloud sync — see the README.
              </p>
            )}

            {cloud && (
              <div className="mt-6 pt-5 border-t border-slate-800">
                <h4 className="text-sm font-semibold text-red-300 mb-1">Danger zone</h4>
                <p className="text-xs text-slate-400 mb-3">
                  Permanently delete your account and all your logbook data. This cannot be undone.
                </p>
                {deleteErr && <p className="text-xs text-red-400 mb-2">{deleteErr}</p>}
                <button
                  onClick={onDeleteAccount}
                  disabled={deleting}
                  className="text-sm font-medium bg-red-600/90 hover:bg-red-600 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition"
                >
                  {deleting ? "Deleting…" : "Delete account"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      </aside>
    </>
  );
}
