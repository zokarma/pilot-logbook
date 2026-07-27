"use client";

// /demo — the no-signup way into the real app.
//
// This isn't a mock: it flips on demo mode (sessionStorage) and hands the
// visitor the actual logbook running on seeded sample data, so everything they
// click is the product. A full reload is deliberate — DataContext reads the
// demo flag once at boot, so the app must start fresh in demo mode.

import { useEffect } from "react";
import { enterDemoSession } from "@/lib/demoSession";

export default function DemoPage() {
  useEffect(() => {
    enterDemoSession();
    // location.replace (not router.push) forces the reboot AND keeps /demo out
    // of history, so Back returns to the marketing page rather than bouncing.
    window.location.replace("/dashboard");
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center text-slate-400">
      Loading your demo logbook…
    </div>
  );
}
