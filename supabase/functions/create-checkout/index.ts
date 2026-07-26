// Supabase Edge Function: create-checkout
//
// Starts a Stripe subscription checkout for the CALLING user.
//
// This replaces the Payment Link flow, and the reason is security. A Payment
// Link carries the app's user id in `?client_reference_id=…` — a query param on
// a URL the payer can edit — and that param was the only thing binding a
// payment to an account. Anyone could therefore check out against SOMEONE
// ELSE'S user id, and because plb_entitlements is keyed by user_id, that
// checkout would overwrite the victim's stripe_customer_id/subscription_id:
// a later cancel on the stranger's subscription then revoked premium the
// victim was still being billed for by Stripe.
//
// Here the user id is taken from the caller's own verified JWT and stamped
// into `subscription_data.metadata.user_id`, which the payer cannot touch. The
// webhook reads that metadata and ignores client_reference_id entirely, so the
// binding is authenticated end to end. The plan the caller asks for is mapped
// to a price id SERVER-side (STRIPE_PRICE_IDS) — the client never names a
// price, so it can't invent a cheaper one.
//
// No service-role key: the caller's own client reads their own
// plb_entitlements row under RLS (entitlements_select_own) to reuse their
// Stripe customer across plan changes.
//
// Secrets (server-side only):
//   STRIPE_SECRET_KEY   sk_live_… / sk_test_…
//   STRIPE_PRICE_IDS    JSON: {"pro:month":"price_…","pro:year":"price_…",
//                              "professional:month":"price_…","professional:year":"price_…"}
//   STRIPE_TRIAL_DAYS   optional, default 14
//   APP_URL             optional, default https://pilotlogbook.ca
//
// Deploy: `supabase functions deploy create-checkout`   (JWT required)

import Stripe from "npm:stripe@17";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2025-02-24.acacia" });

// CORS "*" is safe here for the same reason as the other functions: this
// authorizes by the caller's bearer JWT, never by cookies or origin, so a
// cross-site page can't ride an ambient session.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TIERS = ["pro", "professional"];
const PERIODS = ["month", "year"];

function priceIds(): Record<string, string> {
  try { return JSON.parse(Deno.env.get("STRIPE_PRICE_IDS") ?? "{}"); }
  catch { return {}; }
}

// Where Stripe sends the payer afterwards. Taken from an allowlist, never
// straight from the request: success_url is attacker-influencable otherwise,
// which turns the checkout into an open redirect off our own domain.
function returnOrigin(req: Request): string {
  const appUrl = (Deno.env.get("APP_URL") ?? "https://pilotlogbook.ca").replace(/\/+$/, "");
  const origin = req.headers.get("origin");
  const allowed = [appUrl, "http://localhost:8090"];
  return origin && allowed.includes(origin) ? origin : appUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Please sign in again to continue." }, 401);

  let body: { tier?: unknown; period?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const tier = String(body.tier ?? "");
  const period = String(body.period ?? "");
  if (!TIERS.includes(tier) || !PERIODS.includes(period)) {
    return json({ error: "Unknown plan." }, 400);
  }

  const price = priceIds()[`${tier}:${period}`];
  if (!price) {
    console.error("no price configured for", `${tier}:${period}`, "— check STRIPE_PRICE_IDS");
    return json({ error: "That plan isn't available right now." }, 503);
  }

  // Reuse this account's Stripe customer if it already has one, so an upgrade
  // doesn't spawn a second customer with a duplicate payment method. RLS means
  // this read can only ever return the caller's own row.
  const { data: entRow } = await userClient
    .from("plb_entitlements")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const customerId = (entRow?.stripe_customer_id as string | null) ?? null;

  const trialDays = Number(Deno.env.get("STRIPE_TRIAL_DAYS") ?? "14");
  const origin = returnOrigin(req);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      ...(customerId ? { customer: customerId } : { customer_email: user.email ?? undefined }),
      subscription_data: {
        // THE binding. Server-derived from the caller's JWT and invisible to
        // the payer, unlike the client_reference_id this replaces.
        metadata: { user_id: user.id },
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      },
      // Kept only so the id is visible beside the session in the Stripe
      // dashboard. The webhook does NOT trust this field.
      client_reference_id: user.id,
      success_url: `${origin}/logger/?checkout=success`,
      cancel_url: `${origin}/pricing/?checkout=cancelled`,
    });
    if (!session.url) return json({ error: "Stripe did not return a checkout URL." }, 502);
    return json({ url: session.url }, 200);
  } catch (e) {
    console.error("checkout session create failed", e instanceof Error ? e.message : e);
    return json({ error: "Could not start checkout — please try again." }, 502);
  }
});
