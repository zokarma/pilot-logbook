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

/* ------------- many subscriptions → one derived entitlement ---------------- */
//
// plb_subscriptions holds one row per Stripe subscription; plb_entitlements is
// recomputed from them as the best current grant. A user can legitimately hold
// two at once (an upgrade creates the new one before the old is cancelled), and
// keying entitlement by user alone made that a race where the last writer won —
// so a cancel on one subscription could revoke access another was still paying
// for. Now a subscription can only ever ADD access.
//
// GRACE_MS and the two helpers below mirror GRACE_DAYS / effectiveTier /
// pickEffectiveSubscription in src/lib/entitlement.ts (Edge Functions can't
// import from src/). CHANGE THEM TOGETHER — entitlement.ts is the eval-covered
// copy and the spec.
const GRACE_MS = 3 * 86400000;
const RANK: Record<string, number> = { free: 0, pro: 1, professional: 2 };

interface SubRow {
  stripe_subscription_id: string;
  tier: string;
  status: string;
  stripe_customer_id: string | null;
  current_period_end: string | null;
}

// The tier a single subscription grants right now (free once lapsed).
function effectiveTierOf(s: { tier: string; status: string; current_period_end: string | null }): string {
  if (s.tier !== "pro" && s.tier !== "professional") return "free";
  const end = s.current_period_end ? Date.parse(s.current_period_end) : NaN;
  const within = isNaN(end) ? null : Date.now() <= end + GRACE_MS;
  if (s.status === "active" || s.status === "trialing" || s.status === "past_due") {
    return within === false ? "free" : s.tier;
  }
  if (s.status === "canceled") return within === true ? s.tier : "free";
  return "free";
}

// Recompute the user's single entitlement row from all of their subscriptions:
// highest granting tier wins, ties broken on the furthest-out paid period.
//
// This is a snapshot taken at event time. If the winning subscription later
// lapses while a lower-tier one is still live, the published row goes stale
// until the next event re-derives it — Stripe emits one on every status change
// (including the period-end delete), and the whole entitlement system already
// depends on those arriving, so the window is event latency rather than a new
// failure mode. Closing it entirely would mean the client deriving from
// plb_subscriptions itself; see BILLING.md "known gaps".
async function recomputeEntitlement(uid: string) {
  const { data, error } = await admin
    .from("plb_subscriptions")
    .select("stripe_subscription_id, tier, status, stripe_customer_id, current_period_end")
    .eq("user_id", uid);
  if (error) throw new Error(`subscription read failed: ${error.message}`);

  const subs = (data ?? []) as SubRow[];
  const endOf = (s: SubRow) => {
    const t = s.current_period_end ? Date.parse(s.current_period_end) : NaN;
    return isNaN(t) ? Infinity : t;
  };
  let best: SubRow | null = null;
  let bestRank = -1;
  for (const s of subs) {
    const rank = RANK[effectiveTierOf(s)] ?? 0;
    if (rank > bestRank || (rank === bestRank && best !== null && endOf(s) > endOf(best))) {
      best = s;
      bestRank = rank;
    }
  }

  const row = best
    ? {
        user_id: uid,
        tier: best.tier,
        status: best.status,
        stripe_customer_id: best.stripe_customer_id,
        stripe_subscription_id: best.stripe_subscription_id,
        current_period_end: best.current_period_end,
      }
    : { user_id: uid, tier: "free", status: "inactive", stripe_customer_id: null, stripe_subscription_id: null, current_period_end: null };

  const { error: upErr } = await admin.from("plb_entitlements").upsert(
    { ...row, source: "stripe", updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (upErr) throw new Error(`entitlement upsert failed: ${upErr.message}`);
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
  const bySub = await admin.from("plb_subscriptions").select("user_id").eq("stripe_customer_id", customer).limit(1).maybeSingle();
  if (bySub.data?.user_id) return bySub.data.user_id;
  // Pre-split rows that the schema backfill hasn't covered (e.g. schema.sql not
  // re-run yet). Harmless once it has.
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

  // Record THIS subscription. Keyed by subscription id, so it never disturbs
  // any other subscription the user holds.
  const { error } = await admin.from("plb_subscriptions").upsert(
    {
      stripe_subscription_id: sub.id,
      user_id: uid,
      // Keep the tier even on cancel; the paid-through instant below (+grace)
      // is what ends access (src/lib/entitlement.ts).
      tier,
      status: sub.status,
      source: "stripe",
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
      current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
  if (error) throw new Error(`subscription upsert failed: ${error.message}`);

  // Then re-derive the one row the app reads.
  await recomputeEntitlement(uid);
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
