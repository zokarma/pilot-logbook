// Eval #27 — self-serve billing management (src/lib/billingPortal.ts).
//
// Until this existed there was NO self-serve cancel path at all: the pricing
// FAQ promised "Cancel anytime" and the app's "Manage subscription" button
// both had nowhere real to go — both linked to /pricing, which only has Buy
// buttons. A stated refund/cancellation policy is meaningless if cancelling
// actually requires emailing support. This suite guards the same security
// property as checkout.eval: the client never supplies a customer id, and the
// account is always derived server-side from the caller's JWT.

import { Suite } from "./harness";
import { readFileSync } from "node:fs";

type InvokeCall = { fn: string; body: unknown };

export async function run(): Promise<Suite> {
  const s = new Suite(27, "Billing portal (billingPortal.ts)", "The only self-serve cancel/change-plan path — if it's broken, 'cancel anytime' is a false promise.");

  const { billingPortalTarget } = await import(`../src/lib/billingPortal?cloud=${Date.now()}`);

  const calls: InvokeCall[] = [];
  let session: unknown = null;
  let invokeResult: { data: unknown; error: unknown } = { data: { url: "https://billing.stripe.com/p/session/test_123" }, error: null };
  const stub = {
    auth: { getSession: async () => ({ data: { session } }) },
    functions: {
      invoke: async (fn: string, opts: { body: unknown }) => { calls.push({ fn, body: opts.body }); return invokeResult; },
    },
  };

  {
    session = null;
    const signedOut = await billingPortalTarget(stub);
    s.check("signed out, the portal refuses rather than opening nothing", !!signedOut.error && !signedOut.url);
    s.check("...and no request is made at all", calls.length === 0);
  }

  {
    session = { user: { id: "11111111-2222-4333-8444-555555555555" } };
    calls.length = 0;
    const ok = await billingPortalTarget(stub);
    s.check("signed in, the portal returns the Stripe session URL",
      ok.url === "https://billing.stripe.com/p/session/test_123", JSON.stringify(ok));
    s.check("exactly one call, to create-portal-session", calls.length === 1 && calls[0].fn === "create-portal-session");
    // No customer id, no user id, no anything identifying — the function
    // derives the account from the JWT alone. A body carrying an id would
    // mean a payer could name a DIFFERENT account's billing portal.
    s.eq("the request carries no body at all", calls[0].body, {});
  }

  {
    session = { user: { id: "11111111-2222-4333-8444-555555555555" } };
    invokeResult = { data: null, error: new Error("boom") };
    const failed = await billingPortalTarget(stub);
    s.check("a function error becomes a shown error, not a silent no-op", !!failed.error && !failed.url);

    invokeResult = { data: {}, error: null };
    const noUrl = await billingPortalTarget(stub);
    s.check("a response with no URL is an error, never a silent no-op", !!noUrl.error && !noUrl.url);
    invokeResult = { data: { url: "https://billing.stripe.com/p/session/test_123" }, error: null };
  }

  /* -------- structural: no client-supplied identity, ever -------- */
  {
    const src = readFileSync(new URL("../src/lib/billingPortal.ts", import.meta.url), "utf8");
    const code = src.replace(/^\s*\/\/.*$/gm, "");
    s.check("the client never sends a customer or user id to the function",
      !/customer_?id|customerId|user_?id/i.test(code));
    s.check("billing management goes through the create-portal-session edge function",
      /invoke\(\s*["']create-portal-session["']/.test(code));
  }

  {
    const fn = readFileSync(new URL("../supabase/functions/create-portal-session/index.ts", import.meta.url), "utf8");
    s.check("create-portal-session requires an Authorization header", /Missing Authorization header/.test(fn));
    s.check("the customer id is looked up server-side from the caller's own JWT, never from the request body",
      /auth\.getUser\(\)/.test(fn) && !/body\.customer/.test(fn) && !/req\.json\(\)/.test(fn));
    s.check("it reads plb_subscriptions (RLS-scoped to the caller) for the Stripe customer id",
      /plb_subscriptions/.test(fn) && /\.eq\("user_id",\s*user\.id\)/.test(fn));
    s.check("an account with no Stripe customer gets a clear error, not a crash or someone else's portal",
      /No subscription found/.test(fn));
    s.check("the return URL is validated against an allowlist, not trusted from the request",
      /returnOrigin/.test(fn) && /allowed\.includes\(origin\)/.test(fn));
  }

  /* -------- the UI actually offers this, and only where it's legal -------- */
  {
    const settings = readFileSync(new URL("../src/components/SettingsModal.tsx", import.meta.url), "utf8");
    s.check("Settings calls openBillingPortal for a premium web pilot",
      /openBillingPortal/.test(settings));
    s.check("the portal is only offered when canPurchase (web) — never inside the native app",
      /canPurchase/.test(settings) && /isPremium/.test(settings));
    s.check("the in-app fallback states where billing is managed, without a link to it",
      /managed wherever you signed up/i.test(settings));
  }

  /* -------- both directions require an account, not just a session check -------- */
  // Checkout and cancel/manage are asked for as symmetric: neither should be
  // reachable by a signed-out visitor. checkoutTarget's login redirect is
  // pinned in checkout.eval; here, pin that the ONLY door to the portal
  // button — the Settings modal — is itself gated by the authed app shell,
  // so there is no route where "Manage subscription" renders without a
  // session. billingPortalTarget's own session check (above) is defense in
  // depth, not the only gate.
  {
    const layout = readFileSync(new URL("../src/app/(app)/layout.tsx", import.meta.url), "utf8");
    s.check("the authenticated shell (which hosts Settings/TopBar) redirects signed-out visitors to /login",
      /router\.replace\(["']\/login["']\)/.test(layout));
    s.check("...and renders nothing further for a signed-out visitor rather than flashing the shell first",
      /if\s*\(!currentUser\)\s*return null/.test(layout));

    const topBar = readFileSync(new URL("../src/components/TopBar.tsx", import.meta.url), "utf8");
    s.check("SettingsModal — the only place Manage/Cancel appears — is opened from TopBar, which lives inside that gated shell",
      /SettingsModal/.test(topBar));
  }

  s.probe(
    "end-to-end portal session creation is not covered here",
    "opening a real Billing Portal session needs Stripe credentials and a live Supabase session, so the round trip is verified manually in Stripe test mode. This suite pins the request shape and the server-side identity derivation — the parts a refactor could quietly regress. The portal ALSO requires one manual step in the Stripe Dashboard (Settings → Billing → Customer portal → Activate) before it will accept a session; see BILLING.md.",
  );

  return s;
}
