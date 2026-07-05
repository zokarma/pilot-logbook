"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/context/DataContext";
import { installErrorCapture } from "@/lib/recentErrors";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import Onboarding from "@/components/Onboarding";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, currentUser, data } = useData();
  const router = useRouter();

  useEffect(() => {
    installErrorCapture();
  }, []);

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
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 w-full px-4 lg:px-8 pt-6 pb-24 fade-in">{children}</main>
      </div>
    </div>
  );
}
