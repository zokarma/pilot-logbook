// Eval #15 — premium entitlement logic (src/lib/entitlement.ts).
// Gets money-adjacent decisions right: a lapsed sub must read as free, a paying
// pilot must never be locked out by a clock blip, and a malformed row must
// never accidentally grant premium.

import {
  effectiveTier, isPremium, hasFeature, tierHasFeature, entitlementFromRow,
  pickEffectiveSubscription, entitlementFromSubscriptions,
  Entitlement, SubscriptionLike, GRACE_DAYS, FREE,
} from "../src/lib/entitlement";
import { Suite } from "./harness";

const NOW = new Date("2026-07-15T00:00:00Z");
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * 86400000).toISOString();
const ent = (o: Partial<Entitlement>): Entitlement => ({ tier: "pro", status: "active", currentPeriodEnd: iso(20), ...o });

export function run(): Suite {
  const s = new Suite(11, "Entitlement logic (entitlement.ts)", "Premium/feature gating — a lapsed sub reads free, a paying pilot is never wrongly locked out, junk never grants premium.");

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
  // Every paid capability sits at Pro — Professional is no longer sold (its
  // headline features were never built), though the tier still resolves for
  // any subscription created while it was listed.
  s.check("free unlocks nothing gated", !tierHasFeature("free", "aiScan") && !tierHasFeature("free", "dutyRest") && !tierHasFeature("free", "proPdf"));
  s.check("pro unlocks every paid capability we sell", (["aiScan", "proPdf", "advancedCurrency", "docOcr", "dutyRest"] as const).every((f) => tierHasFeature("pro", f)));
  s.check("a legacy professional subscription still outranks pro (grandfathered)", (["aiScan", "dutyRest"] as const).every((f) => tierHasFeature("professional", f)));
  s.check("hasFeature threads entitlement → tier → feature", hasFeature(ent({ tier: "pro" }), "dutyRest", NOW) && !hasFeature(FREE, "dutyRest", NOW));
  s.check("a lapsed pro loses the paid features", !hasFeature(ent({ tier: "pro", status: "canceled", currentPeriodEnd: iso(-30) }), "aiScan", NOW));

  // -- row normalization (untrusted input) --
  s.check("snake_case DB row parsed", (() => { const e = entitlementFromRow({ tier: "professional", status: "active", current_period_end: iso(5), source: "stripe" }); return e.tier === "professional" && e.currentPeriodEnd === iso(5) && e.source === "stripe"; })());
  s.check("unknown tier collapses to free", entitlementFromRow({ tier: "platinum", status: "active" }).tier === "free");
  s.check("unknown status collapses to inactive", entitlementFromRow({ tier: "pro", status: "hacked" }).status === "inactive");
  s.check("garbage period end nulled", entitlementFromRow({ tier: "pro", status: "active", current_period_end: "not-a-date" }).currentPeriodEnd === null);
  s.check("non-object row → free defaults", entitlementFromRow(null).tier === "free" && entitlementFromRow("x").status === "inactive");
  s.check("a forged 'premium' row with a bad tier can't grant access", effectiveTier(entitlementFromRow({ tier: "premium", status: "active", current_period_end: iso(99) }), NOW) === "free");

  // -- many subscriptions → one entitlement (plb_subscriptions → plb_entitlements) --
  // The webhook mirrors this rule; it decides what a user with more than one
  // Stripe subscription actually gets. The property that matters: one
  // subscription can only ever ADD access, never take away what another grants.
  {
    const sub = (o: Partial<SubscriptionLike>): SubscriptionLike =>
      ({ tier: "pro", status: "active", currentPeriodEnd: iso(20), ...o });
    const tierOf = (subs: SubscriptionLike[]) => effectiveTier(entitlementFromSubscriptions(subs, NOW), NOW);

    s.check("no subscriptions → free", entitlementFromSubscriptions([], NOW).tier === "free");
    s.check("no subscriptions → null pick", pickEffectiveSubscription([], NOW) === null);
    s.check("one active subscription → its tier", tierOf([sub({})]) === "pro");

    // The upgrade window: both live at once, briefly.
    s.check("holding pro + professional grants professional",
      tierOf([sub({ tier: "pro" }), sub({ tier: "professional" })]) === "professional");
    s.check("order doesn't matter",
      tierOf([sub({ tier: "professional" }), sub({ tier: "pro" })]) === "professional");

    // THE regression guard. Under the old one-row-per-user model, an event for
    // a second subscription overwrote the first, so cancelling the stray one
    // revoked access the live one was still paying for.
    s.check("a lapsed subscription cannot revoke a live one",
      tierOf([
        sub({ tier: "professional", status: "canceled", currentPeriodEnd: iso(-90) }),
        sub({ tier: "pro", status: "active", currentPeriodEnd: iso(20) }),
      ]) === "pro");
    s.check("a cancelled higher tier doesn't drag down a live lower tier",
      tierOf([
        sub({ tier: "professional", status: "canceled", currentPeriodEnd: iso(-90) }),
        sub({ tier: "professional", status: "active", currentPeriodEnd: iso(30) }),
      ]) === "professional");
    s.check("an inactive/never-started subscription is ignored beside a live one",
      tierOf([sub({ status: "inactive", tier: "professional" }), sub({ tier: "pro" })]) === "pro");

    // Ties resolve to the furthest-out paid period, so the published row is the
    // one that keeps the pilot flying longest.
    s.check("equal tiers pick the later period end",
      pickEffectiveSubscription([
        sub({ currentPeriodEnd: iso(5) }), sub({ currentPeriodEnd: iso(40) }),
      ], NOW)!.currentPeriodEnd === iso(40));

    // All lapsed: still publish a coherent row (grace + "your plan ended"
    // context) rather than blanking it — and it must still read as free.
    {
      const allLapsed = [
        sub({ status: "canceled", currentPeriodEnd: iso(-90) }),
        sub({ status: "canceled", currentPeriodEnd: iso(-40) }),
      ];
      s.check("all lapsed → reads free", tierOf(allLapsed) === "free");
      s.check("...but the most recent one is still published",
        entitlementFromSubscriptions(allLapsed, NOW).currentPeriodEnd === iso(-40));
    }

    // A cancelled subscription inside its already-paid remainder still counts.
    s.check("cancelled but inside the paid period still grants",
      tierOf([sub({ status: "canceled", currentPeriodEnd: iso(10) })]) === "pro");
    s.check("cancelled inside grace still grants",
      tierOf([sub({ status: "canceled", currentPeriodEnd: iso(-GRACE_DAYS) })]) === "pro");

    // The derived row must survive a round trip through the DB shape the client
    // actually reads, or the recompute publishes something useless.
    {
      const derived = entitlementFromSubscriptions([sub({ tier: "professional" })], NOW);
      const roundTripped = entitlementFromRow({
        tier: derived.tier, status: derived.status, current_period_end: derived.currentPeriodEnd,
      });
      s.check("the derived row survives entitlementFromRow unchanged",
        effectiveTier(roundTripped, NOW) === "professional");
    }
  }

  return s;
}
