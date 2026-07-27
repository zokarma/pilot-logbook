// Expiry reminders — the PURE half. Turns the pilot's documents + preferences
// into a list of due/overdue reminders. Feeds both the in-app reminders bell
// (web + iOS) and the iOS local-notification scheduler (lib/notificationsBridge).
// Kept framework-free and `today`-injectable so the math is eval-able.

import { AppData, NotificationPrefs, defaultNotificationPrefs } from "./types";

// The one document type that is its own reminder category (the pilot called it
// out explicitly). Everything else with an expiry is a "document".
export const RECURRENT_TRAINING_TYPE = "Recurrent Training";

export interface Reminder {
  docId: string;
  docType: string;
  expiryDate: string; // "YYYY-MM-DD"
  days: number; // whole days until expiry; negative when overdue
  overdue: boolean;
  category: "recurrentTraining" | "documents";
  title: string; // e.g. "Medical Certificate expires in 12 days"
}

// Whole days from local-midnight-today to the expiry date, or null when the
// date is unparseable/empty.
export function daysUntil(dateStr: string | undefined, today: Date = new Date()): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  if (!y) return null;
  const exp = new Date(y, (m || 1) - 1, d || 1).getTime();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((exp - t) / 86_400_000);
}

function phrase(days: number): string {
  if (days < 0) { const a = Math.abs(days); return `expired ${a} day${a === 1 ? "" : "s"} ago`; }
  if (days === 0) return "expires today";
  return `expires in ${days} day${days === 1 ? "" : "s"}`;
}

// Documents whose expiry is within the lead window (or already overdue),
// filtered by the pilot's category prefs, most urgent first.
export function upcomingReminders(
  data: AppData,
  today: Date = new Date(),
  prefs: NotificationPrefs = data.notificationPrefs ?? defaultNotificationPrefs(),
): Reminder[] {
  const lead = Number.isFinite(prefs.leadDays) ? Math.max(0, prefs.leadDays) : 30;
  const out: Reminder[] = [];
  for (const doc of data.documents ?? []) {
    const days = daysUntil(doc.expiryDate, today);
    if (days === null) continue; // no expiry to remind about
    const isRecurrent = doc.type === RECURRENT_TRAINING_TYPE;
    if (isRecurrent ? !prefs.recurrentTraining : !prefs.documents) continue;
    if (days > lead) continue; // not yet inside the reminder window
    out.push({
      docId: doc.id,
      docType: doc.type,
      expiryDate: doc.expiryDate!,
      days,
      overdue: days < 0,
      category: isRecurrent ? "recurrentTraining" : "documents",
      title: `${doc.type} ${phrase(days)}`,
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

export function reminderCount(data: AppData, today: Date = new Date()): number {
  return upcomingReminders(data, today).length;
}

// When an iOS local notification for this expiry should FIRE: leadDays before
// the expiry, at 09:00 local. If that lead date has already passed but the
// document hasn't expired yet (it's already inside the window), fire tomorrow
// so the pilot still gets pinged. Overdue / no-expiry → null (nothing to
// schedule; the in-app bell surfaces those instead).
export function leadFireDate(expiryDate: string, leadDays: number, today: Date = new Date()): Date | null {
  const days = daysUntil(expiryDate, today);
  if (days === null || days < 0) return null;
  const [y, m, d] = expiryDate.split("-").map((n) => parseInt(n, 10));
  const lead = new Date(y, (m || 1) - 1, d || 1);
  lead.setDate(lead.getDate() - Math.max(0, leadDays));
  const midnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const fire = lead > midnightToday
    ? lead
    : new Date(midnightToday.getFullYear(), midnightToday.getMonth(), midnightToday.getDate() + 1);
  fire.setHours(9, 0, 0, 0);
  return fire;
}

export interface ScheduledNotification {
  id: number; // stable per document (derived from its id)
  docId: string;
  title: string;
  body: string;
  fireAtMs: number;
}

// Small stable positive 31-bit int from a string — the LocalNotifications
// plugin keys notifications by integer id, and a stable id lets a reschedule
// replace a doc's old notification instead of duplicating it.
function intId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2000000000;
}

// The full set of iOS local notifications to schedule for the pilot's upcoming
// expiries (respecting category prefs). Pure + today-injectable for tests.
export function buildScheduledNotifications(
  data: AppData,
  today: Date = new Date(),
  prefs: NotificationPrefs = data.notificationPrefs ?? defaultNotificationPrefs(),
): ScheduledNotification[] {
  const out: ScheduledNotification[] = [];
  for (const doc of data.documents ?? []) {
    if (!doc.expiryDate) continue;
    const isRecurrent = doc.type === RECURRENT_TRAINING_TYPE;
    if (isRecurrent ? !prefs.recurrentTraining : !prefs.documents) continue;
    const fire = leadFireDate(doc.expiryDate, prefs.leadDays, today);
    if (!fire) continue;
    const days = daysUntil(doc.expiryDate, today)!;
    out.push({
      id: intId(doc.id),
      docId: doc.id,
      title: `${doc.type} expiring`,
      body: days <= prefs.leadDays
        ? `${doc.type} ${phrase(days)}.`
        : `${doc.type} expires on ${doc.expiryDate}.`,
      fireAtMs: fire.getTime(),
    });
  }
  return out;
}
