"use client";

import { useEffect, useRef } from "react";
import { useData } from "@/context/DataContext";
import { notificationsAvailable, syncScheduledNotifications } from "@/lib/notificationsBridge";

// Keeps iOS scheduled reminders in sync with the pilot's documents + prefs.
// No-ops on the website (notificationsAvailable is false). Reschedules only when
// the relevant inputs actually change, so frequent flight edits don't churn it.
export default function NotificationsManager() {
  const { data, ready } = useData();
  const sig = JSON.stringify({
    docs: (data.documents ?? []).map((d) => [d.id, d.type, d.expiryDate]),
    prefs: data.notificationPrefs,
  });
  const lastSig = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !notificationsAvailable()) return;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    void syncScheduledNotifications(data);
  }, [ready, sig, data]);

  return null;
}
