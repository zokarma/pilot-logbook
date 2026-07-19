"use client";

// Settings modal — cloud sync status + account danger zone. Extracted from the
// Sidebar so it can be opened from the TopBar profile menu.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/context/DataContext";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { cloud, currentUser, deleteAccount } = useData();
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  async function onDeleteAccount() {
    if (!confirm("Permanently delete your account and ALL your logbook data? This cannot be undone.")) return;
    if (!confirm("Are you absolutely sure? Deletion is immediate and permanent.")) return;
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
