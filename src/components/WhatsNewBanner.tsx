"use client";

import { useEffect, useState } from "react";

// One-time "what's new" announcement for existing users after an upgrade. New
// users (who just did the guided tour) never see it — the caller gates on
// `active`. Dismissal is remembered per-device by version, so bumping the
// version below re-announces; patch bumps that don't change the list shouldn't.

export const WHATSNEW_KEY = "plb_whatsnew_seen";
export const WHATSNEW_VERSION = "0.14";
const KEY = WHATSNEW_KEY;
const WHATS_NEW = {
  version: WHATSNEW_VERSION,
  title: "What's new",
  items: [
    "Expiry reminders — get a heads-up before documents & recurrent training lapse",
    "Undo deletes — remove a flight, then restore it from the toast",
    "Search and date filters on your flight log",
    "Type a tail number and the aircraft type fills itself in",
    "Log circuits — multiple landings on a single flight",
    "Route map: place your own airfields so every flight shows",
  ],
};

export default function WhatsNewBanner({ active }: { active: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) return;
    try {
      if (localStorage.getItem(KEY) !== WHATS_NEW.version) setShow(true);
    } catch { /* ignore */ }
  }, [active]);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    try { localStorage.setItem(KEY, WHATS_NEW.version); } catch { /* ignore */ }
  }

  return (
    <div className="card p-4 mb-6 border border-brand-500/30 bg-brand-500/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-300 bg-brand-500/10 px-2 py-0.5 rounded-full">
              New · v{WHATS_NEW.version}
            </span>
            <h2 className="font-semibold text-sm">{WHATS_NEW.title}</h2>
          </div>
          <ul className="space-y-1">
            {WHATS_NEW.items.map((it) => (
              <li key={it} className="flex items-start gap-2 text-sm text-slate-300">
                <svg className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span>{it}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => { dismiss(); window.dispatchEvent(new Event("plb-start-tour")); }}
            className="mt-3 text-xs font-medium text-brand-300 hover:text-brand-200"
          >
            Take the guided tour →
          </button>
        </div>
        <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-slate-400 hover:text-slate-200 text-xl leading-none -mt-1">
          &times;
        </button>
      </div>
    </div>
  );
}
