"use client";

// Settings modal — cloud sync status + account danger zone. Extracted from the
// Sidebar so it can be opened from the TopBar profile menu.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/context/DataContext";
import { isNativeApp } from "@/lib/native";
import { notificationsAvailable, requestNotificationPermission } from "@/lib/notificationsBridge";
import { useUi } from "./UiProvider";

const LEAD_OPTIONS = [7, 14, 30, 60, 90];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { data, mutate, cloud, currentUser, deleteAccount } = useData();
  const { confirmDialog } = useUi();
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [permMsg, setPermMsg] = useState<string | null>(null);

  const prefs = data.notificationPrefs;
  const native = isNativeApp();
  const setPref = <K extends keyof typeof prefs>(k: K, v: (typeof prefs)[K]) =>
    mutate((d) => { d.notificationPrefs[k] = v; });

  async function toggleDeviceReminders(on: boolean) {
    setPermMsg(null);
    if (on && notificationsAvailable()) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        setPermMsg("Notifications are turned off for Pilot Logbook. Enable them in iOS Settings, then try again.");
        return;
      }
    }
    setPref("enabled", on);
  }

  async function onDeleteAccount() {
    // Deliberately two-step: account deletion is the one action with no undo.
    if (!(await confirmDialog({
      title: "Delete your account?",
      message: "Your account and ALL your logbook data will be permanently deleted. This cannot be undone.",
      confirmLabel: "Continue",
      danger: true,
    }))) return;
    if (!(await confirmDialog({
      title: "Are you absolutely sure?",
      message: "Deletion is immediate and permanent — your flights, documents, and profile will be gone.",
      confirmLabel: "Permanently delete",
      danger: true,
    }))) return;
    setDeleting(true);
    setDeleteErr(null);
    const res = await deleteAccount();
    setDeleting(false);
    if (res.error) { setDeleteErr(res.error); return; }
    onClose();
    router.replace("/login");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Settings</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">&times;</button>
        </div>
        {cloud ? (
          <p className="text-sm text-slate-300">
            <span className="text-emerald-400 font-medium">Connected.</span> Your data syncs to Supabase (secured by
            per-user Row Level Security) and is mirrored to this device for offline use.
            {currentUser && <> Signed in as <span className="text-slate-100">{currentUser}</span>.</>}
          </p>
        ) : (
          <p className="text-sm text-slate-300">
            <span className="text-amber-300 font-medium">Local-only mode.</span> Supabase isn&apos;t configured, so your
            data lives in this browser only. Set the Supabase environment variables to enable cloud sync — see the README.
          </p>
        )}

        <div className="mt-6 pt-5 border-t border-slate-800">
          <h4 className="text-sm font-semibold text-slate-200 mb-1">Reminders</h4>
          <p className="text-xs text-slate-400 mb-3">
            Get a heads-up before your documents and recurrent training expire. The bell in the top bar always shows
            upcoming expiries{native ? "; turn on device notifications to be reminded even when the app is closed." : ". Device notifications are available in the iPhone/iPad app."}
          </p>

          <label className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm text-slate-300">Remind me before expiry</span>
            <select
              value={prefs.leadDays}
              onChange={(e) => setPref("leadDays", parseInt(e.target.value, 10))}
              className="px-2 py-1.5 border border-slate-700 rounded-lg text-sm bg-transparent"
            >
              {LEAD_OPTIONS.map((n) => <option key={n} value={n}>{n} days</option>)}
            </select>
          </label>

          <label className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm text-slate-300">Licences, medicals &amp; certificates</span>
            <input type="checkbox" checked={prefs.documents} onChange={(e) => setPref("documents", e.target.checked)} className="accent-cyan-500 w-4 h-4" />
          </label>
          <label className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm text-slate-300">Recurrent training</span>
            <input type="checkbox" checked={prefs.recurrentTraining} onChange={(e) => setPref("recurrentTraining", e.target.checked)} className="accent-cyan-500 w-4 h-4" />
          </label>

          {native && (
            <label className="flex items-center justify-between gap-3 py-1.5 mt-1 pt-2 border-t border-slate-800/70">
              <span className="text-sm text-slate-300">Device notifications</span>
              <input type="checkbox" checked={prefs.enabled} onChange={(e) => void toggleDeviceReminders(e.target.checked)} className="accent-cyan-500 w-4 h-4" />
            </label>
          )}
          {permMsg && <p className="text-xs text-amber-300 mt-2">{permMsg}</p>}
        </div>

        <div className="mt-6 pt-5 border-t border-slate-800">
          <h4 className="text-sm font-semibold text-slate-200 mb-1">Guided tour</h4>
          <p className="text-xs text-slate-400 mb-3">
            Replay the quick walkthrough of where everything lives.
          </p>
          <button
            onClick={() => { onClose(); window.dispatchEvent(new Event("plb-start-tour")); }}
            className="text-sm font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition"
          >
            Take the tour
          </button>
        </div>

        {cloud && (
          <div className="mt-6 pt-5 border-t border-slate-800">
            <h4 className="text-sm font-semibold text-red-300 mb-1">Danger zone</h4>
            <p className="text-xs text-slate-400 mb-3">
              Permanently delete your account and all your logbook data. This cannot be undone.
            </p>
            {deleteErr && <p className="text-xs text-red-400 mb-2">{deleteErr}</p>}
            <button
              onClick={onDeleteAccount}
              disabled={deleting}
              className="text-sm font-medium bg-red-600/90 hover:bg-red-600 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition"
            >
              {deleting ? "Deleting…" : "Delete account"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
