// Premium entitlement — pure, framework-free logic shared by the client hook
// (useEntitlement) and covered by evals. The server (stripe-webhook Edge
// Function) is the ONLY writer of the plb_entitlements row; this module just
// interprets it: resolves the effective tier for "now" (with an offline-safe
// grace window) and answers feature-gating questions.
//
// RULE: never trust the client for entitlement. This only READS a row that the
// service-role webhook wrote; it can't grant premium on its own.

// "professional" is NO LONGER SOLD — the site offers Free + Pro only (its
// headline features were never built). The tier stays in the type system so any
// subscription created while it was on sale still resolves, outranks pro, and
// keeps working; it simply has no purchase path. Do not re-list it on /pricing
// without building the features first (claims.eval.ts guards this).
export type Tier = "free" | "pro" | "professional";
export type SubStatus = "active" | "trialing" | "past_due" | "canceled" | "inactive";

export interface Entitlement {
  tier: Tier;
  status: SubStatus;
  currentPeriodEnd: string | null; // ISO instant the paid period ends, or null
  source?: string | null;          // "stripe" | "apple" | "google"
}

export const FREE: Entitlement = { tier: "free", status: "inactive", currentPeriodEnd: null };

export const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  professional: "Professional",
};

const RANK: Record<Tier, number> = { free: 0, pro: 1, professional: 2 };
const TIERS = new Set<Tier>(["free", "pro", "professional"]);
const STATUSES = new Set<SubStatus>(["active", "trialing", "past_due", "canceled", "inactive"]);

// Keep premium working this many days past the paid period / through a
// retriable payment problem, so a flaky connection or a card blip never locks
// a paying pilot out mid-trip. The subscription is offline-first: this reads
// the cached value; the grace absorbs the gap until the next successful sync.
export const GRACE_DAYS = 3;

function withinGrace(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const end = Date.parse(iso);
  if (isNaN(end)) return false;
  return now.getTime() <= end + GRACE_DAYS * 86400000;
}

// Statuses that grant access while still inside the paid period.
function statusGrants(status: SubStatus): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

// The tier actually in force right now. Lapsed/canceled/expired → free.
export function effectiveTier(e: Entitlement | null | undefined, now: Date = new Date()): Tier {
  if (!e || e.tier === "free") return "free";
  if (statusGrants(e.status)) {
    // Active-ish: valid unless the period end (+ grace) has already passed.
    if (e.currentPeriodEnd && !withinGrace(e.currentPeriodEnd, now)) return "free";
    return e.tier;
  }
  // Canceled: honor the already-paid remainder (+ grace), then drop to free.
  if (e.status === "canceled" && withinGrace(e.currentPeriodEnd, now)) return e.tier;
  return "free";
}

export function isPremium(e: Entitlement | null | undefined, now?: Date): boolean {
  return effectiveTier(e, now) !== "free";
}

/* ------------------------------ feature gating ------------------------------ */

// Only capabilities that are ACTUALLY gated somewhere in the UI belong here.
// A feature listed but never enforced becomes a promise on /pricing that the
// product doesn't keep — claims.eval.ts fails the build if one drifts back in.
export type Feature =
  | "aiScan" | "proPdf" | "advancedCurrency" | "docOcr" | "dutyRest";

// The lowest tier that unlocks each gated capability (mirrors the /pricing
// comparison). Everything paid sits at Pro — the single upgrade.
export const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  aiScan: "pro",
  proPdf: "pro",
  advancedCurrency: "pro",
  docOcr: "pro",
  dutyRest: "pro",
};

export function tierHasFeature(tier: Tier, f: Feature): boolean {
  return RANK[tier] >= RANK[FEATURE_MIN_TIER[f]];
}

export function hasFeature(e: Entitlement | null | undefined, f: Feature, now?: Date): boolean {
  return tierHasFeature(effectiveTier(e, now), f);
}

/* ------------------------------ normalization ------------------------------ */

// Turn an untrusted plb_entitlements row (or cached JSON) into a safe
// Entitlement. Unknown tiers/statuses collapse to the free defaults so a
// malformed row can never accidentally read as premium.
export function entitlementFromRow(row: unknown): Entitlement {
  if (!row || typeof row !== "object") return { ...FREE };
  const r = row as Record<string, unknown>;
  const tier = typeof r.tier === "string" && TIERS.has(r.tier as Tier) ? (r.tier as Tier) : "free";
  const status = typeof r.status === "string" && STATUSES.has(r.status as SubStatus) ? (r.status as SubStatus) : "inactive";
  const cpe = r.current_period_end ?? r.currentPeriodEnd;
  const currentPeriodEnd = typeof cpe === "string" && !isNaN(Date.parse(cpe)) ? cpe : null;
  const source = typeof r.source === "string" ? r.source : null;
  return { tier, status, currentPeriodEnd, source };
}

/* -------------------- many subscriptions → one entitlement ------------------ */

// A user can legitimately hold more than one Stripe subscription at once — an
// upgrade creates the new one before the old is cancelled — so plb_subscriptions
// keeps a row each and plb_entitlements is DERIVED from them.
//
// This is the derivation rule, kept here (pure, eval-covered) rather than only
// in the webhook. stripe-webhook mirrors it, as scan-extract mirrors
// effectiveTier — Edge Functions can't import from src/, so CHANGE THEM
// TOGETHER.
export interface SubscriptionLike {
  tier: Tier;
  status: SubStatus;
  currentPeriodEnd: string | null;
}

// Pick the subscription that actually governs access right now: the one
// granting the highest tier, breaking ties on the furthest-out paid period.
//
// The key property is that this can only ever be as generous as the user's
// best subscription. One subscription lapsing or being cancelled can't pull
// access away while another still grants it — the losing row simply stops
// winning. Returns null when the user has no subscriptions at all.
//
// When nothing currently grants, the most recently-ending row is returned
// anyway: its (tier, status, currentPeriodEnd) still reads as free through
// effectiveTier, but publishing it keeps the grace window and the client's
// "your plan ended" context intact instead of blanking the row.
export function pickEffectiveSubscription<T extends SubscriptionLike>(
  subs: readonly T[],
  now: Date = new Date(),
): T | null {
  if (!subs.length) return null;
  const endOf = (s: T) => {
    const t = s.currentPeriodEnd ? Date.parse(s.currentPeriodEnd) : NaN;
    return isNaN(t) ? Infinity : t; // no end date = open-ended, sorts last
  };
  let best: T | null = null;
  let bestRank = -1;
  for (const s of subs) {
    const rank = RANK[effectiveTier(s, now)];
    if (rank > bestRank || (rank === bestRank && best !== null && endOf(s) > endOf(best))) {
      best = s;
      bestRank = rank;
    }
  }
  return best;
}

// The Entitlement a set of subscriptions adds up to. FREE when there are none.
export function entitlementFromSubscriptions(
  subs: readonly SubscriptionLike[],
  now: Date = new Date(),
): Entitlement {
  const best = pickEffectiveSubscription(subs, now);
  if (!best) return { ...FREE };
  return {
    tier: best.tier,
    status: best.status,
    currentPeriodEnd: best.currentPeriodEnd,
    source: (best as Entitlement).source ?? null,
  };
}

/* ------------------------------ plan description ------------------------------
 * Human-readable summary of where a pilot stands, for the "Your plan" panel.
 *
 * This matters more than it looks on iOS. Subscriptions are sold on the website
 * only, so the app can't offer an upgrade — but it must still tell a paying
 * pilot that they ARE paying, and when their access runs to. Without it a Pro
 * subscriber opening the app sees no evidence their money did anything.
 *
 * Pure so the wording is eval-able; the UI decides what (if any) action to
 * attach, since a purchase link is only legal on the web.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "2026-08-12T…" → "12 August 2026". Empty string when there's no date.
 *
 * Formatted in UTC on purpose. Stripe period ends land on midnight UTC, so
 * local getters would show the day BEFORE for every pilot west of Greenwich —
 * i.e. all of Canada — and the app would disagree with their invoice.
 */
export function formatPeriodEnd(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface PlanDescription {
  /** Plan name to show, already resolved through effectiveTier (expiry applied). */
  label: string;
  /** One line of context: renewal, trial end, or what Free includes. */
  detail: string;
  /** True when the pilot should do something (failed payment, ending trial). */
  needsAttention: boolean;
}

export function describeEntitlement(
  e: Entitlement | null | undefined,
  now: Date = new Date(),
): PlanDescription {
  const tier = effectiveTier(e, now);
  if (tier === "free") {
    return {
      label: TIER_LABEL.free,
      detail: "Logging, currency, documents and exports — yours for good.",
      needsAttention: false,
    };
  }
  const label = TIER_LABEL[tier];
  const when = formatPeriodEnd(e?.currentPeriodEnd ?? null);
  switch (e?.status) {
    case "trialing":
      return {
        label: `${label} trial`,
        detail: when ? `Your trial runs to ${when}.` : "You're on a free trial.",
        needsAttention: true,
      };
    case "past_due":
      return {
        label,
        detail: "We couldn't take the last payment — update your card to keep it.",
        needsAttention: true,
      };
    case "canceled":
      return {
        label,
        detail: when ? `Cancelled — you keep ${label} until ${when}.` : `Cancelled.`,
        needsAttention: true,
      };
    default:
      return {
        label,
        detail: when ? `Renews ${when}.` : "Active.",
        needsAttention: false,
      };
  }
}
