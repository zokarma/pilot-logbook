"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/context/DataContext";
import { installErrorCapture } from "@/lib/recentErrors";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import Onboarding from "@/components/Onboarding";

const NAV_OPEN_KEY = "plb_nav_open";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, currentUser, data } = useData();
  const router = useRouter();

  // Sidebar visibility — per-device preference, defaulting open on desktop
  // and hidden on phones (full-screen content). Read after mount so the
  // prerendered HTML and first client render agree.
  const [navOpen, setNavOpen] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(NAV_OPEN_KEY);
      setNavOpen(stored !== null ? stored === "1" : window.innerWidth >= 1024);
    } catch { /* keep default */ }
  }, []);
  const setNav = useCallback((open: boolean) => {
    setNavOpen(open);
    try { localStorage.setItem(NAV_OPEN_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    installErrorCapture();
  }, []);

  // Handle deep links from the iOS widget (pilotlogbook://new-flight → open logger + form).
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
    const app = cap?.Plugins?.App as
      | { addListener: (e: string, fn: (d: { url: string }) => void) => { remove: () => void } }
      | undefined;
    if (!app?.addListener) return;
    const handle = app.addListener("appUrlOpen", (data) => {
      if (data.url.includes("new-flight")) {
        router.push("/logger");
        setTimeout(() => window.dispatchEvent(new Event("plb-new-flight")), 350);
      } else if (data.url.includes("logger")) {
        router.push("/logger");
      }
    });
    return () => { handle.remove(); };
  }, [router]);

  useEffect(() => {
    if (ready && !currentUser) router.replace("/login");
  }, [ready, currentUser, router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (!currentUser) return null;

  // First-time users must complete the setup wizard before reaching the app.
  if (!data.profile?.onboarded) return <Onboarding />;

  return (
    <div className="min-h-screen flex bg-slate-950">
      <Sidebar open={navOpen} onClose={() => setNav(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar navOpen={navOpen} onToggleNav={() => setNav(!navOpen)} />
        <main className="flex-1 w-full px-4 lg:px-8 pt-6 pb-24 fade-in safe-right">{children}</main>
      </div>
    </div>
  );
}
