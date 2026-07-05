"use client";

import { useMemo, useState } from "react";
import { uid } from "@/lib/id";
import { PilotDocument, UserProfile, DocExpiryMode } from "@/lib/types";
import {
  DOC_GROUPS, docTypeDef, computeAutoExpiry,
} from "@/lib/documents";

const inputCls = "w-full px-3 py-2 border border-slate-700 rounded-lg text-sm";
const labelCls = "block text-xs font-medium text-slate-400 mb-1";

function newId() {
  return uid("doc");
}

// Add/edit a single aviation document. On save it hands back the finished
// PilotDocument and, when the user supplies a date of birth for a medical, the
// updated DOB so the caller can persist it onto the profile.
export default function DocumentForm({
  initial, profile, onSave, onCancel,
}: {
  initial?: PilotDocument | null;
  profile: UserProfile | null;
  onSave: (doc: PilotDocument, dobUpdate?: string) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState(initial?.type ?? "Category 1 Medical");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? "");
  const [examDate, setExamDate] = useState(initial?.examDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [dob, setDob] = useState(profile?.dateOfBirth ?? "");
  const [expiryMode, setExpiryMode] = useState<DocExpiryMode>(
    initial?.expiryMode ?? docTypeDef(type)?.expiry ?? "manual",
  );
  const [manualExpiry, setManualExpiry] = useState(
    initial?.expiryMode === "manual" ? initial?.expiryDate ?? "" : "",
  );

  const def = docTypeDef(type);
  const isMedical = !!def?.auto?.medical;
  const supportsAuto = !!def?.auto;

  // When the type changes, snap the expiry mode back to that type's default.
  function changeType(t: string) {
    setType(t);
    setExpiryMode(docTypeDef(t)?.expiry ?? "manual");
  }

  // Live preview of the auto-calculated expiry given the current inputs.
  const autoPreview = useMemo(() => {
    const candidate: PilotDocument = {
      id: "", type, number, issueDate, examDate, expiryMode: "auto",
      createdAt: "", updatedAt: "",
    };
    return computeAutoExpiry(candidate, { ...(profile ?? { firstName: "", lastName: "", role: "", onboarded: false }), dateOfBirth: dob });
  }, [type, number, issueDate, examDate, dob, profile]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let expiryDate = "";
    if (expiryMode === "manual") expiryDate = manualExpiry;
    else if (expiryMode === "auto") expiryDate = autoPreview;
    const now = new Date().toISOString();
    const doc: PilotDocument = {
      id: initial?.id ?? newId(),
      type,
      number: number.trim() || undefined,
      issueDate: issueDate || undefined,
      examDate: examDate || undefined,
      expiryDate: expiryDate || undefined,
      expiryMode,
      notes: notes.trim() || undefined,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    };
    const dobChanged = isMedical && dob && dob !== (profile?.dateOfBirth ?? "");
    onSave(doc, dobChanged ? dob : undefined);
  }

  const modeBtn = (m: DocExpiryMode, label: string, enabled = true) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => setExpiryMode(m)}
      className={
        "px-3 py-1.5 rounded-lg text-xs font-medium border transition " +
        (expiryMode === m
          ? "bg-brand-600 border-brand-500 text-white"
          : "bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800/60")
      }
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={labelCls}>Document Type</label>
          <select value={type} onChange={(e) => changeType(e.target.value)} className={inputCls}>
            {DOC_GROUPS.map((g) => (
              <optgroup key={g.category} label={g.label}>
                {g.types.map((t) => <option key={t.value} value={t.value}>{t.value}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Document Number <span className="text-slate-600">(optional)</span></label>
          <input value={number} onChange={(e) => setNumber(e.target.value)} className={inputCls} placeholder="e.g. RAMC 123456" />
        </div>

        <div>
          <label className={labelCls}>{isMedical ? "Medical Examination Date" : "Issue Date"}</label>
          <input
            type="date"
            value={isMedical ? examDate : issueDate}
            onChange={(e) => (isMedical ? setExamDate(e.target.value) : setIssueDate(e.target.value))}
            className={inputCls}
          />
        </div>

        {isMedical && (
          <div>
            <label className={labelCls}>Date of Birth <span className="text-slate-600">(for expiry rules)</span></label>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputCls} />
          </div>
        )}
      </div>

      {/* Expiry mode selector */}
      <div>
        <label className={labelCls}>Expiry</label>
        <div className="flex flex-wrap items-center gap-2">
          {modeBtn("auto", "Auto-calculate", supportsAuto)}
          {modeBtn("manual", "Manual date")}
          {modeBtn("none", "No expiry")}
        </div>

        {expiryMode === "auto" && (
          <p className="text-xs mt-2">
            {autoPreview ? (
              <span className="text-emerald-400">Auto-calculated expiry: <b>{autoPreview}</b></span>
            ) : (
              <span className="text-amber-300">
                Enter {isMedical ? "the exam date and date of birth" : "an issue date"} to calculate the expiry.
              </span>
            )}
          </p>
        )}
        {expiryMode === "manual" && (
          <input
            type="date"
            value={manualExpiry}
            onChange={(e) => setManualExpiry(e.target.value)}
            className={inputCls + " mt-2 max-w-xs"}
          />
        )}
        {expiryMode === "none" && (
          <p className="text-xs mt-2 text-slate-400">This document is recorded as never expiring.</p>
        )}
      </div>

      <div>
        <label className={labelCls}>Notes <span className="text-slate-600">(optional)</span></label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 rounded-lg transition">
          {initial ? "Save Document" : "Add Document"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
      </div>
    </form>
  );
}
