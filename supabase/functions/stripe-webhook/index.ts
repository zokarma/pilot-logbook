// Supabase Edge Function: stripe-webhook
//
// The one server-side piece of billing. Stripe validated the payment; this
// receives the signed webhook, maps the subscription to a tier, and writes the
// user's entitlement to plb_entitlements with the SERVICE-ROLE key (the only
// writer of that table — clients can only read their own row). See
// src/lib/entitlement.ts for how the client interprets the row.
//
// Secrets (server-side only, never in the app bundle):
//   STRIPE_SECRET_KEY          sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET      whsec_…  (from the webhook endpoint in Stripe)
//   STRIPE_PRICE_MAP           JSON: {"price_abc":"pro","price_xyz":"professional"}
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (injected by Supabase)
//
// Deploy (JWT verification OFF — Stripe can't send a Supabase JWT; we verify
// the Stripe signature instead):
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   supabase secrets set STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… STRIPE_PRICE_MAP='{"price_…":"pro"}'
// Then add the function URL as a webhook endpoint in the Stripe dashboard,
// subscribing to: checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted.

import Stripe from "npm:stripe@17";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2025-02-24.acacia" });
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// `client_reference_id` rides on a Payment Link URL, so it is caller-editable
// text, not a trusted value. Anything that isn't a UUID can't be an
// auth.users id: upserting it violates the FK, the handler 500s, and Stripe
// then retries the same doomed event for ~3 days. Screen it here and drop the
// event cleanly instead.
// Deliberately shape-only (8-4-4-4-12 hex), not version/variant-pinned: any
// such string is a legal Postgres uuid, and pinning to v4 would reject a real
// account id if Supabase ever mints a different version.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asUserId(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null;
}

function priceMap(): Record<string, string> {
  try { return JSON.parse(Deno.env.get("STRIPE_PRICE_MAP") ?? "{}"); }
  catch { return {}; }
}
function tierForPrice(priceId: string | undefined): "free" | "pro" | "professional" {
  const t = priceId ? priceMap()[priceId] : undefined;
  return t === "pro" || t === "professional" ? t : "free";
}

// Write (or clear) a user's entitlement. Service-role bypasses RLS.
async function upsertEntitlement(row: {
  user_id: string; tier: string; status: string;
  stripe_customer_id?: string | null; stripe_subscription_id?: string | null;
  current_period_end?: string | null;
}) {
  const { error } = await admin.from("plb_entitlements").upsert(
    { ...row, source: "stripe", updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`entitlement upsert failed: ${error.message}`);
}

// Resolve the app user id for a subscription: prefer explicit metadata / the
// checkout's client_reference_id; else look up by the Stripe customer id we
// stored on the first purchase.
async function userIdForSubscription(sub: Stripe.Subscription, fallback?: string | null): Promise<string | null> {
  const metaUser = asUserId(sub.metadata?.user_id ?? sub.metadata?.supabase_user_id);
  if (metaUser) return metaUser;
  const fromCheckout = asUserId(fallback);
  if (fromCheckout) return fromCheckout;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customer) return null;
  const { data } = await admin.from("plb_entitlements").select("user_id").eq("stripe_customer_id", customer).maybeSingle();
  return data?.user_id ?? null;
}

async function applySubscription(sub: Stripe.Subscription, userId: string | null) {
  const uid = await userIdForSubscription(sub, userId);
  if (!uid) { console.error("no user for subscription", sub.id); return; }
  const priceId = sub.items.data[0]?.price?.id;
  const tier = tierForPrice(priceId);
  await upsertEntitlement({
    user_id: uid,
    // Keep the tier even on cancel; the client honors current_period_end (+grace)
    // then falls back to free on its own (src/lib/entitlement.ts).
    tier,
    status: sub.status,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    stripe_subscription_id: sub.id,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!sig || !secret) return new Response("Missing signature/secret", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    // Async because Edge runtimes use WebCrypto for the HMAC check.
    event = await stripe.webhooks.constructEventAsync(body, sig, secret);
  } catch (e) {
    console.error("signature verification failed", e instanceof Error ? e.message : e);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // We required login before checkout, so the app user id rides on
        // client_reference_id (see src/lib/checkout.ts). Validated, not
        // trusted — it comes off a URL the payer can edit.
        const userId = asUserId(session.client_reference_id);
        if (session.client_reference_id && !userId) {
          console.error("ignoring malformed client_reference_id on", session.id);
        }
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            typeof session.subscription === "string" ? session.subscription : session.subscription.id,
          );
          await applySubscription(sub, userId);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applySubscription(event.data.object as Stripe.Subscription, null);
        break;
      }
      default:
        break; // ignore everything else
    }
  } catch (e) {
    console.error("handler error", e instanceof Error ? e.message : e);
    return new Response("Handler error", { status: 500 }); // Stripe will retry
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
