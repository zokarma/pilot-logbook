// Aviation-document catalog, Transport Canada expiry math, and status helpers.
// Pure and framework-free — everything is derived from the values passed in.

import { PilotDocument, UserProfile, DocExpiryMode } from "./types";

export const PILOT_ROLES = [
  "Student Pilot",
  "Private Pilot",
  "Commercial Pilot",
  "First Officer",
  "Captain",
  "Second Officer",
  "Flight Instructor",
  "Other",
] as const;

export type DocCategory = "License" | "Medical" | "Certificate";

// Default expiry behaviour for a document type:
//  - "none":   the document does not expire (user may still override to manual).
//  - "manual": expiry must be entered by hand (no reliable formula).
//  - "auto":   expiry is calculated. `basis` picks the anchor date and, for
//              non-medical items, `months` is added to it. Medical items use the
//              age/category rules in medicalValidityMonths() instead.
export interface DocTypeDef {
  value: string;
  category: DocCategory;
  expiry: DocExpiryMode;
  auto?: { basis: "issue" | "exam"; months?: number; medical?: boolean };
}

export const DOC_TYPES: DocTypeDef[] = [
  // Licences — Canadian flight-crew licences don't themselves expire; currency
  // is gated by the medical, so these default to "no expiry".
  { value: "Student Pilot Permit (SPP)", category: "License", expiry: "none" },
  { value: "Private Pilot Licence (PPL)", category: "License", expiry: "none" },
  { value: "Commercial Pilot Licence (CPL)", category: "License", expiry: "none" },
  { value: "Airline Transport Pilot Licence (ATPL)", category: "License", expiry: "none" },

  // Medicals — auto-calculated from the exam date + age at exam (TC rules).
  { value: "Category 1 Medical", category: "Medical", expiry: "auto", auto: { basis: "exam", medical: true } },
  { value: "Category 3 Medical", category: "Medical", expiry: "auto", auto: { basis: "exam", medical: true } },
  { value: "Category 4 Medical", category: "Medical", expiry: "auto", auto: { basis: "exam", medical: true } },

  // Certificates & ratings.
  { value: "Radio Operator Certificate", category: "Certificate", expiry: "none" },
  { value: "Restricted Operator Certificate (Aeronautical)", category: "Certificate", expiry: "none" },
  { value: "Instrument Rating", category: "Certificate", expiry: "auto", auto: { basis: "issue", months: 24 } },
  { value: "Multi-Engine Rating", category: "Certificate", expiry: "none" },
  { value: "Instructor Rating", category: "Certificate", expiry: "manual" },
  { value: "Type Rating", category: "Certificate", expiry: "manual" },
  { value: "Dangerous Goods Training", category: "Certificate", expiry: "auto", auto: { basis: "issue", months: 24 } },
  { value: "CRM Training", category: "Certificate", expiry: "auto", auto: { basis: "issue", months: 12 } },
  { value: "Other", category: "Certificate", expiry: "manual" },
];

export function docTypeDef(type: string): DocTypeDef | undefined {
  return DOC_TYPES.find((d) => d.value === type);
}

// Grouped for the dropdowns / wizard, preserving catalog order.
export const DOC_GROUPS: { category: DocCategory; label: string; types: DocTypeDef[] }[] = [
  { category: "License", label: "Licences", types: DOC_TYPES.filter((d) => d.category === "License") },
  { category: "Medical", label: "Medical", types: DOC_TYPES.filter((d) => d.category === "Medical") },
  { category: "Certificate", label: "Certificates & Ratings", types: DOC_TYPES.filter((d) => d.category === "Certificate") },
];

/* ---------------- date helpers ---------------- */

// Add `months` to a "YYYY-MM-DD" date, returning "YYYY-MM-DD". Clamps overflow
// (e.g. Jan 31 + 1 month → Feb 28/29) the same way most renewal tables do.
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return "";
  const base = new Date(y, m - 1, d);
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${target.getFullYear()}-${mm}-${dd}`;
}

// Push a "YYYY-MM-DD" date to the last day of its month (e.g. 2026-03-15 →
// 2026-03-31). Used for Transport Canada medical expiries.
export function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-").map((n) => parseInt(n, 10));
  if (!y || !m) return "";
  const last = new Date(y, m, 0).getDate(); // day 0 of next month = last of this
  return `${dateStr.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

// Whole years between two "YYYY-MM-DD" dates (age of `dob` on `onDate`).
export function ageOn(dob: string, onDate: string): number | null {
  const [by, bm, bd] = dob.split("-").map((n) => parseInt(n, 10));
  const [oy, om, od] = onDate.split("-").map((n) => parseInt(n, 10));
  if (!by || !oy) return null;
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

/* ---------------- expiry math ---------------- */

// Transport Canada medical certificate validity (months), simplified for the
// common cases: validity shortens once the holder is 40+ at the date of exam.
//   Category 1: <40 → 12 months, 40+ → 6 months
//   Category 3: <40 → 60 months, 40+ → 24 months
//   Category 4: <40 → 60 months, 40+ → 24 months
export function medicalValidityMonths(type: string, ageAtExam: number): number {
  const cat1 = type.includes("Category 1");
  if (cat1) return ageAtExam >= 40 ? 6 : 12;
  return ageAtExam >= 40 ? 24 : 60;
}

// Compute the auto expiry for a document, given the account holder's profile
// (for date-of-birth on medicals). Returns "" when it can't be determined yet
// (e.g. a medical is missing the exam date or the user's date of birth).
export function computeAutoExpiry(doc: PilotDocument, profile: UserProfile | null): string {
  const def = docTypeDef(doc.type);
  if (!def?.auto) return "";
  if (def.auto.medical) {
    const exam = doc.examDate;
    const dob = profile?.dateOfBirth;
    if (!exam || !dob) return "";
    const age = ageOn(dob, exam);
    if (age == null) return "";
    // Transport Canada medicals stay valid until the LAST DAY of the month in
    // which the validity period ends — not the exact anniversary of the exam.
    return endOfMonth(addMonths(exam, medicalValidityMonths(doc.type, age)));
  }
  const anchor = def.auto.basis === "exam" ? doc.examDate : doc.issueDate;
  if (!anchor || !def.auto.months) return "";
  return addMonths(anchor, def.auto.months);
}

// Re-derive an auto document's expiry in place-safe form (returns a new object).
// Manual / none documents are returned unchanged.
export function recalcDocument(doc: PilotDocument, profile: UserProfile | null): PilotDocument {
  if (doc.expiryMode !== "auto") return doc;
  return { ...doc, expiryDate: computeAutoExpiry(doc, profile), updatedAt: new Date().toISOString() };
}

/* ---------------- status ---------------- */

export type DocStatus = "valid" | "expiring" | "expired" | "none";

export const EXPIRING_SOON_DAYS = 60;

export interface DocStatusInfo {
  status: DocStatus;
  days: number | null; // days until expiry (negative if expired); null when no expiry
  label: string; // human-readable, e.g. "Valid until March 12, 2027"
}

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  if (!y) return dateStr;
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// today at local midnight, so "days until" is whole-day accurate
function startOfToday(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

export function documentStatus(doc: PilotDocument): DocStatusInfo {
  if (doc.expiryMode === "none" || !doc.expiryDate) {
    return { status: "none", days: null, label: "No expiry" };
  }
  const [y, m, d] = doc.expiryDate.split("-").map((n) => parseInt(n, 10));
  if (!y) return { status: "none", days: null, label: "No expiry" };
  const exp = new Date(y, (m || 1) - 1, d || 1).getTime();
  const days = Math.round((exp - startOfToday()) / 86400000);
  if (days < 0) {
    const ago = Math.abs(days);
    return { status: "expired", days, label: `Expired ${ago} day${ago === 1 ? "" : "s"} ago` };
  }
  if (days <= EXPIRING_SOON_DAYS) {
    return {
      status: "expiring",
      days,
      label: days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}`,
    };
  }
  return { status: "valid", days, label: `Valid until ${fmtDate(doc.expiryDate)}` };
}

// Presentation metadata per status (icon glyph + Tailwind text colour class).
export const STATUS_META: Record<DocStatus, { icon: string; cls: string; short: string }> = {
  valid: { icon: "✅", cls: "text-emerald-400", short: "Valid" },
  expiring: { icon: "⚠️", cls: "text-amber-400", short: "Expiring Soon" },
  expired: { icon: "❌", cls: "text-red-400", short: "Expired" },
  none: { icon: "✅", cls: "text-slate-300", short: "No Expiry" },
};

// A friendly short name for a document type (drops the parenthetical for chips).
export function docShortName(type: string): string {
  return type.replace(/\s*\([^)]*\)\s*$/, "").trim() || type;
}
