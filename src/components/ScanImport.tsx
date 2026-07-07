"use client";

// Scan → confirm → save. Renders a "Scan" button that only appears in the
// native iOS app (scanAvailability gates it); on the website it renders
// nothing. Tapping it opens the VisionKit document camera, runs the OCR +
// extraction pipeline (lib/scan), and presents an editable confirm sheet.
//
// RULE: scanned entries are NEVER auto-saved. Every field is pre-filled and
// editable; low-confidence fields are highlighted for review; the pilot taps
// Save to commit. Nothing touches AppData until then.

import { useEffect, useState } from "react";
import { useData } from "@/context/DataContext";
import { DayNight, Flight, Pilot, PilotDocument, DocExpiryMode, AppData } from "@/lib/types";
import { uid } from "@/lib/id";
import { num, syncFlightMirrors } from "@/lib/logbook";
import { docTypeDef, recalcDocument, DOC_TYPES } from "@/lib/documents";
import {
  ScannedFlight, ScannedDocument, ConfidentField, LOW_CONFIDENCE,
  parseFlightsFromOcr, parseDocumentFromOcr, combineFlights, combineDocument,
} from "@/lib/scan";
import { scanAvailability, scanDocuments, AiReason } from "@/lib/scanBridge";

// Actionable one-liner shown in the confirm sheet when the on-device AI model
// didn't run, so the pilot knows how to turn it on (extraction is far better
// with it). null = AI ran, no notice needed.
function aiNotice(reason: AiReason): string | null {
  switch (reason) {
    case "available": return null;
    case "not-enabled":
      return "Basic OCR only. For much better accuracy, turn on Apple Intelligence in Settings → Apple Intelligence & Siri, then scan again.";
    case "model-downloading":
      return "Basic OCR only — Apple Intelligence is still downloading its model. Try again once it finishes (Settings → Apple Intelligence & Siri).";
    case "device-not-eligible":
      return "Basic OCR only — this iPhone doesn't support Apple Intelligence (needs iPhone 15 Pro or newer). Check the highlighted fields carefully.";
    case "os-too-old":
      return "Basic OCR only — update to iOS 26 to enable on-device AI extraction.";
    case "framework-missing":
      return "Basic OCR only — this build can't reach the on-device AI model.";
    default:
      return "Basic OCR only — on-device AI extraction is unavailable. Check the highlighted fields carefully.";
  }
}

type Mode = "flights" | "document";
type Phase = "idle" | "scanning" | "review" | "error";

// One editable flight row: every value is a string (form-friendly), plus the
// set of field keys the scan flagged as low-confidence.
type FlightRow = {
  include: boolean;
  low: Set<string>;
  date: string; aircraftType: string; registration: string; loggedRole: string;
  from: string; to: string; takeoff: DayNight; landing: DayNight;
  se: string; me: string; xc: string; dayHours: string; nightHours: string;
  ifrActual: string; ifrSim: string; notes: string; pic: string; sic: string;
};

type DocRow = {
  low: Set<string>;
  type: string; number: string; issueDate: string; examDate: string; expiryDate: string;
};

const cf = <T,>(f: ConfidentField<T> | undefined): T | undefined => f?.value;
const isLow = (f: ConfidentField<unknown> | undefined) => !!f && f.confidence < LOW_CONFIDENCE;

function flightToRow(s: ScannedFlight): FlightRow {
  const low = new Set<string>();
  const mark = (k: string, f: ConfidentField<unknown> | undefined) => { if (isLow(f)) low.add(k); };
  mark("date", s.date); mark("aircraftType", s.aircraftType); mark("registration", s.registration);
  mark("loggedRole", s.loggedRole); mark("from", s.from); mark("to", s.to);
  mark("se", s.se); mark("me", s.me); mark("xc", s.xc);
  mark("dayHours", s.dayHours); mark("nightHours", s.nightHours);
  mark("ifrActual", s.ifrActual); mark("ifrSim", s.ifrSim);
  mark("pic", s.pic); mark("sic", s.sic);
  return {
    include: true, low,
    date: cf(s.date) ?? "", aircraftType: cf(s.aircraftType) ?? "",
    registration: cf(s.registration) ?? "", loggedRole: cf(s.loggedRole) ?? "",
    from: cf(s.from) ?? "", to: cf(s.to) ?? "",
    takeoff: cf(s.takeoff) ?? "Day", landing: cf(s.landing) ?? "Day",
    se: String(cf(s.se) ?? ""), me: String(cf(s.me) ?? ""), xc: String(cf(s.xc) ?? ""),
    dayHours: String(cf(s.dayHours) ?? ""), nightHours: String(cf(s.nightHours) ?? ""),
    ifrActual: String(cf(s.ifrActual) ?? ""), ifrSim: String(cf(s.ifrSim) ?? ""),
    notes: cf(s.notes) ?? "", pic: cf(s.pic) ?? "", sic: cf(s.sic) ?? "",
  };
}

function docToRow(s: ScannedDocument): DocRow {
  const low = new Set<string>();
  const mark = (k: string, f: ConfidentField<unknown> | undefined) => { if (isLow(f)) low.add(k); };
  mark("type", s.type); mark("number", s.number); mark("issueDate", s.issueDate);
  mark("examDate", s.examDate); mark("expiryDate", s.expiryDate);
  return {
    low,
    type: cf(s.type) ?? "", number: cf(s.number) ?? "",
    issueDate: cf(s.issueDate) ?? "", examDate: cf(s.examDate) ?? "", expiryDate: cf(s.expiryDate) ?? "",
  };
}

// Resolve a scanned crew name to a Pilot id inside a draft, creating a profile
// if none matches (mirrors migrate.ts / CSV import behaviour).
function resolvePilot(draft: AppData, name: string): string {
  const key = name.trim().toLowerCase();
  if (!key) return "";
  const existing = draft.pilots.find(
    (p) => ((p.firstName || "") + " " + (p.lastName || "")).trim().toLowerCase() === key,
  );
  if (existing) return existing.id;
  const parts = name.trim().split(/\s+/);
  const p: Pilot = {
    id: uid("p"), firstName: parts[0] || name, lastName: parts.slice(1).join(" "),
    employeeNumber: "", licenseNumber: "", createdAt: new Date().toISOString(),
  };
  draft.pilots.push(p);
  return p.id;
}

export default function ScanImport({ mode }: { mode: Mode }) {
  const { mutate } = useData();
  const [available, setAvailable] = useState(false);
  const [ai, setAi] = useState(false);
  const [aiReason, setAiReason] = useState<AiReason>("unavailable");
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");
  const [flightRows, setFlightRows] = useState<FlightRow[]>([]);
  const [docRow, setDocRow] = useState<DocRow | null>(null);

  useEffect(() => {
    let alive = true;
    scanAvailability().then((a) => {
      if (!alive) return;
      setAvailable(a.docCamera);
      setAi(a.appleIntelligence);
      setAiReason(a.aiReason);
    });
    return () => { alive = false; };
  }, []);

  if (!available) return null;

  async function startScan() {
    setErr("");
    setPhase("scanning");
    try {
      const result = await scanDocuments(mode);
      if (mode === "flights") {
        const heur = parseFlightsFromOcr(result.pages);
        const flights = combineFlights(result.fmFlights, heur);
        if (!flights.length) { setErr("No flights could be read from that scan. Try again with better lighting, or add the flight manually."); setPhase("error"); return; }
        setFlightRows(flights.map(flightToRow));
      } else {
        const heur = parseDocumentFromOcr(result.pages);
        const doc = combineDocument(result.fmDocument, heur);
        if (!doc) { setErr("No document details could be read from that scan. Try again, or add the document manually."); setPhase("error"); return; }
        setDocRow(docToRow(doc));
      }
      setPhase("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "cancelled") { setPhase("idle"); return; } // pilot dismissed the camera
      setErr(msg);
      setPhase("error");
    }
  }

  function saveFlights() {
    const rows = flightRows.filter((r) => r.include);
    if (!rows.length) { close(); return; }
    mutate((draft) => {
      for (const r of rows) {
        const fl: Flight = {
          id: uid("f"), date: r.date, aircraftType: r.aircraftType.trim(),
          registration: r.registration.trim(), pilotId: draft.currentPilotId,
          loggedRole: r.loggedRole || "Captain",
          picId: resolvePilot(draft, r.pic), sicId: resolvePilot(draft, r.sic), socId: "",
          from: r.from.trim(), to: r.to.trim(), takeoff: r.takeoff, landing: r.landing,
          se: num(r.se), me: num(r.me), xc: num(r.xc),
          dayHours: num(r.dayHours), nightHours: num(r.nightHours),
          ifrActual: num(r.ifrActual), ifrSim: num(r.ifrSim), notes: r.notes.trim(),
        };
        syncFlightMirrors(draft, fl); // year/month/day, civilIdent, pic/sic names, updated_at
        draft.flights.push(fl);
      }
    });
    close();
  }

  function saveDoc() {
    if (!docRow || !docRow.type.trim()) { close(); return; }
    mutate((draft) => {
      const now = new Date().toISOString();
      const def = docTypeDef(docRow.type.trim());
      // Explicit scanned expiry wins (manual); else auto-calc if the type
      // supports it; else no expiry.
      let expiryMode: DocExpiryMode = "none";
      if (docRow.expiryDate.trim()) expiryMode = "manual";
      else if (def?.expiry === "auto") expiryMode = "auto";
      const doc: PilotDocument = {
        id: uid("doc"), type: docRow.type.trim(),
        number: docRow.number.trim() || undefined,
        issueDate: docRow.issueDate.trim() || undefined,
        examDate: docRow.examDate.trim() || undefined,
        expiryDate: docRow.expiryDate.trim() || undefined,
        expiryMode, createdAt: now, updatedAt: now,
      };
      draft.documents.push(recalcDocument(doc, draft.profile));
    });
    close();
  }

  function close() {
    setPhase("idle"); setFlightRows([]); setDocRow(null); setErr("");
  }

  const label = mode === "flights" ? "Scan Logbook" : "Scan Document";

  return (
    <>
      <button
        onClick={startScan}
        disabled={phase === "scanning"}
        className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1.5"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" />
        </svg>
        {phase === "scanning" ? "Scanning…" : label}
      </button>

      {(phase === "review" || phase === "error") && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 safe-screen" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="modal-card w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-semibold">Confirm scan</h3>
                <p className="text-xs text-slate-400">
                  {ai ? "Read on-device with Apple Intelligence. " : "Read on-device. "}
                  Check highlighted fields before saving — nothing is saved until you tap Save.
                </p>
                {!ai && aiNotice(aiReason) && (
                  <p className="text-xs text-amber-300 mt-1">{aiNotice(aiReason)}</p>
                )}
              </div>
              <button onClick={close} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">&times;</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {phase === "error" && <p className="text-sm text-amber-300">{err}</p>}

              {phase === "review" && mode === "flights" && flightRows.map((r, i) => (
                <FlightReview
                  key={i}
                  row={r}
                  onChange={(patch) => setFlightRows((rs) => rs.map((x, j) => j === i ? { ...x, ...patch } : x))}
                />
              ))}

              {phase === "review" && mode === "document" && docRow && (
                <DocReview row={docRow} onChange={(patch) => setDocRow((d) => d ? { ...d, ...patch } : d)} />
              )}
            </div>

            {phase === "review" && (
              <div className="p-5 border-t border-slate-800 flex items-center justify-end gap-2">
                <button onClick={close} className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-4 py-2 rounded-lg transition">Cancel</button>
                <button
                  onClick={mode === "flights" ? saveFlights : saveDoc}
                  className="text-sm bg-brand-600 hover:bg-brand-700 text-white font-medium px-4 py-2 rounded-lg transition"
                >
                  {mode === "flights"
                    ? `Save ${flightRows.filter((r) => r.include).length} flight${flightRows.filter((r) => r.include).length === 1 ? "" : "s"}`
                    : "Save document"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------- field bits ------------------------------- */

function fieldCls(low: boolean): string {
  return "w-full px-2 py-1.5 text-sm border rounded-lg " +
    (low ? "border-amber-400 ring-1 ring-amber-400/40" : "border-slate-700");
}

function Labeled({ label, low, children }: { label: string; low?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={"block text-xs mb-0.5 " + (low ? "text-amber-300 font-medium" : "text-slate-400")}>
        {label}{low ? " ⚠" : ""}
      </span>
      {children}
    </label>
  );
}

function FlightReview({ row, onChange }: { row: FlightRow; onChange: (p: Partial<FlightRow>) => void }) {
  return (
    <div className={"rounded-xl border p-3 " + (row.include ? "border-slate-700 bg-slate-900/40" : "border-slate-800 opacity-50")}>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={row.include} onChange={(e) => onChange({ include: e.target.checked })} />
          Include this flight
        </label>
        {row.low.size > 0 && <span className="text-xs text-amber-300">{row.low.size} field{row.low.size === 1 ? "" : "s"} to check</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Labeled label="Date" low={row.low.has("date")}>
          <input type="date" value={row.date} onChange={(e) => onChange({ date: e.target.value })} className={fieldCls(row.low.has("date"))} />
        </Labeled>
        <Labeled label="Aircraft" low={row.low.has("aircraftType")}>
          <input value={row.aircraftType} onChange={(e) => onChange({ aircraftType: e.target.value })} className={fieldCls(row.low.has("aircraftType"))} />
        </Labeled>
        <Labeled label="Registration" low={row.low.has("registration")}>
          <input value={row.registration} onChange={(e) => onChange({ registration: e.target.value })} className={fieldCls(row.low.has("registration"))} />
        </Labeled>
        <Labeled label="From" low={row.low.has("from")}>
          <input value={row.from} onChange={(e) => onChange({ from: e.target.value.toUpperCase() })} className={fieldCls(row.low.has("from"))} />
        </Labeled>
        <Labeled label="To" low={row.low.has("to")}>
          <input value={row.to} onChange={(e) => onChange({ to: e.target.value.toUpperCase() })} className={fieldCls(row.low.has("to"))} />
        </Labeled>
        <Labeled label="Role" low={row.low.has("loggedRole")}>
          <input value={row.loggedRole} onChange={(e) => onChange({ loggedRole: e.target.value })} className={fieldCls(row.low.has("loggedRole"))} />
        </Labeled>
        <Labeled label="SE (hrs)" low={row.low.has("se")}>
          <input inputMode="decimal" value={row.se} onChange={(e) => onChange({ se: e.target.value })} className={fieldCls(row.low.has("se"))} />
        </Labeled>
        <Labeled label="ME (hrs)" low={row.low.has("me")}>
          <input inputMode="decimal" value={row.me} onChange={(e) => onChange({ me: e.target.value })} className={fieldCls(row.low.has("me"))} />
        </Labeled>
        <Labeled label="XC (hrs)" low={row.low.has("xc")}>
          <input inputMode="decimal" value={row.xc} onChange={(e) => onChange({ xc: e.target.value })} className={fieldCls(row.low.has("xc"))} />
        </Labeled>
        <Labeled label="PIC" low={row.low.has("pic")}>
          <input value={row.pic} onChange={(e) => onChange({ pic: e.target.value })} className={fieldCls(row.low.has("pic"))} />
        </Labeled>
        <Labeled label="SIC / Student" low={row.low.has("sic")}>
          <input value={row.sic} onChange={(e) => onChange({ sic: e.target.value })} className={fieldCls(row.low.has("sic"))} />
        </Labeled>
        <Labeled label="Notes">
          <input value={row.notes} onChange={(e) => onChange({ notes: e.target.value })} className={fieldCls(false)} />
        </Labeled>
      </div>
    </div>
  );
}

function DocReview({ row, onChange }: { row: DocRow; onChange: (p: Partial<DocRow>) => void }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
      <Labeled label="Document type" low={row.low.has("type")}>
        <input list="scan-doc-types" value={row.type} onChange={(e) => onChange({ type: e.target.value })} className={fieldCls(row.low.has("type"))} />
        <datalist id="scan-doc-types">
          {DOC_TYPES.map((d) => <option key={d.value} value={d.value} />)}
        </datalist>
      </Labeled>
      <Labeled label="Number" low={row.low.has("number")}>
        <input value={row.number} onChange={(e) => onChange({ number: e.target.value })} className={fieldCls(row.low.has("number"))} />
      </Labeled>
      <Labeled label="Issue date" low={row.low.has("issueDate")}>
        <input type="date" value={row.issueDate} onChange={(e) => onChange({ issueDate: e.target.value })} className={fieldCls(row.low.has("issueDate"))} />
      </Labeled>
      <Labeled label="Exam date (medical)" low={row.low.has("examDate")}>
        <input type="date" value={row.examDate} onChange={(e) => onChange({ examDate: e.target.value })} className={fieldCls(row.low.has("examDate"))} />
      </Labeled>
      <Labeled label="Expiry date" low={row.low.has("expiryDate")}>
        <input type="date" value={row.expiryDate} onChange={(e) => onChange({ expiryDate: e.target.value })} className={fieldCls(row.low.has("expiryDate"))} />
      </Labeled>
      <p className="text-xs text-slate-500 sm:col-span-2">
        Leave expiry blank for medicals and dated certificates — it will be auto-calculated from the exam/issue date where Transport Canada rules allow.
      </p>
    </div>
  );
}
