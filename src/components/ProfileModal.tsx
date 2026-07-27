"use client";

// Pilot Profile modal — edit the account holder's profile (name, role, date of
// birth) and profile picture. Opened from the TopBar profile menu.
//
// The picture is resized client-side to a small square JPEG data URL so it
// stays a few KB and can ride along in the synced AppData blob like any other
// profile field (unlike bug screenshots, which are large and stay local-only).

import { useRef, useState } from "react";
import { useData } from "@/context/DataContext";
import { PILOT_ROLES, recalcDocument } from "@/lib/documents";
import { applyRoleDefaults, roleDefaultsDiffer } from "@/lib/roleDefaults";
import { useUi } from "./UiProvider";

const AVATAR_SIZE = 128; // px, square

// Downscale + centre-crop an image file to a small square JPEG data URL.
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Not a valid image."));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas unavailable.")); return; }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const { data, mutate } = useData();
  const { confirmDialog } = useUi();
  const p = data.profile;
  const [firstName, setFirstName] = useState(p?.firstName ?? "");
  const [lastName, setLastName] = useState(p?.lastName ?? "");
  const [displayName, setDisplayName] = useState(p?.displayName ?? "");
  const [role, setRole] = useState(p?.role || "Private Pilot");
  const [dob, setDob] = useState(p?.dateOfBirth ?? "");
  const [avatar, setAvatar] = useState(p?.avatar ?? "");
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setAvatar(await fileToAvatar(file));
      setMsg("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function save() {
    if (!firstName.trim() || !lastName.trim()) { setMsg("First and last name are required."); return; }

    // Changing role changes what this pilot needs on screen. Offer to retune —
    // never silently, because they may have hand-picked their columns, fields
    // and fleet, and this replaces all three.
    let retune = false;
    if (role !== p?.role && roleDefaultsDiffer(data, role)) {
      retune = await confirmDialog({
        title: `Set things up for ${role}?`,
        message:
          "Your aircraft list, flight-table columns and Add-a-Flight boxes can be retuned to suit the new role. " +
          "This replaces any choices you've made in those three places — your flights and documents aren't touched.",
        confirmLabel: "Retune",
        cancelLabel: "Keep mine",
      });
    }

    mutate((d) => {
      if (!d.profile) return;
      d.profile.firstName = firstName.trim();
      d.profile.lastName = lastName.trim();
      d.profile.displayName = displayName.trim() || undefined;
      d.profile.role = role;
      const dobChanged = (dob || undefined) !== d.profile.dateOfBirth;
      d.profile.dateOfBirth = dob || undefined;
      d.profile.avatar = avatar || undefined;
      // Keep the linked Pilot profile's name in step with the account holder.
      const linked = d.pilots.find((x) => x.id === d.profile?.pilotId);
      if (linked) {
        linked.firstName = firstName.trim();
        linked.lastName = lastName.trim();
      }
      // A new date of birth changes medical validity — recalc auto documents.
      if (dobChanged) d.documents = d.documents.map((x) => recalcDocument(x, d.profile));
      if (retune) applyRoleDefaults(d, role);
    });
    onClose();
  }

  const inputCls = "w-full px-3 py-2 border border-slate-700 rounded-lg text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Pilot Profile</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex items-center gap-4 mb-5">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="Profile" className="w-16 h-16 rounded-full object-cover border border-slate-700" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-brand-600 flex items-center justify-center text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21a8 8 0 1 0-16 0" /><circle cx="12" cy="8" r="4" />
              </svg>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <button onClick={() => fileRef.current?.click()} className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-3 py-1.5 rounded-lg transition text-left">
              {avatar ? "Change picture" : "Add picture"}
            </button>
            {avatar && (
              <button onClick={() => setAvatar("")} className="text-xs text-red-400 hover:text-red-300 text-left">Remove</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onPickImage(e)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1">First name</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1">Last name</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
          </label>
          <label className="block col-span-2">
            <span className="block text-xs font-medium text-slate-400 mb-1">Display name (optional)</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Shown on your logbook" className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
              {PILOT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1">Date of birth</span>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputCls} />
          </label>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Date of birth drives Transport Canada medical validity — changing it recalculates your medical expiry dates.
        </p>

        {msg && <p className="text-sm text-red-400 mt-3">{msg}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-4 py-2 rounded-lg transition">Cancel</button>
          <button onClick={() => void save()} className="text-sm bg-brand-600 hover:bg-brand-700 text-white font-medium px-4 py-2 rounded-lg transition">Save</button>
        </div>
      </div>
    </div>
  );
}
