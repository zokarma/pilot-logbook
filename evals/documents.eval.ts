// Eval #3 — Transport Canada document expiry math (src/lib/documents.ts).
// A wrong expiry can tell a pilot an invalid medical is valid — legal exposure.

import {
  addMonths, ageOn, medicalValidityMonths, computeAutoExpiry, recalcDocument,
  documentStatus, EXPIRING_SOON_DAYS,
} from "../src/lib/documents";
import { PilotDocument, UserProfile } from "../src/lib/types";
import { Suite } from "./harness";
import { localDateOffset } from "./fixtures";

const doc = (over: Partial<PilotDocument>): PilotDocument => ({
  id: "d1",
  type: "Other",
  expiryMode: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const profile = (dob?: string): UserProfile => ({
  firstName: "Z", lastName: "K", role: "Captain", onboarded: true, dateOfBirth: dob,
});

export function run(): Suite {
  const s = new Suite(4, "TC document expiry math (documents.ts)", "Wrong expiry dates create real legal exposure — a pilot could fly on an expired medical.");

  // -- calendar arithmetic --
  s.eq("addMonths: plain 12-month add", addMonths("2026-07-17", 12), "2027-07-17");
  s.eq("addMonths: Jan 31 + 1 clamps to Feb 28", addMonths("2026-01-31", 1), "2026-02-28");
  s.eq("addMonths: Jan 31 + 1 in a leap year clamps to Feb 29", addMonths("2024-01-31", 1), "2024-02-29");
  s.eq("addMonths: Aug 31 + 6 clamps across the year boundary", addMonths("2026-08-31", 6), "2027-02-28");
  s.eq("addMonths: garbage in, empty out", addMonths("not-a-date", 6), "");

  s.eq("ageOn: turns 40 ON the birthday", ageOn("1986-07-17", "2026-07-17"), 40);
  s.eq("ageOn: still 39 the day before", ageOn("1986-07-18", "2026-07-17"), 39);

  // -- medical validity table (age at exam) --
  s.eq("Cat 1, age 39 → 12 months", medicalValidityMonths("Category 1 Medical", 39), 12);
  s.eq("Cat 1, age 40 → 6 months", medicalValidityMonths("Category 1 Medical", 40), 6);
  s.eq("Cat 3, age 39 → 60 months", medicalValidityMonths("Category 3 Medical", 39), 60);
  s.eq("Cat 3, age 40 → 24 months", medicalValidityMonths("Category 3 Medical", 40), 24);
  s.eq("Cat 4, age 45 → 24 months", medicalValidityMonths("Category 4 Medical", 45), 24);

  // -- end-to-end auto expiry --
  // TC medicals stay valid to the LAST DAY of the month the validity period
  // ends in (endOfMonth), so exam 2026-07-17 + 12 months → 2027-07-31.
  s.eq(
    "Cat 1 medical, under 40 at exam → exam + 12, end of month",
    computeAutoExpiry(doc({ type: "Category 1 Medical", expiryMode: "auto", examDate: "2026-07-17" }), profile("1990-01-01")),
    "2027-07-31",
  );
  s.eq(
    "Cat 1 medical, 40+ at exam → exam + 6, end of month",
    computeAutoExpiry(doc({ type: "Category 1 Medical", expiryMode: "auto", examDate: "2026-07-17" }), profile("1980-01-01")),
    "2027-01-31",
  );
  s.eq(
    "exam on the 40th birthday uses the 40+ row (boundary)",
    computeAutoExpiry(doc({ type: "Category 1 Medical", expiryMode: "auto", examDate: "2026-07-17" }), profile("1986-07-17")),
    "2027-01-31",
  );
  s.eq(
    "Cat 3 medical, under 40 → exam + 60, end of month",
    computeAutoExpiry(doc({ type: "Category 3 Medical", expiryMode: "auto", examDate: "2026-07-17" }), profile("1995-01-01")),
    "2031-07-31",
  );
  s.eq(
    "medical validity extends to month end even when exam is on the 1st",
    computeAutoExpiry(doc({ type: "Category 1 Medical", expiryMode: "auto", examDate: "2026-02-01" }), profile("1990-01-01")),
    "2027-02-28",
  );
  s.eq(
    "medical without a DOB can't compute (empty, not wrong)",
    computeAutoExpiry(doc({ type: "Category 1 Medical", expiryMode: "auto", examDate: "2026-07-17" }), profile(undefined)),
    "",
  );
  s.eq(
    "medical without an exam date can't compute",
    computeAutoExpiry(doc({ type: "Category 1 Medical", expiryMode: "auto" }), profile("1990-01-01")),
    "",
  );
  s.eq(
    "Instrument Rating → issue + 24",
    computeAutoExpiry(doc({ type: "Instrument Rating", expiryMode: "auto", issueDate: "2026-05-01" }), null),
    "2028-05-01",
  );
  s.eq(
    "CRM Training → issue + 12",
    computeAutoExpiry(doc({ type: "CRM Training", expiryMode: "auto", issueDate: "2026-05-01" }), null),
    "2027-05-01",
  );
  s.eq(
    "non-expiring licence type has no auto expiry",
    computeAutoExpiry(doc({ type: "Private Pilot Licence (PPL)", expiryMode: "none" }), null),
    "",
  );

  // -- recalc leaves manual/none documents alone --
  {
    const m = doc({ type: "Type Rating", expiryMode: "manual", expiryDate: "2030-01-01" });
    s.check("recalcDocument returns manual docs unchanged (same object)", recalcDocument(m, null) === m);
  }

  // -- status boundaries relative to today --
  s.check("expires today → 'expiring', days 0", (() => { const r = documentStatus(doc({ expiryDate: localDateOffset(0) })); return r.status === "expiring" && r.days === 0 && r.label === "Expires today"; })());
  s.check(`expires in ${EXPIRING_SOON_DAYS} days → still 'expiring'`, documentStatus(doc({ expiryDate: localDateOffset(EXPIRING_SOON_DAYS) })).status === "expiring");
  s.check(`expires in ${EXPIRING_SOON_DAYS + 1} days → 'valid'`, documentStatus(doc({ expiryDate: localDateOffset(EXPIRING_SOON_DAYS + 1) })).status === "valid");
  s.check("expired yesterday → 'expired', days -1", (() => { const r = documentStatus(doc({ expiryDate: localDateOffset(-1) })); return r.status === "expired" && r.days === -1 && r.label === "Expired 1 day ago"; })());
  s.check("expiryMode 'none' → status 'none'", documentStatus(doc({ expiryMode: "none" })).status === "none");
  s.check("empty expiry date → status 'none'", documentStatus(doc({ expiryDate: "" })).status === "none");

  // -- domain-accuracy probes (not failures; the current math is CONSERVATIVE) --
  s.probe(
    "TC end-of-month rule",
    "Medical validity now extends to the last day of the month the period ends in (endOfMonth in documents.ts), matching the CARs — the earlier ~30-day-short finding is FIXED and locked in by the checks above.",
  );
  s.probe(
    "Instrument Rating anchor",
    "IR validity is computed as issue+24 months to the same day; the TC convention is first day of the 25th month. Same conservative bias as medicals.",
  );
  s.probe(
    "Cat 1 40+ six-month rule scope",
    "The 6-month row for 40+ Cat 1 applies to single-pilot air-transport ops; many 40+ holders (two-crew airline, private) legally keep 12 months. The app always applies 6 — conservative, but overstates renewals for two-crew pilots.",
  );

  return s;
}
