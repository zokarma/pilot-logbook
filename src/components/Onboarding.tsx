"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/context/DataContext";
import { uid } from "@/lib/id";
import { PilotDocument, UserProfile, Pilot } from "@/lib/types";
import { PILOT_ROLES, documentStatus, STATUS_META, recalcDocument } from "@/lib/documents";
import { applyRoleDefaults } from "@/lib/roleDefaults";
import DocumentForm from "./DocumentForm";

const inputCls = "w-full px-3 py-2 border border-slate-700 rounded-lg text-sm";
const labelCls = "block text-xs font-medium text-slate-400 mb-1";

// First-time setup wizard. Rendered by the app layout in place of the shell
// until the account holder's profile is completed (or skipped past documents).
export default function Onboarding() {
  const { data, mutate } = useData();
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [firstName, setFirstName] = useState(data.profile?.firstName ?? "");
  const [lastName, setLastName] = useState(data.profile?.lastName ?? "");
  const [displayName, setDisplayName] = useState(data.profile?.displayName ?? "");
  const [role, setRole] = useState(data.profile?.role || "Private Pilot");
  const [dob, setDob] = useState(data.profile?.dateOfBirth ?? "");

  const [docs, setDocs] = useState<PilotDocument[]>([]);
  const [adding, setAdding] = useState(false);

  // Profile snapshot used for live document expiry math during setup.
  const draftProfile: UserProfile = {
    firstName, lastName, displayName: displayName || undefined,
    role, dateOfBirth: dob || undefined, onboarded: false,
  };

  const page1Valid = firstName.trim() && lastName.trim() && role;

  // Commit the whole setup: create the primary pilot, save the profile, and
  // persist any documents (auto ones recalculated against the final DOB).
  function finish() {
    mutate((d) => {
      // Create or reuse the primary pilot profile.
      let pilotId = d.profile?.pilotId ?? null;
      if (!pilotId) {
        const existing = d.pilots.find(
          (p) => (p.firstName + " " + p.lastName).trim().toLowerCase() ===
            (firstName + " " + lastName).trim().toLowerCase(),
        );
        pilotId = existing?.id ?? null;
      }
      if (!pilotId) {
        const p: Pilot = {
          id: uid("p"),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          employeeNumber: "",
          licenseNumber: "",
          createdAt: new Date().toISOString(),
        };
        d.pilots.push(p);
        pilotId = p.id;
      } else {
        const p = d.pilots.find((x) => x.id === pilotId);
        if (p) { p.firstName = firstName.trim(); p.lastName = lastName.trim(); }
      }
      d.currentPilotId = pilotId;

      const finalProfile: UserProfile = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        displayName: displayName.trim() || undefined,
        role,
        dateOfBirth: dob || undefined,
        pilotId,
        onboarded: true,
        tourSeen: false, // trigger the first-run guided tour
      };
      d.profile = finalProfile;
      d.documents = docs.map((doc) => recalcDocument(doc, finalProfile));
      // Tune the fleet list, flight-table columns and flight-form boxes to the
      // role they just picked, so the first run isn't cluttered with gear they
      // don't fly. Every list stays editable (Fleet page, Columns panel, the
      // form's Customize panel).
      applyRoleDefaults(d, role);
    });
    router.replace("/dashboard");
  }

  function saveDoc(doc: PilotDocument, dobUpdate?: string) {
    if (dobUpdate) setDob(dobUpdate);
    setDocs((prev) => [...prev, doc]);
    setAdding(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-xl modal-card p-6 sm:p-8 fade-in">
        {/* Header + progress */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <span className={"h-1.5 flex-1 rounded-full " + (step >= 1 ? "bg-brand-500" : "bg-slate-700")} />
            <span className={"h-1.5 flex-1 rounded-full " + (step >= 2 ? "bg-brand-500" : "bg-slate-700")} />
          </div>
          <p className="text-xs uppercase tracking-wider text-brand-400 font-semibold">Step {step} of 2</p>
          <h1 className="text-2xl font-bold text-white mt-1">
            {step === 1 ? "Set up your pilot profile" : "Add your documents"}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {step === 1
              ? "This becomes your primary account. You can edit everything later."
              : "Optional — track licences, medicals and ratings. You can always add these later."}
          </p>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>First Name <span className="text-red-400">*</span></label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} autoFocus />
              </div>
              <div>
                <label className={labelCls}>Last Name <span className="text-red-400">*</span></label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Preferred Display Name <span className="text-slate-600">(optional)</span></label>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} placeholder={firstName || "e.g. Johnny"} />
              </div>
              <div>
                <label className={labelCls}>Pilot Role <span className="text-red-400">*</span></label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
                  {PILOT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Date of Birth <span className="text-slate-600">(optional)</span></label>
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputCls} />
                <p className="text-[11px] text-slate-500 mt-1">Used to auto-calculate medical certificate expiry.</p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(2)}
                disabled={!page1Valid}
                className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* Existing docs added in this session */}
            {docs.length > 0 && (
              <ul className="space-y-2">
                {docs.map((doc) => {
                  const info = documentStatus(doc);
                  const meta = STATUS_META[info.status];
                  return (
                    <li key={doc.id} className="card p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-100 truncate">{doc.type}</div>
                        <div className={"text-xs " + meta.cls}>{meta.icon} {info.label}</div>
                      </div>
                      <button
                        onClick={() => setDocs((prev) => prev.filter((x) => x.id !== doc.id))}
                        className="text-xs text-red-400 hover:text-red-300 shrink-0"
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {adding ? (
              <div className="card p-4">
                <DocumentForm profile={draftProfile} onSave={saveDoc} onCancel={() => setAdding(false)} />
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full border border-dashed border-slate-700 hover:border-brand-500 text-slate-300 hover:text-white rounded-lg py-3 text-sm font-medium transition"
              >
                + Add a document
              </button>
            )}

            <div className="flex items-center justify-between pt-2 gap-3">
              <button onClick={() => setStep(1)} className="text-sm text-slate-400 hover:text-slate-200">← Back</button>
              <div className="flex items-center gap-3">
                {!adding && (
                  <button onClick={finish} className="text-sm font-medium text-slate-300 hover:text-white px-3 py-2">
                    Skip for now
                  </button>
                )}
                <button
                  onClick={finish}
                  disabled={adding}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition"
                >
                  Complete Setup
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
