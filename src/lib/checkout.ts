// Start a subscription checkout.
//
// The plan button asks the `create-checkout` Edge Function for a Stripe
// Checkout Session and redirects to the URL it returns. The user id that binds
// the purchase to an account is derived there from the caller's own JWT and
// written into the subscription's metadata, so it is never something the payer
// can edit.
//
// This replaced Stripe Payment Links (`NEXT_PUBLIC_STRIPE_LINK_*` +
// `?client_reference_id=<user id>`). That param sat on a URL the payer
// controlled, so a checkout could be aimed at ANOTHER account's user id and —
// because plb_entitlements is keyed by user_id — overwrite that account's
// Stripe customer/subscription binding. Nothing here may reintroduce a
// client-supplied user id or a client-supplied price. See BILLING.md.
//
// Login is required before checkout (BILLING.md rule #1): with no session
// there is no id to bind to, so the CTA routes to /login instead.

import type { Tier } from "./entitlement";

export type BillingPeriod = "month" | "year";

export const LOGIN_NEXT_PRICING = "/login?next=/pricing";

// Checkout runs entirely through the Edge Function, so cloud mode is the only
// requirement the client can see. Whether the prices are configured is a
// server-side question — the function answers it with a clear error.
export function checkoutConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export interface CheckoutStart {
  url?: string;      // Stripe Checkout URL to send the browser to
  redirect?: string; // in-app route to go to instead (not signed in / not configured)
  error?: string;    // shown next to the plan button
}

// The slice of the Supabase client this module uses. Declared so evals can
// inject a stub and exercise the signed-in branch without a browser or a live
// session — the request body it builds is a security-relevant surface.
export interface CheckoutClient {
  auth: { getSession: () => Promise<{ data: { session: unknown } }> };
  functions: {
    invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;
  };
}

// Resolve where a plan button should send the pilot. Split out from
// startCheckout so the decision is testable without a browser.
export async function checkoutTarget(
  tier: Exclude<Tier, "free">,
  period: BillingPeriod,
  client?: CheckoutClient,
): Promise<CheckoutStart> {
  if (!client && !checkoutConfigured()) return { redirect: LOGIN_NEXT_PRICING };

  // Deferred import keeps the Supabase SDK out of the public /pricing bundle
  // until a plan button is actually clicked.
  const sb = client ?? (await import("./supabaseClient")).getSupabaseClient() as CheckoutClient | null;
  if (!sb) return { redirect: LOGIN_NEXT_PRICING };

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { redirect: LOGIN_NEXT_PRICING }; // must be signed in to bind the purchase

  try {
    const { data, error } = await sb.functions.invoke("create-checkout", {
      body: { tier, period },
    });
    if (error) {
      // FunctionsHttpError carries the function's JSON body in context.
      let detail = "";
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try { detail = ((await ctx.json()) as { error?: string }).error ?? ""; } catch { /* opaque */ }
      }
      return { error: detail || "Could not start checkout — please try again." };
    }
    const url = (data as { url?: string } | null)?.url;
    if (!url) return { error: "Could not start checkout — please try again." };
    return { url };
  } catch {
    return { error: "Could not reach checkout — check your connection and try again." };
  }
}

// Convenience for CTA onClick. Navigates on success; returns an error string
// for the caller to display when checkout can't be started (a plan button that
// silently does nothing is a lost sale).
export async function startCheckout(
  tier: Exclude<Tier, "free">,
  period: BillingPeriod,
): Promise<{ error?: string }> {
  if (typeof window === "undefined") return {};
  const target = await checkoutTarget(tier, period);
  if (target.url) { window.location.href = target.url; return {}; }
  if (target.redirect) { window.location.href = target.redirect; return {}; }
  return { error: target.error };
}
