// Eval #16 — expiry reminders (src/lib/notifications.ts).
// The reminder list drives the in-app bell and the iOS scheduler; the window
// filter, category filter, overdue handling and ordering must be exact.

import {
  upcomingReminders, daysUntil, reminderCount, leadFireDate, buildScheduledNotifications, RECURRENT_TRAINING_TYPE,
} from "../src/lib/notifications";
import { defaultNotificationPrefs, PilotDocument, NotificationPrefs } from "../src/lib/types";
import { mkData } from "./fixtures";
import { Suite } from "./harness";

const TODAY = new Date(2026, 6, 20); // 2026-07-20, local midnight

function doc(id: string, type: string, expiryDate: string | undefined): PilotDocument {
  return {
    id, type, expiryMode: expiryDate ? "manual" : "none", expiryDate,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
}

function offset(days: number): string {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

function prefs(over: Partial<NotificationPrefs> = {}): NotificationPrefs {
  return { ...defaultNotificationPrefs(), ...over };
}

export function run(): Suite {
  const s = new Suite(22, "Expiry reminders (notifications.ts)", "Drives the reminders bell + iOS scheduler; window/category/ordering must be exact.");

  s.eq("daysUntil counts whole days", daysUntil(offset(30), TODAY), 30);
  s.eq("daysUntil is negative when overdue", daysUntil(offset(-3), TODAY), -3);
  s.check("daysUntil null for empty/unparseable", daysUntil(undefined, TODAY) === null && daysUntil("", TODAY) === null);

  {
    const data = mkData({ documents: [
      doc("d1", "Medical Certificate", offset(12)),   // inside 30-day window
      doc("d2", "Licence", offset(45)),               // outside window
      doc("d3", "Passport", offset(-3)),              // overdue
      doc("d4", "Radio Licence", undefined),          // no expiry — skipped
      doc("d5", RECURRENT_TRAINING_TYPE, offset(20)), // recurrent, inside window
    ] });
    const r = upcomingReminders(data, TODAY, prefs());
    s.check("only in-window + overdue docs are returned", r.length === 3);
    s.check("the 45-day-out and no-expiry docs are excluded", !r.some((x) => x.docId === "d2" || x.docId === "d4"));
    s.check("most urgent first (overdue, then 12, then 20)", r.map((x) => x.docId).join(",") === "d3,d1,d5");
    s.check("overdue flag + phrasing", r[0].overdue && /expired 3 days ago/.test(r[0].title));
    s.check("upcoming phrasing", /expires in 12 days/.test(r[1].title));
    s.check("recurrent training tagged as its own category", r[2].category === "recurrentTraining");
    s.check("ordinary doc tagged as documents", r[1].category === "documents");
  }

  {
    const data = mkData({ documents: [
      doc("d1", "Medical Certificate", offset(10)),
      doc("d5", RECURRENT_TRAINING_TYPE, offset(10)),
    ] });
    s.check("documents:false hides non-recurrent docs", upcomingReminders(data, TODAY, prefs({ documents: false })).every((x) => x.category === "recurrentTraining"));
    s.check("recurrentTraining:false hides recurrent doc", upcomingReminders(data, TODAY, prefs({ recurrentTraining: false })).every((x) => x.category === "documents"));
    s.check("leadDays widens/narrows the window", upcomingReminders(data, TODAY, prefs({ leadDays: 5 })).length === 0);
    s.check("today (0 days) is inside the window", upcomingReminders(mkData({ documents: [doc("t", "Medical Certificate", offset(0))] }), TODAY, prefs()).length === 1);
  }

  s.eq("reminderCount matches the list length", reminderCount(mkData({ documents: [
    doc("d1", "Medical Certificate", offset(5)), doc("d2", "Licence", offset(200)),
  ] }), TODAY), 1);

  // -- iOS scheduling fire dates --
  {
    // Expiry 60 days out, 30-day lead → fires 30 days out (at 09:00).
    const fire = leadFireDate(offset(60), 30, TODAY)!;
    s.check("lead notification fires leadDays before expiry, at 09:00", !!fire && daysUntil(offset(60), TODAY) === 60 && fire.getHours() === 9 && Math.round((fire.getTime() - TODAY.getTime()) / 86_400_000) === 30);
    // Already inside the window (expiry 20 out, 30-day lead) → fires tomorrow.
    const soon = leadFireDate(offset(20), 30, TODAY)!;
    s.check("already-in-window expiry schedules for tomorrow", !!soon && Math.round((new Date(soon.getFullYear(), soon.getMonth(), soon.getDate()).getTime() - TODAY.getTime()) / 86_400_000) === 1);
    s.check("overdue expiry schedules nothing", leadFireDate(offset(-1), 30, TODAY) === null);
  }

  {
    const data = mkData({ documents: [
      doc("d1", "Medical Certificate", offset(60)),
      doc("d2", "Licence", offset(-5)),           // overdue → not scheduled
      doc("d3", "Radio Licence", undefined),      // no expiry → not scheduled
      doc("d4", RECURRENT_TRAINING_TYPE, offset(90)),
    ] });
    const sched = buildScheduledNotifications(data, TODAY, prefs());
    s.check("only future-expiry docs are scheduled", sched.length === 2 && sched.every((n) => n.docId === "d1" || n.docId === "d4"));
    s.check("scheduled ids are stable positive ints", sched.every((n) => Number.isInteger(n.id) && n.id > 0));
    s.check("category prefs gate scheduling too", buildScheduledNotifications(data, TODAY, prefs({ recurrentTraining: false })).every((n) => n.docId !== "d4"));
    s.check("master enabled flag is not consulted here (bridge decides)", buildScheduledNotifications(data, TODAY, prefs({ enabled: false })).length === 2);
  }

  return s;
}
