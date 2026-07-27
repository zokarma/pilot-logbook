"use client";

// Demo-mode banner. Always visible while exploring the demo (deliberately not
// dismissible) so a visitor is never confused about whether what they're
// looking at is their own logbook, and always has one click to sign up.

import Link from "next/link";
import { useData } from "@/context/DataContext";
import { exitDemoSession } from "@/lib/demoSession";

export default function DemoBanner() {
  const { demo } = useData();
  if (!demo) return null;

  function leave() {
    exitDemoSession();
    // Full reload so DataContext reboots out of demo mode.
    window.location.href = "/";
  }

  return (
    <div className="bg-brand-600/15 border-b border-brand-500/30">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 lg:px-8 py-2">
        <p className="text-sm text-slate-200 min-w-0">
          <span className="font-semibold text-brand-300">Demo</span>
          <span className="mx-2 text-slate-500">·</span>
          Sample logbook — explore anything. Changes aren&apos;t saved.
        </p>
        <span className="flex items-center gap-3 shrink-0">
          <button onClick={leave} className="text-xs font-medium text-slate-400 hover:text-slate-200">
            Exit demo
          </button>
          <Link
            href="/login"
            className="text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white px-3.5 py-1.5 rounded-lg transition"
          >
            Create free account
          </Link>
        </span>
      </div>
    </div>
  );
}
