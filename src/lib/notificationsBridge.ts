// iOS local-notifications bridge. Like the other native bridges (scanBridge,
// the widget writer), this NEVER imports @capacitor/core — it reads the plugin
// off window.Capacitor.Plugins at runtime, so the web bundle stays
// Capacitor-free and these helpers simply no-op on the website.
//
// The @capacitor/local-notifications plugin is registered natively by
// `cap sync` (it's in package.json); on device it appears as
// window.Capacitor.Plugins.LocalNotifications. Scheduling is entirely on-device
// — no server, works offline — which is the right fit for expiry reminders.

import { AppData } from "./types";
import { buildScheduledNotifications } from "./notifications";

interface PermStatus { display: "prompt" | "prompt-with-rationale" | "granted" | "denied" }
interface PendingResult { notifications: { id: number }[] }
interface LocalNotificationsPlugin {
  checkPermissions: () => Promise<PermStatus>;
  requestPermissions: () => Promise<PermStatus>;
  schedule: (opts: { notifications: unknown[] }) => Promise<void>;
  getPending: () => Promise<PendingResult>;
  cancel: (opts: { notifications: { id: number }[] }) => Promise<void>;
}

function plugin(): LocalNotificationsPlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return (cap?.Plugins?.LocalNotifications as LocalNotificationsPlugin) ?? null;
}

// True only in the native app with the plugin present.
export function notificationsAvailable(): boolean {
  return !!plugin();
}

export async function permissionGranted(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try { return (await p.checkPermissions()).display === "granted"; } catch { return false; }
}

// Ask iOS for permission; returns whether it ended up granted.
export async function requestNotificationPermission(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try { return (await p.requestPermissions()).display === "granted"; } catch { return false; }
}

// Replace all currently scheduled reminders with a fresh set derived from the
// pilot's documents + prefs. Cancel-then-schedule keeps it idempotent, so it's
// safe to call on every data/preference change (like the widget writer).
export async function syncScheduledNotifications(data: AppData): Promise<void> {
  const p = plugin();
  if (!p) return;
  const prefs = data.notificationPrefs;
  try {
    // Clear whatever we scheduled before.
    const pending = await p.getPending();
    if (pending.notifications.length) {
      await p.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
    if (!prefs?.enabled) return; // master switch off → leave them cleared
    if (!(await permissionGranted())) return; // no permission → nothing to schedule

    const items = buildScheduledNotifications(data);
    if (!items.length) return;
    await p.schedule({
      notifications: items.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: { at: new Date(n.fireAtMs), allowWhileIdle: true },
      })),
    });
  } catch {
    /* best-effort; reminders are a convenience, never block the app */
  }
}
