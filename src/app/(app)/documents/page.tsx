"use client";

import { useState } from "react";
import { useData } from "@/context/DataContext";
import { PilotDocument } from "@/lib/types";
import {
  documentStatus, STATUS_META, docTypeDef, recalcDocument, EXPIRING_SOON_DAYS,
} from "@/lib/documents";
import DocumentForm from "@/components/DocumentForm";
import ScanImport from "@/components/ScanImport";
import { useUi } from "@/components/UiProvider";

export default function DocumentsPage() {
  const { data, mutate } = useData();
  const { toast } = useUi();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const editing = editingId ? data.documents.find((d) => d.id === editingId) : null;

  function saveDoc(doc: PilotDocument, dobUpdate?: string) {
    mutate((d) => {
      if (dobUpdate && d.profile) d.profile.dateOfBirth = dobUpdate;
      const i = d.documents.findIndex((x) => x.id === doc.id);
      if (i > -1) d.documents[i] = doc;
      else d.documents.push(doc);
      // Keep any auto medicals consistent with a newly entered date of birth.
      if (dobUpdate) d.documents = d.documents.map((x) => recalcDocument(x, d.profile));
    });
    setAdding(false);
    setEditingId(null);
  }

  function del(id: string) {
    const removed = data.documents.find((x) => x.id === id);
    if (!removed) return;
    mutate((d) => { d.documents = d.documents.filter((x) => x.id !== id); });
    if (editingId === id) setEditingId(null);
    toast("Document deleted", {
      actionLabel: "Undo",
      onAction: () => mutate((d) => { d.documents.push(structuredClone(removed)); }),
    });
  }

  function recalcAll() {
    mutate((d) => { d.documents = d.documents.map((x) => recalcDocument(x, d.profile)); });
  }

  const docs = [...data.documents].sort((a, b) => {
    // Expired / expiring first, then by soonest expiry.
    const ai = documentStatus(a), bi = documentStatus(b);
    const rank = (s: string) => (s === "expired" ? 0 : s === "expiring" ? 1 : s === "valid" ? 2 : 3);
    if (rank(ai.status) !== rank(bi.status)) return rank(ai.status) - rank(bi.status);
    return (ai.days ?? Infinity) - (bi.days ?? Infinity);
  });

  const hasAuto = data.documents.some((d) => d.expiryMode === "auto");
  const showForm = adding || !!editing;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-sm text-slate-400">Licences, medicals, certificates and ratings — expiries update automatically where possible.</p>
        </div>
        <div className="flex items-center gap-2">
          {hasAuto && (
            <button onClick={recalcAll} className="text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg transition">
              Recalculate expiries
            </button>
          )}
          {!showForm && <ScanImport mode="document" />}
          {!showForm && (
            <button onClick={() => { setAdding(true); setEditingId(null); }} className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-4 py-2 rounded-lg transition">
              + Add Document
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="card p-5">
          <h3 className="font-semibold mb-4">{editing ? "Edit Document" : "Add Document"}</h3>
          <DocumentForm
            initial={editing}
            profile={data.profile}
            onSave={saveDoc}
            onCancel={() => { setAdding(false); setEditingId(null); }}
          />
        </div>
      )}

      {!docs.length && !showForm ? (
        <div className="card p-10 text-center">
          <p className="text-slate-400">No documents have been added yet.</p>
          <button onClick={() => setAdding(true)} className="mt-4 bg-brand-600 hover:bg-brand-700 text-white font-medium px-5 py-2.5 rounded-lg transition">
            Add Documents
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {docs.map((doc) => {
            const info = documentStatus(doc);
            const meta = STATUS_META[info.status];
            const def = docTypeDef(doc.type);
            const modeTag =
              doc.expiryMode === "auto" ? "Auto-calculated" : doc.expiryMode === "manual" ? "Manual" : "No expiry";
            return (
              <div key={doc.id} className="card p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-100">{doc.type}</div>
                    <div className="text-xs text-slate-500">{def?.category ?? "Document"}{doc.number ? ` · #${doc.number}` : ""}</div>
                  </div>
                  <span className={"text-xs font-semibold whitespace-nowrap " + meta.cls}>{meta.icon} {meta.short}</span>
                </div>

                <div className={"text-sm " + meta.cls}>{info.label}</div>

                <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                  {doc.examDate && <span>Exam: {doc.examDate}</span>}
                  {doc.issueDate && <span>Issued: {doc.issueDate}</span>}
                  {doc.expiryDate && <span>Expires: {doc.expiryDate}</span>}
                  <span className="text-slate-600">{modeTag}</span>
                </div>

                {doc.notes && <p className="text-xs text-slate-400 border-t border-slate-800 pt-2">{doc.notes}</p>}

                <div className="mt-1 pt-2 border-t border-slate-800 flex items-center gap-4">
                  <button onClick={() => { setEditingId(doc.id); setAdding(false); }} className="text-xs text-cyan-400 hover:text-cyan-300 font-medium">Edit</button>
                  {doc.expiryMode === "auto" && (
                    <button onClick={() => mutate((d) => { const i = d.documents.findIndex((x) => x.id === doc.id); if (i > -1) d.documents[i] = recalcDocument(d.documents[i], d.profile); })} className="text-xs text-slate-400 hover:text-slate-200 font-medium">Recalculate</button>
                  )}
                  <button onClick={() => del(doc.id)} className="text-xs text-red-500 hover:text-red-400 font-medium ml-auto">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-600">
        “Expiring Soon” means within {EXPIRING_SOON_DAYS} days. Medical expiries follow simplified Transport Canada
        validity rules based on your age at the exam date — always confirm against your certificate.
      </p>
    </section>
  );
}
