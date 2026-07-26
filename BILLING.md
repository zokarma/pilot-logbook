# Billing & Subscriptions

**Status: web backend built (Stripe) and enforcement ON.** The following
surfaces are now gated to the tier shown; everything else stays free. What
exists now, and the operator steps to run it, are at the top; the original
plan (incl. RevenueCat / native IAP for later) follows.

| Surface | Feature | Min tier |
|---|---|---|
| AI logbook scanning (logger) | `aiScan` | Pro |
| Document OCR scanning (documents) | `docOcr` | Pro |
| Professional PDF export (logger) | `proPdf` | Pro |
| Custom currency rules (currency) | `advancedCurrency` | Pro |
| Duty & rest analysis (whole page) | `dutyRest` | Professional |

A gradient **Upgrade** link appears in the sidebar for non-premium users
(`useEntitlement().isPremium`). Multi-device, native apps, backup, unlimited
reminders/scan quotas, roster import and company reports are **not** gated as
single toggles — they're architectural or quota concepts to wire in later.

**Client gates are UI only — they are not security.** Anyone can edit
localStorage or the JS bundle, so a client check can never protect something
that costs money. The one paid *server* resource is the `scan-extract` Edge
Function (it spends `ANTHROPIC_API_KEY`), so that function **re-checks the
tier server-side** and returns `402 upgrade_required` for free accounts. Its
`grantsPremium()` is a deliberate small mirror of `effectiveTier()` in
`src/lib/entitlement.ts` (Edge Functions can't import from `src/`) — **change
both together**. Any future paid endpoint must do the same.

> Not yet implemented: **per-user scan quotas / rate limiting**. `scan-extract`
> now refuses non-premium callers, but a premium account can still call it
> without limit (4 images per request, unbounded requests). Metering needs a
> counter table; see "known gaps" below.

## What's implemented

- **`plb_entitlements` table** (`supabase/schema.sql`) — server-authoritative
  premium state, **read-your-own only, no client write policy**. Only the
  webhook (service-role) writes it.
- **`supabase/functions/create-checkout`** — creates the Stripe Checkout
  Session. Requires the caller's JWT, derives their user id from it, resolves
  the plan → price id **server-side** (`STRIPE_PRICE_IDS`), and writes the id
  into `subscription_data.metadata.user_id`. That metadata is the binding
  between a payment and an account, and the payer cannot touch it.
- **`supabase/functions/stripe-webhook`** — verifies the Stripe signature, maps
  the subscription's price → tier, and upserts the row. It resolves the account
  **only** from `subscription.metadata.user_id` or from a `stripe_customer_id`
  already recorded against an account; `client_reference_id` is ignored.
- **`src/lib/entitlement.ts`** (pure, eval-covered) — `effectiveTier` (with a
  `GRACE_DAYS` window so a paying pilot is never locked out offline / on a
  retriable payment), `hasFeature`, and `entitlementFromRow` (a malformed row
  can never read as premium).
- **`src/hooks/useEntitlement.ts`** — offline-first read of the row (cached in
  localStorage), interpreted by the pure helpers.
- **`src/components/PremiumGate.tsx`** — `<PremiumGate feature="…">` wrapper;
  enforcement is opt-in per feature.
- **`src/lib/checkout.ts`** + the `/pricing` plan buttons — invoke
  `create-checkout` with **only** the plan (`{tier, period}`) and redirect to
  the session URL it returns. Signed-out visitors go to `/login` first; a
  failure shows a message under the plan button instead of doing nothing.

> **Why not Payment Links (the previous flow).** A Payment Link carried the
> account id in `?client_reference_id=<user id>` — a query param on a URL the
> payer edits. Since `plb_entitlements` is keyed by `user_id`, a checkout aimed
> at *someone else's* id overwrote that account's `stripe_customer_id` /
> `stripe_subscription_id`, so a later cancel on the stranger's subscription
> revoked premium the victim was still being billed for by Stripe (and the
> victim's own renewal events stopped resolving). No webhook-side guard fixes
> this: a Payment Link upgrade also creates a brand-new subscription, so
> "legitimate upgrade" and "hijack" look identical at the row level. Deriving
> the id from the caller's JWT removes the choice entirely. **Do not
> reintroduce a client-supplied user id or price** — `evals/checkout.eval.ts`
> asserts both.

## Rollout status

- **Test mode (Sandbox): DONE and verified end-to-end** — a trial checkout
  wrote the `plb_entitlements` row (`tier: pro`, `status: trialing`) via the
  webhook; enforcement + the Upgrade link are QA'd on both a Pro and a free
  account and are **live on `www.pilotlogbook.ca`** (pointing at test-mode
  Stripe links).
- **Live mode: PENDING** — waiting on business incorporation before switching
  Stripe to live. See "Going live" below.

## Operator setup (the tested procedure)

Currency is **CAD**: Pro $10/mo · $100/yr, Professional $15/mo · $150/yr
(annual = 2 months free). Prices/currency are per-price in Stripe.

1. **DB:** run `supabase/schema.sql` — it is now **idempotent and safe to
   re-run** (adds `plb_entitlements`; the old destructive `plb_app_state` drop
   was removed). Verify RLS is on with the single `entitlements_select_own`
   SELECT policy (no insert/update/delete).
2. **Stripe:** create the Pro & Professional products + monthly/yearly prices.
   Note the four **price ids** — that's all you need.
   - **No Payment Links.** Checkout Sessions are created by
     `create-checkout`, and the 14-day trial now comes from
     `STRIPE_TRIAL_DAYS` (code, not a dashboard setting).
   - **Deactivate any existing Payment Links** (Stripe → Payment Links →
     Archive). A link left live still takes money, but its checkout carries no
     `metadata.user_id`, so the webhook can't bind it to an account: it logs
     `UNBOUND subscription …` and the entitlement needs granting by hand.
3. **Functions** (Supabase CLI, from the repo root; project ref
   `gnfdhxzvivrmltrkdugy`):
   ```
   supabase functions deploy stripe-webhook --no-verify-jwt
   supabase functions deploy create-checkout
   ```
   `create-checkout` keeps JWT verification **on** — that's what makes the
   buyer's identity trustworthy.
   Register the function URL
   (`https://<ref>.supabase.co/functions/v1/stripe-webhook`) as a Stripe
   webhook endpoint subscribing to `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`; copy its
   signing secret. Then set the three secrets:
   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_…
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
   ```
   `STRIPE_PRICE_IDS` (JSON) maps **plan → price id** and is the single source
   of truth for both functions: `create-checkout` reads it forward to pick a
   price, and `stripe-webhook` inverts it for price → tier. PowerShell mangles
   inline quotes, so write a temp `.env.stripe` (gitignored via `.env.*`), load
   it, then delete it:
   ```powershell
   'STRIPE_PRICE_IDS={"pro:month":"price_proM","pro:year":"price_proY","professional:month":"price_profM","professional:year":"price_profY"}' | Out-File -Encoding ascii .env.stripe
   supabase secrets set --env-file .env.stripe
   Remove-Item .env.stripe
   ```
   Optional: `STRIPE_TRIAL_DAYS` (default `14`, set `0` for no trial) and
   `APP_URL` (default `https://pilotlogbook.ca`) — the latter is the allowlist
   for Stripe's `success_url`/`cancel_url`, so a checkout can never redirect
   off your own domain. The legacy `STRIPE_PRICE_MAP` (price id → tier) is
   still honoured by the webhook if present, so an existing deployment keeps
   working; `STRIPE_PRICE_IDS` wins where both are set, and you can drop
   `STRIPE_PRICE_MAP` once it is.

   The project holds one secret set, so `STRIPE_SECRET_KEY`/`WEBHOOK_SECRET`
   are either both test or both live — switching to live retires the test flow
   (test-mode signatures stop matching, by design). `SUPABASE_URL` /
   `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.
4. **App env** (Vercel): nothing Stripe-specific any more. The old
   `NEXT_PUBLIC_STRIPE_LINK_*` vars are unused and can be deleted — the plan
   buttons only need `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY`, and fall back to
   `/login` without them. Prices and the trial now live in the function's
   secrets, so changing a price no longer requires a frontend redeploy.
5. **Enforcement is ON** (see the table at the top). Gated surfaces show a
   PRO/lock affordance that routes to `/pricing`; add more gates with
   `<PremiumGate feature="…">` or `useEntitlement().has(...)`.

## Going live (when incorporated)

Live and Test are fully separate in Stripe. Repeat setup in **live mode**:
recreate the 2 products + 4 prices (CAD) and a **live webhook endpoint** on the
same function URL. Then re-set the Supabase secrets with **live** values
(`sk_live_…`, the live `whsec_…`, and `STRIPE_PRICE_IDS` with the **live**
price ids). No Vercel change and no frontend redeploy is needed — prices live
in the function's secrets now, not in `NEXT_PUBLIC_` vars. Smoke-test with a
real card — the trial means $0 due today, so verify the `plb_entitlements` row
then cancel before day 14.

Full operator SQL/verify screenshots-era procedure was run for the sandbox on
2026-07; see the top-of-file status.

## Known gaps

- **No scan quota / rate limit.** `scan-extract` is premium-only but unmetered,
  so a subscriber (or a stolen session) can call it as often as they like. The
  `/pricing` copy promises "Limited / month" on Pro vs "Unlimited" on
  Professional — that distinction is **not enforced anywhere yet**. Needs a
  usage-counter table written by the function (service role) + a monthly cap.
- **"Scan your first 10 pages free" is not implemented.** The landing/FAQ copy
  offers free users a 10-page trial, but enforcement gives free accounts *zero*
  scans (client hides it, server returns 402). Either build the free quota or
  drop the claim from the copy — right now the page overpromises.
- ~~**Bad `client_reference_id` retries forever.**~~ ~~**A payer can pass
  someone else's user id.**~~ **Both fixed** by moving from Payment Links to
  server-created Checkout Sessions (`create-checkout`). The account id now
  comes from the buyer's verified JWT and rides in
  `subscription_data.metadata.user_id`; `stripe-webhook` reads only that (plus
  a `stripe_customer_id` it already recorded) and validates the UUID shape
  before the FK write. A payer can no longer name another account at all, so
  neither the "surprise premium" case nor the sharper one — overwriting a
  paying user's Stripe binding so a stranger's cancel revokes premium they're
  still billed for — is reachable. See "Why not Payment Links" above.

## App Store note

iOS may **honor** a web-purchased subscription but may not **sell** premium
in-app without Apple IAP — keep the iOS app login-only for premium (the
"Spotify method"). Add RevenueCat/native IAP later per the plan below.

---

## Original plan (for the native / multi-store phase)

This was the blueprint; the web slice above implements its Stripe path.

## Core model: the account is the source of truth

Premium status lives on the **Supabase account**, not on Apple/Google/Stripe. Those
stores are just payment collectors that report an entitlement back to the account.
One account → premium follows the user across web, iOS, and Android.

## 1. Data model (Supabase)

Add to the user's profile row:

```
is_premium         boolean     default false
premium_source     text        -- 'apple' | 'google' | 'stripe'
premium_expires_at timestamptz
```

RLS: the user may **read** their own row; only the **service role** (webhook backend)
may **write** these fields. Clients never set premium themselves.

## 2. RevenueCat in the middle

RevenueCat is the entitlement broker across all three stores — don't hand-roll receipt
validation and webhook plumbing.

- Create a project → add stores: App Store, Play Store, Stripe (Web Billing).
- Define one entitlement: `premium`.
- Define subscription products in each store, map each to `premium`.
- **Set RevenueCat App User ID = the Supabase user id.** This is what links a purchase
  to the account. Critical.

## 3. Per-platform wiring

- **iOS (Capacitor):** `@revenuecat/purchases-capacitor`. On login: `Purchases.logIn(supabaseUserId)`.
  Paywall: `Purchases.purchase(pkg)`.
- **Android:** same plugin, same `logIn`.
- **Web:** RevenueCat Web Billing (or Stripe Checkout) with the same App User ID.

## 4. Sync back to Supabase (the one new server piece)

The app is a static export, so this is the only server-side component to add:

- A webhook endpoint — Supabase Edge Function (we already use one for delete-account)
  or a Vercel serverless route.
- Point RevenueCat's webhook at it. On `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`,
  `EXPIRATION` → write `is_premium` / `premium_source` / `premium_expires_at` to that
  user's row with the service-role key.
- RevenueCat already validated the receipt, so the event is trusted.

## 5. Clients just read

Every platform gates features on `is_premium` from the account. Same account → same
answer everywhere.

## Two rules that keep it correct

1. **Require login before the paywall** — no anonymous purchases, or a purchase can't be
   mapped to an account.
2. **Never trust the client for entitlement** — only the webhook + service-role write
   flips `is_premium`.

## Offline behaviour — the check does NOT break offline

This app is offline-first (Supabase mirrored to localStorage). The subscription check is
safe offline **because `is_premium` is just a field on the account data that's already
mirrored locally.** Rules:

- **Read the cached entitlement, not a live network call.** `is_premium` rides along with
  the AppData that `DataContext` already loads and mirrors. Offline, read the last-known
  value from the local mirror — no network needed.
- **Never hard-lock on a failed network request.** The anti-pattern is "call the server on
  every launch and lock features if it fails." That would break offline. Instead: serve the
  cached value immediately, refresh in the background when online.
- **RevenueCat caches for you.** Its SDK persists `CustomerInfo` on device and returns the
  entitlement even offline, re-syncing on reconnect. A subscriber who goes offline keeps
  premium automatically.
- **Expiry offline:** compare `premium_expires_at` to the device clock, ideally with a grace
  window (keep premium working a few days past last successful sync) so a flaky connection
  never locks out a paying user mid-flight.

Net: caching the entitlement with the account data fits the existing localStorage-mirror
architecture — premium works offline the same way flights do.

## App Store compliance recap (why the model is shaped this way)

- **iOS:** selling a digital subscription *inside* the app requires Apple IAP (15% under the
  Small Business Program). Alternatively, the "Spotify method" — sell only on the web, keep
  the app login-only — is allowed; you just can't steer users to the web from inside the iOS
  app (outside the US/EU carve-outs). Honoring a web-purchased subscription in the app is
  always fine.
- **Android:** Play Billing in-store (15%), OR distribute the APK from our own site with
  Stripe (Android allows sideloading — iOS does not).
- **Web:** no store, no fees — Stripe directly.

Recommended start: **Stripe-on-web as the billing backbone + login-only apps**, add native
IAP later only if conversion needs it. Pilots are a high-intent niche who will subscribe on
the website.
