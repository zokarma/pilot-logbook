// Eval #15 — premium entitlement logic (src/lib/entitlement.ts).
// Gets money-adjacent decisions right: a lapsed sub must read as free, a paying
// pilot must never be locked out by a clock blip, and a malformed row must
// never accidentally grant premium.

import {
  effectiveTier, isPremium, hasFeature, tierHasFeature, entitlementFromRow,
  Entitlement, GRACE_DAYS, FREE,
} from "../src/lib/entitlement";
import { Suite } from "./harness";

const NOW = new Date("2026-07-15T00:00:00Z");
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * 86400000).toISOString();
const ent = (o: Partial<Entitlement>): Entitlement => ({ tier: "pro", status: "active", currentPeriodEnd: iso(20), ...o });

export function run(): Suite {
  const s = new Suite(15, "Entitlement logic (entitlement.ts)", "Premium/feature gating — a lapsed sub reads free, a paying pilot is never wrongly locked out, junk never grants premium.");

  // -- effective tier by status --
  s.check("active within period → its tier", effectiveTier(ent({ tier: "pro" }), NOW) === "pro");
  s.check("trialing grants access", effectiveTier(ent({ status: "trialing" }), NOW) === "pro");
  s.check("professional active → professional", effectiveTier(ent({ tier: "professional" }), NOW) === "professional");
  s.check("inactive → free regardless of tier field", effectiveTier(ent({ status: "inactive" }), NOW) === "free");
  s.check("null / undefined entitlement → free", effectiveTier(null, NOW) === "free" && effectiveTier(undefined, NOW) === "free");
  s.check("explicit free tier → free", effectiveTier(FREE, NOW) === "free");

  // -- expiry + grace window --
  s.check("active but period ended within grace → still premium", effectiveTier(ent({ currentPeriodEnd: iso(-1) }), NOW) === "pro");
  s.check(`active, ended exactly at the ${GRACE_DAYS}-day grace edge → still premium`, effectiveTier(ent({ currentPeriodEnd: iso(-GRACE_DAYS) }), NOW) === "pro");
  s.check("active, ended past the grace window → free", effectiveTier(ent({ currentPeriodEnd: iso(-GRACE_DAYS - 1) }), NOW) === "free");
  s.check("active with no period end (open-ended) → stays premium", effectiveTier(ent({ currentPeriodEnd: null }), NOW) === "pro");

  // -- past_due is a retriable state, not an immediate lockout --
  s.check("past_due within period → still premium (payment retrying)", effectiveTier(ent({ status: "past_due", currentPeriodEnd: iso(5) }), NOW) === "pro");
  s.check("past_due past grace → free", effectiveTier(ent({ status: "past_due", currentPeriodEnd: iso(-10) }), NOW) === "free");

  // -- canceled honors the paid remainder, then drops --
  s.check("canceled but paid through the future → keeps tier until then", effectiveTier(ent({ status: "canceled", currentPeriodEnd: iso(10) }), NOW) === "pro");
  s.check("canceled and period already elapsed → free", effectiveTier(ent({ status: "canceled", currentPeriodEnd: iso(-10) }), NOW) === "free");
  s.check("canceled with no period end → free", effectiveTier(ent({ status: "canceled", currentPeriodEnd: null }), NOW) === "free");

  // -- isPremium --
  s.check("isPremium true for an active pro", isPremium(ent({}), NOW));
  s.check("isPremium false for free/lapsed", !isPremium(FREE, NOW) && !isPremium(ent({ status: "inactive" }), NOW));

  // -- feature gating ladder --
  s.check("free unlocks nothing gated", !tierHasFeature("free", "aiScan") && !tierHasFeature("free", "multiDevice"));
  s.check("pro unlocks the everyday features incl. native apps + multi-device", tierHasFeature("pro", "aiScan") && tierHasFeature("pro", "nativeApps") && tierHasFeature("pro", "multiDevice") && tierHasFeature("pro", "backup"));
  s.check("pro does NOT unlock professional-only tools", !tierHasFeature("pro", "aiScanUnlimited") && !tierHasFeature("pro", "rosterImport") && !tierHasFeature("pro", "dutyRest"));
  s.check("professional unlocks everything", ["aiScan", "nativeApps", "aiScanUnlimited", "rosterImport", "companyReports", "advancedAnalytics", "dutyRest", "prioritySupport"].every((f) => tierHasFeature("professional", f as never)));
  s.check("hasFeature threads entitlement → tier → feature", hasFeature(ent({ tier: "professional" }), "rosterImport", NOW) && !hasFeature(ent({ tier: "pro" }), "rosterImport", NOW));
  s.check("a lapsed professional loses professional features", !hasFeature(ent({ tier: "professional", status: "canceled", currentPeriodEnd: iso(-30) }), "rosterImport", NOW));

  // -- row normalization (untrusted input) --
  s.check("snake_case DB row parsed", (() => { const e = entitlementFromRow({ tier: "professional", status: "active", current_period_end: iso(5), source: "stripe" }); return e.tier === "professional" && e.currentPeriodEnd === iso(5) && e.source === "stripe"; })());
  s.check("unknown tier collapses to free", entitlementFromRow({ tier: "platinum", status: "active" }).tier === "free");
  s.check("unknown status collapses to inactive", entitlementFromRow({ tier: "pro", status: "hacked" }).status === "inactive");
  s.check("garbage period end nulled", entitlementFromRow({ tier: "pro", status: "active", current_period_end: "not-a-date" }).currentPeriodEnd === null);
  s.check("non-object row → free defaults", entitlementFromRow(null).tier === "free" && entitlementFromRow("x").status === "inactive");
  s.check("a forged 'premium' row with a bad tier can't grant access", effectiveTier(entitlementFromRow({ tier: "premium", status: "active", current_period_end: iso(99) }), NOW) === "free");

  return s;
}
