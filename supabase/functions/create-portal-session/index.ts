// Supabase Edge Function: create-portal-session
//
// Opens the Stripe Billing Portal for the CALLING user — the only place a
// pilot can self-serve cancel, change plan, update a card, or see invoices.
//
// Until this existed there was NO self-serve cancel path at all: the site's
// "Cancel anytime" promise (pricing FAQ) and the app's "Manage subscription"
// button both had nowhere real to go. A stated "no refunds, cancel anytime"
// policy is meaningless if cancelling requires emailing support.
//
// Same auth pattern as create-checkout: the user id comes from the caller's
// own verified JWT, never from the request body, so nobody can open another
// account's billing portal by editing a request.
//
// Secrets (server-side only):
//   STRIPE_SECRET_KEY   sk_live_… / sk_test_…
//   APP_URL             optional, default https://pilotlogbook.ca
//
// Also requires the Stripe Dashboard's Billing → Customer portal to be
// activated once (Settings → Billing → Customer portal → Activate). That
// screen is also where cancellation behaviour (immediate vs end-of-period)
// and whether plan switching is allowed are configured — see BILLING.md.
//
// Deploy: `supabase functions deploy create-portal-session`   (JWT required)

import Stripe from "npm:stripe@17";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2025-02-24.acacia" });

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

  // Same lookup order as create-checkout: prefer plb_subscriptions (one row
  // per subscription, most recent first) over the derived plb_entitlements
  // row, whose customer id tracks whichever subscription currently wins.
  const { data: subRows } = await userClient
    .from("plb_subscriptions")
    .select("stripe_customer_id, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1);
  let customerId = (subRows?.[0]?.stripe_customer_id as string | null) ?? null;
  if (!customerId) {
    const { data: entRow } = await userClient
      .from("plb_entitlements")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();
    customerId = (entRow?.stripe_customer_id as string | null) ?? null;
  }

  if (!customerId) {
    // Nothing to manage — this account has never checked out.
    return json({ error: "No subscription found on this account." }, 404);
  }

  const origin = returnOrigin(req);
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/logger/`,
    });
    return json({ url: session.url }, 200);
  } catch (e) {
    console.error("portal session create failed", e instanceof Error ? e.message : e);
    return json({ error: "Could not open the billing portal — please try again." }, 502);
  }
});
