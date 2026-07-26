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

// A user id is only ever accepted from `subscription.metadata.user_id`, which
// create-checkout writes from the caller's verified JWT. It is NEVER taken
// from `checkout.session.client_reference_id`: that rode on a Payment Link URL
// the payer could edit, so a checkout could be aimed at another account's id
// and — plb_entitlements being keyed by user_id — overwrite that account's
// customer/subscription binding, letting a stranger's later cancel revoke
// premium the victim was still paying Stripe for. Payment Links are retired;
// see BILLING.md.
//
// Shape-only validation (8-4-4-4-12 hex), not version/variant-pinned: any such
// string is a legal Postgres uuid, and pinning to v4 would reject a real
// account id if Supabase ever mints a different version. A non-uuid can't be
// an auth.users id — upserting it violates the FK, the handler 500s, and
// Stripe retries the doomed event for ~3 days.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asUserId(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null;
}

// price id → tier. STRIPE_PRICE_IDS ("pro:month" → price id) is the source of
// truth shared with create-checkout and is simply inverted here; the older
// STRIPE_PRICE_MAP (price id → tier) still works for deployments that haven't
// migrated. Setting both is fine — STRIPE_PRICE_IDS wins.
function priceMap(): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    const legacy = JSON.parse(Deno.env.get("STRIPE_PRICE_MAP") ?? "{}") as Record<string, string>;
    for (const [priceId, tier] of Object.entries(legacy)) map[priceId] = tier;
  } catch { /* malformed — fall through to STRIPE_PRICE_IDS */ }
  try {
    const ids = JSON.parse(Deno.env.get("STRIPE_PRICE_IDS") ?? "{}") as Record<string, string>;
    // "pro:month" → "price_…"  becomes  "price_…" → "pro"
    for (const [plan, priceId] of Object.entries(ids)) map[priceId] = plan.split(":")[0];
  } catch { /* malformed — keep whatever STRIPE_PRICE_MAP gave us */ }
  return map;
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

// Resolve the app user id for a subscription. Two authenticated sources only:
// the metadata create-checkout stamped from the buyer's JWT, or — for
// subscriptions that predate it — the Stripe customer id we already recorded
// against an account on a previous, verified event.
async function userIdForSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const metaUser = asUserId(sub.metadata?.user_id ?? sub.metadata?.supabase_user_id);
  if (metaUser) return metaUser;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customer) return null;
  const { data } = await admin.from("plb_entitlements").select("user_id").eq("stripe_customer_id", customer).maybeSingle();
  return data?.user_id ?? null;
}

async function applySubscription(sub: Stripe.Subscription) {
  const uid = await userIdForSubscription(sub);
  if (!uid) {
    // Reachable if a retired Payment Link is still live in Stripe: that
    // checkout carries no metadata and no known customer, so it cannot be
    // bound to an account. Loud and manual beats guessing from a field the
    // payer controls. Deactivate any remaining Payment Links (BILLING.md).
    console.error(
      "UNBOUND subscription", sub.id, "customer", typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
      "— no metadata.user_id and no known customer; grant this entitlement manually and check for a live Payment Link",
    );
    return;
  }
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
        if (session.subscription) {
          // Re-fetch the subscription rather than reading the session: the
          // binding lives in subscription.metadata.user_id, written by
          // create-checkout from the buyer's JWT. session.client_reference_id
          // is deliberately not consulted (see asUserId above).
          const sub = await stripe.subscriptions.retrieve(
            typeof session.subscription === "string" ? session.subscription : session.subscription.id,
          );
          await applySubscription(sub);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applySubscription(event.data.object as Stripe.Subscription);
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
