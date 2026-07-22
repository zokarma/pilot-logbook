// Start a subscription checkout. We use Stripe Payment Links (no server needed
// to START checkout — the webhook does the server work) and pass the signed-in
// user's id as client_reference_id so the webhook can map the purchase to the
// account (BILLING.md rule #1: require login before the paywall).
//
// Configure the links per plan/period via public env (safe to ship):
//   NEXT_PUBLIC_STRIPE_LINK_PRO_MONTHLY / _PRO_YEARLY
//   NEXT_PUBLIC_STRIPE_LINK_PROFESSIONAL_MONTHLY / _PROFESSIONAL_YEARLY
// Until they're set, checkout gracefully falls back to the signup page.

import type { Tier } from "./entitlement";

export type BillingPeriod = "month" | "year";

const LINKS: Record<string, string | undefined> = {
  "pro:month": process.env.NEXT_PUBLIC_STRIPE_LINK_PRO_MONTHLY,
  "pro:year": process.env.NEXT_PUBLIC_STRIPE_LINK_PRO_YEARLY,
  "professional:month": process.env.NEXT_PUBLIC_STRIPE_LINK_PROFESSIONAL_MONTHLY,
  "professional:year": process.env.NEXT_PUBLIC_STRIPE_LINK_PROFESSIONAL_YEARLY,
};

export function checkoutConfigured(): boolean {
  return Object.values(LINKS).some(Boolean);
}

// Resolve the checkout URL for a plan, attaching client_reference_id when a
// user is signed in. Returns "/login?next=/pricing" when checkout isn't ready
// or nobody is signed in, so the CTA always does something sensible.
export async function checkoutUrl(tier: Exclude<Tier, "free">, period: BillingPeriod): Promise<string> {
  const base = LINKS[`${tier}:${period}`];
  if (!base) return "/login?next=/pricing";

  // Deferred import keeps the Supabase SDK out of the public /pricing bundle
  // until a plan button is actually clicked.
  const { getSupabaseClient } = await import("./supabaseClient");
  const sb = getSupabaseClient();
  if (sb) {
    const { data } = await sb.auth.getUser();
    if (!data.user) return "/login?next=/pricing"; // must be logged in to map the purchase
    const sep = base.includes("?") ? "&" : "?";
    const email = data.user.email ? `&prefilled_email=${encodeURIComponent(data.user.email)}` : "";
    return `${base}${sep}client_reference_id=${encodeURIComponent(data.user.id)}${email}`;
  }
  return base;
}

// Convenience for CTA onClick.
export async function startCheckout(tier: Exclude<Tier, "free">, period: BillingPeriod): Promise<void> {
  if (typeof window === "undefined") return;
  window.location.href = await checkoutUrl(tier, period);
}
