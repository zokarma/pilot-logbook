"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BugReporter from "./BugReporter";
import { useEntitlement } from "@/hooks/useEntitlement";

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
    href: "/fleet",
    label: "Fleet",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12h20M12 2l4 10H8l4-10z" /><path d="M6 12l-2 5h16l-2-5" /><path d="M10 17v3M14 17v3" />
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
    href: "/currency",
    label: "Currency",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5" /><path d="M9 2h6" />
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
];
// The Bug Reports page is reached via the sidebar's "Report Bug" modal ("View
// past reports"), not the main nav — filing and browsing would otherwise show
// up as two near-identical menu entries.

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { isPremium, ready: entReady } = useEntitlement();

  // On phones the sidebar is an overlay drawer — navigating should dismiss it.
  const onNavigate = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) onClose();
  };

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
          <Link key={n.href} href={n.href} title={n.label} onClick={onNavigate} data-tour={"nav" + n.href} className={itemCls(pathname === n.href)}>
            {n.icon}
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>

      {entReady && !isPremium && (
        <div className="px-3 mt-4">
          <Link
            href="/pricing"
            onClick={onNavigate}
            title="Upgrade your plan"
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-brand-500 to-brand-700 hover:from-brand-400 hover:to-brand-600 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l2.5 6.5L21 9l-5 4 1.5 7L12 16l-5.5 4L8 13 3 9l6.5-.5z" />
            </svg>
            Upgrade
          </Link>
        </div>
      )}

      <div className="px-3 mt-4 border-t border-slate-800 pt-3">
        <BugReporter variant="nav" />
      </div>
      </aside>
    </>
  );
}
