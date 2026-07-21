"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

// Interactive coach-mark tour. Each step optionally anchors to a real element
// (via a CSS selector on a data-tour attribute); when the element is present
// and visible it gets spotlighted, otherwise the step falls back to a centered
// card (covers phones, where the sidebar drawer is hidden). Purely
// presentational — the caller decides when to show it and what onFinish does.

export interface TourStep {
  selector?: string; // e.g. '[data-tour="nav/logger"]'
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to your logbook",
    body: "A 30-second tour of where everything lives. You can skip anytime and replay it later from Settings.",
  },
  {
    selector: '[data-tour="add-flight"]',
    title: "Log a flight",
    body: "Start here. The flight form remembers your last aircraft and route, and typing a tail number fills in the aircraft type.",
  },
  {
    selector: '[data-tour="nav/logger"]',
    title: "Flight Logs",
    body: "Every flight lives here. Search, filter by date, quick-edit inline, or scan a paper logbook page on iPhone/iPad.",
  },
  {
    selector: '[data-tour="nav/dashboard"]',
    title: "Dashboard",
    body: "Your totals, recency and a snapshot of everything — customizable to show only what matters to you.",
  },
  {
    selector: '[data-tour="nav/currency"]',
    title: "Currency",
    body: "Track your recency — landings, approaches, night, and your own custom minima. Reference only, always at a glance.",
  },
  {
    selector: '[data-tour="nav/routemap"]',
    title: "Route Map",
    body: "See everywhere you've flown. Small strips you fly can be placed on the map so your whole history shows.",
  },
  {
    selector: '[data-tour="nav/fleet"]',
    title: "Fleet",
    body: "Manage the aircraft types you fly. They show up in every picker and speed up logging.",
  },
  {
    selector: '[data-tour="nav/documents"]',
    title: "Documents",
    body: "Keep licences and medicals here — expiry dates are worked out for you so nothing lapses unnoticed.",
  },
  {
    title: "You're all set",
    body: "That's the tour. Log your first flight whenever you're ready — welcome aboard.",
  },
];

interface Rect { top: number; left: number; width: number; height: number }

export default function Tour({ steps = TOUR_STEPS, onFinish }: { steps?: TourStep[]; onFinish: () => void }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[idx];
  const last = idx === steps.length - 1;

  const finish = useCallback(() => onFinish(), [onFinish]);
  const next = useCallback(() => (last ? finish() : setIdx((i) => i + 1)), [last, finish]);
  const back = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  // Measure the current step's anchor (and keep it aligned on resize/scroll).
  useLayoutEffect(() => {
    function measure() {
      if (!step.selector) { setRect(null); return; }
      const el = document.querySelector(step.selector) as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // Keyboard: Esc skips, arrows/Enter navigate.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, next, back]);

  const pad = 6;
  const spot = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  // Card placement: below the spot if it fits, else above; clamped to viewport.
  // No anchor → centered.
  const cardW = 320;
  let cardStyle: React.CSSProperties;
  if (spot && typeof window !== "undefined") {
    const vw = window.innerWidth, vh = window.innerHeight;
    const below = spot.top + spot.height + 180 < vh;
    const left = Math.min(Math.max(12, spot.left), vw - cardW - 12);
    const top = below ? spot.top + spot.height + 12 : Math.max(12, spot.top - 12);
    cardStyle = below
      ? { position: "fixed", top, left, width: cardW, maxWidth: "calc(100vw - 24px)" }
      : { position: "fixed", bottom: vh - spot.top + 12, left, width: cardW, maxWidth: "calc(100vw - 24px)" };
  } else {
    cardStyle = {
      position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
      width: cardW, maxWidth: "calc(100vw - 24px)",
    };
  }

  return (
    <div className="fixed inset-0 z-[100]" aria-live="polite" role="dialog" aria-label="Guided tour">
      {/* Dimmer: a spotlight cutout when anchored, otherwise a flat scrim. */}
      {spot ? (
        <div
          style={{
            position: "fixed", top: spot.top, left: spot.left, width: spot.width, height: spot.height,
            borderRadius: 10, boxShadow: "0 0 0 9999px rgba(2,6,23,0.72)", border: "2px solid #22d3ee",
            pointerEvents: "none", transition: "all 0.2s ease",
          }}
        />
      ) : (
        <div style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.72)" }} />
      )}

      <div style={cardStyle} className="modal-card rounded-xl p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <h3 className="font-semibold text-base">{step.title}</h3>
          <span className="text-xs text-slate-500 shrink-0 mt-0.5">{idx + 1} / {steps.length}</span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">{step.body}</p>
        <div className="flex items-center justify-between mt-4">
          <button onClick={finish} className="text-xs font-medium text-slate-400 hover:text-slate-200">
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {idx > 0 && (
              <button onClick={back} className="text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition">
                Back
              </button>
            )}
            <button onClick={next} className="text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white px-4 py-1.5 rounded-lg transition">
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
