// Eval #19 — subscription checkout (src/lib/checkout.ts).
// The revenue path. A plan button asks the `create-checkout` Edge Function for
// a Stripe Checkout Session and redirects to it; the function derives the
// buyer's user id from their JWT and stamps it into the subscription metadata,
// which is the ONLY thing that lets stripe-webhook map a purchase to an
// account.
//
// This suite guards the security property that motivated the design: the
// client must never put a user id (or a price) into the checkout request. The
// previous Payment Link flow appended `?client_reference_id=<user id>` to a URL
// the payer could edit, so a checkout could be aimed at someone else's account
// and overwrite their entitlement row's Stripe binding.

import { Suite } from "./harness";
import { readFileSync } from "node:fs";

type InvokeCall = { fn: string; body: unknown };

export async function run(): Promise<Suite> {
  const s = new Suite(19, "Checkout session (checkout.ts)", "Revenue path — a mis-wired checkout takes money without granting the plan, and a client-supplied user id lets a payer hijack another account's entitlement.");

  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  /* ---------------- local-only / unconfigured build ---------------- */
  {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const mod = await import(`../src/lib/checkout?unconfigured=${Date.now()}`);

    s.check("checkout reports unconfigured without Supabase env", mod.checkoutConfigured() === false);
    const t = await mod.checkoutTarget("pro", "month");
    s.eq("an unconfigured build routes to login, never to a bare payment URL", t, { redirect: "/login?next=/pricing" });
    s.check("...and issues no checkout URL at all", t.url === undefined);
  }

  /* ---------------- cloud build, with an injected client ---------------- */
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_test";
  const { checkoutTarget } = await import(`../src/lib/checkout?cloud=${Date.now()}`);

  // Stub client: lets us drive the signed-in branch (previously reachable only
  // in a real browser) and inspect exactly what gets sent to the function.
  const calls: InvokeCall[] = [];
  let session: unknown = null;
  let invokeResult: { data: unknown; error: unknown } = { data: { url: "https://checkout.stripe.com/c/pay/cs_test_123" }, error: null };
  const stub = {
    auth: { getSession: async () => ({ data: { session } }) },
    functions: {
      invoke: async (fn: string, opts: { body: unknown }) => { calls.push({ fn, body: opts.body }); return invokeResult; },
    },
  };

  {
    session = null;
    const signedOut = await checkoutTarget("pro", "month", stub);
    s.eq("signed out, a plan button routes to login", signedOut, { redirect: "/login?next=/pricing" });
    s.check("...and no checkout request is made at all", calls.length === 0);
  }

  {
    session = { user: { id: "11111111-2222-4333-8444-555555555555" } };
    calls.length = 0;
    const ok = await checkoutTarget("professional", "year", stub);
    s.check("signed in, checkout returns the Stripe session URL",
      ok.url === "https://checkout.stripe.com/c/pay/cs_test_123", JSON.stringify(ok));
    s.check("exactly one call, to create-checkout", calls.length === 1 && calls[0].fn === "create-checkout");
    // The core invariant: the payload names a PLAN and nothing else. No user
    // id (the server takes it from the JWT), no price id.
    s.eq("the request body carries only tier + period", calls[0].body, { tier: "professional", period: "year" });
    const sent = JSON.stringify(calls[0].body);
    s.check("the request contains no user id", !sent.includes("11111111-2222-4333-8444-555555555555"));
    s.check("the request contains no price id", !/price/i.test(sent));

    for (const [tier, period] of [["pro", "month"], ["pro", "year"], ["professional", "month"]] as const) {
      calls.length = 0;
      await checkoutTarget(tier, period, stub);
      s.eq(`plan ${tier}/${period} is passed through verbatim`, calls[0].body, { tier, period });
    }
  }

  {
    // A failing function must surface its message, not navigate or fail silent.
    session = { user: { id: "11111111-2222-4333-8444-555555555555" } };
    invokeResult = { data: null, error: new Error("boom") };
    const failed = await checkoutTarget("pro", "month", stub);
    s.check("a function error becomes a shown error, not a redirect",
      !!failed.error && !failed.url && !failed.redirect, JSON.stringify(failed));

    invokeResult = { data: {}, error: null };
    const noUrl = await checkoutTarget("pro", "month", stub);
    s.check("a response with no URL is an error, never a silent no-op", !!noUrl.error && !noUrl.url);
    invokeResult = { data: { url: "https://checkout.stripe.com/c/pay/cs_test_123" }, error: null };
  }

  /* -------- the security invariants, read off the source -------- */
  // These are the properties a regression would silently reintroduce, and they
  // are structural rather than behavioural, so assert them against the module
  // text: no client-supplied user id, no client-supplied price, no payment link.
  {
    const src = readFileSync(new URL("../src/lib/checkout.ts", import.meta.url), "utf8");
    const code = src.replace(/^\s*\/\/.*$/gm, ""); // strip comments (they discuss the old flow)

    s.check("the client never sends a user id in the checkout request",
      !/client_reference_id/.test(code), "client_reference_id must not reappear in checkout.ts");
    s.check("the client never names a Stripe price (the server maps plan → price)",
      !/price_|priceId|STRIPE_PRICE/.test(code));
    s.check("no NEXT_PUBLIC_STRIPE_LINK_* payment links remain",
      !/NEXT_PUBLIC_STRIPE_LINK/.test(code));
    s.check("checkout goes through the create-checkout edge function",
      /invoke\(\s*["']create-checkout["']/.test(code));
    s.check("the request body carries only the plan (tier + period)",
      /body:\s*\{\s*tier,\s*period\s*\}/.test(code));
  }

  {
    const fn = readFileSync(new URL("../supabase/functions/create-checkout/index.ts", import.meta.url), "utf8");
    s.check("create-checkout requires an Authorization header", /Missing Authorization header/.test(fn));
    s.check("create-checkout derives the user from the JWT, not the body",
      /auth\.getUser\(\)/.test(fn) && /metadata:\s*\{\s*user_id:\s*user\.id\s*\}/.test(fn));
    s.check("create-checkout resolves the price server-side from env",
      /STRIPE_PRICE_IDS/.test(fn) && !/body\.price/.test(fn));
    s.check("create-checkout validates the requested plan against a fixed set",
      /TIERS\.includes\(tier\)/.test(fn) && /PERIODS\.includes\(period\)/.test(fn));
    s.check("create-checkout does not take its return URL from the request",
      /allowed\.includes\(origin\)/.test(fn));
  }

  {
    const hook = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");
    const code = hook.replace(/^\s*\/\/.*$/gm, "");
    s.check("the webhook no longer reads client_reference_id",
      !/session\.client_reference_id/.test(code),
      "trusting client_reference_id lets a payer bind a purchase to another account");
    s.check("the webhook binds via subscription metadata", /sub\.metadata\?\.user_id/.test(code));
    s.check("the webhook validates the id shape before the FK write", /asUserId\(/.test(code));
  }

  s.probe(
    "end-to-end checkout is not covered here",
    "creating a real Checkout Session needs Stripe credentials and a live Supabase session, so the network round trip is verified manually in Stripe test mode per BILLING.md. What this suite pins is the shape of the request the client makes and the source of the user id on both sides — the parts a refactor could quietly regress.",
  );
  s.probe(
    "legacy Payment Link subscriptions",
    "subscriptions created before this change carry no metadata.user_id; the webhook still resolves them by the stripe_customer_id already stored on their entitlement row, so existing subscribers keep renewing. A NEW purchase through a Payment Link left live in Stripe would resolve to nobody and log UNBOUND — deactivate the links (BILLING.md step 2).",
  );

  if (priorUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
  else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (priorKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey;
  else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return s;
}
