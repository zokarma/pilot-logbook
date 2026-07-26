// Eval #19 — subscription checkout links (src/lib/checkout.ts).
// The revenue path: a plan button resolves to a Stripe Payment Link carrying
// the signed-in user's id as client_reference_id, which is the ONLY thing that
// lets stripe-webhook map a purchase to an account. A cross-wired or
// reference-less link means money in with no entitlement out.
//
// The links come from NEXT_PUBLIC_STRIPE_LINK_* env, read at module load — so
// this suite sets them before importing the module. (In the Next build these
// are inlined at compile time; here they're read from process.env at runtime,
// which exercises the same lookup table.)

import { Suite } from "./harness";

const LINK = {
  proMonth: "https://buy.stripe.com/test_pro_monthly",
  proYear: "https://buy.stripe.com/test_pro_yearly?utm_source=pricing",
  profMonth: "https://buy.stripe.com/test_professional_monthly",
  profYear: "https://buy.stripe.com/test_professional_yearly",
};

export async function run(): Promise<Suite> {
  const s = new Suite(19, "Checkout links (checkout.ts)", "Revenue path — a mis-wired or reference-less payment link takes money without granting the plan.");

  // Pin local-only mode so the resolver's behavior is deterministic (see the
  // probes below for what the signed-in branch does instead).
  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  process.env.NEXT_PUBLIC_STRIPE_LINK_PRO_MONTHLY = LINK.proMonth;
  process.env.NEXT_PUBLIC_STRIPE_LINK_PRO_YEARLY = LINK.proYear;
  process.env.NEXT_PUBLIC_STRIPE_LINK_PROFESSIONAL_MONTHLY = LINK.profMonth;
  process.env.NEXT_PUBLIC_STRIPE_LINK_PROFESSIONAL_YEARLY = LINK.profYear;

  const { checkoutConfigured, checkoutUrl, startCheckout } = await import("../src/lib/checkout");

  s.check("checkout reports configured once links are set", checkoutConfigured() === true);

  const got = {
    proMonth: await checkoutUrl("pro", "month"),
    proYear: await checkoutUrl("pro", "year"),
    profMonth: await checkoutUrl("professional", "month"),
    profYear: await checkoutUrl("professional", "year"),
  };

  // Cross-wiring (pasting the Pro link under Professional, or monthly under
  // yearly) is the classic Payment-Link mistake and silently undercharges.
  s.eq("every tier × period resolves to its own link", got, LINK);
  s.check("the four plan links are distinct", new Set(Object.values(got)).size === 4);
  s.check("no plan button falls back to the login page while configured", Object.values(got).every((u) => !u.startsWith("/login")));

  // An unknown tier/period pair (a plan added to the UI before its link is set)
  // must degrade to something sensible, never to `undefined` in the href.
  const unmapped = await checkoutUrl("enterprise" as never, "month");
  s.check("an unconfigured plan falls back to /login?next=/pricing", unmapped === "/login?next=/pricing");
  const unmappedPeriod = await checkoutUrl("pro", "week" as never);
  s.check("an unconfigured period falls back the same way", unmappedPeriod === "/login?next=/pricing");

  s.check("startCheckout is a no-op without a window (prerender-safe)", (await startCheckout("pro", "month")) === undefined);

  s.probe(
    "local-only mode issues a payment link with NO client_reference_id",
    `with Supabase unconfigured getSupabaseClient() returns null and checkoutUrl returns the bare link ("${got.proMonth}"). A purchase made from that build reaches Stripe with nothing to map it to an account, so stripe-webhook can't grant the entitlement — it becomes a manual refund/fix. The website always has Supabase configured, so this is only reachable in a mis-deployed build; returning "/login?next=/pricing" in that branch would make it impossible.`,
  );
  s.probe(
    "signed-in URL shape is not covered here",
    "the client_reference_id + prefilled_email branch needs a live Supabase session (auth.getUser()), so it's exercised only in the browser. Verified manually in Stripe test mode per BILLING.md; a Supabase-client stub (dependency injection in checkoutUrl) would bring the ?/& separator and the URL-encoding of the user id under eval.",
  );

  if (priorUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
  if (priorKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey;

  return s;
}
