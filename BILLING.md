# Billing & Subscriptions

**Status: web backend built (Stripe) and enforcement ON. iOS is compliant
web-only (no in-app purchase path, no steering) — see "App Store note" for
the reviewed decision to defer native IAP.** The following surfaces are now
gated to the tier shown; everything else stays free. What exists now, and the
operator steps to run it, are at the top; the original plan (incl.
RevenueCat / native IAP for later) follows.

| Surface | Feature | Min tier |
|---|---|---|
| AI logbook scanning (logger) | `aiScan` | Pro |
| Document OCR scanning (documents) | `docOcr` | Pro |
| Professional PDF export (logger) | `proPdf` | Pro |
| Custom currency rules (currency) | `advancedCurrency` | Pro |
| Duty & rest analysis (whole page) | `dutyRest` | Pro |

There is no Professional tier any more — it was withdrawn from every
customer-facing surface (`/pricing`, the landing page, structured data) because
its differentiators (roster import, company reports, advanced analytics,
priority support, unlimited scanning) were never built. `dutyRest` moved to
Pro. `"professional"` stays in the `Tier` union / `RANK` / webhook price map
purely so any subscription sold while it was listed keeps resolving — it has
no purchase path. See `claims.eval.ts` (#20), which fails the build if
Professional reappears in copy or a declared feature has no enforcement site.

A gradient **Upgrade** link appears in the sidebar for non-premium users
(`useEntitlement().isPremium`) **on the web only** — see "App Store note"
below for why it (and every other upgrade CTA) is hidden inside the iOS app.
Multi-device, native apps, backup, unlimited reminders/scan quotas are **not**
gated as single toggles — they're architectural or quota concepts to wire in
later.

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

- **`plb_subscriptions` table** (`supabase/schema.sql`) — one row per Stripe
  subscription, keyed by `stripe_subscription_id`. Same trust model as below:
  read-your-own, no client write policy.
- **`plb_entitlements` table** — server-authoritative premium state, the single
  row the client and `scan-extract` read. **Read-your-own only, no client write
  policy**; only the webhook (service-role) writes it. It is **derived** from
  `plb_subscriptions` — see "one row per subscription" below.
- **`supabase/functions/create-checkout`** — creates the Stripe Checkout
  Session. Requires the caller's JWT, derives their user id from it, resolves
  the plan → price id **server-side** (`STRIPE_PRICE_IDS`), and writes the id
  into `subscription_data.metadata.user_id`. That metadata is the binding
  between a payment and an account, and the payer cannot touch it.
- **`supabase/functions/stripe-webhook`** — verifies the Stripe signature, maps
  the subscription's price → tier, upserts that subscription's own row in
  `plb_subscriptions`, then **recomputes** the user's `plb_entitlements` row.
  It resolves the account **only** from `subscription.metadata.user_id` or from
  a `stripe_customer_id` already recorded against an account;
  `client_reference_id` is ignored.
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

### One row per subscription

`plb_entitlements` holds one row per **user**, so it can only ever represent
one subscription — which made it a slot any inbound event could claim.
Whichever subscription wrote last owned the account's billing identity, and a
cancel on *that* subscription revoked premium even if a different,
still-paying subscription of the user's existed.

That isn't only an attack shape. A user can legitimately hold two
subscriptions at once — an upgrade creates the new one before the old is
cancelled — and under the single-row model the second overwrote the first, so
the first's renewal events then resolved to nobody.

So subscriptions get their own table and `plb_entitlements` becomes derived:

- `plb_subscriptions` — one row per Stripe subscription. Each webhook event
  writes only that subscription's row, so it can never disturb another.
- `plb_entitlements` — recomputed after every event as the **best current
  grant** across the user's rows: highest granting tier wins, ties break on the
  furthest-out paid period. A subscription can therefore only ever *add*
  access; cancelling one removes its own row and cannot take away what another
  is still paying for.

The rule lives in `pickEffectiveSubscription` / `entitlementFromSubscriptions`
(`src/lib/entitlement.ts`, pure and eval-covered). The webhook keeps a small
mirror of it, exactly as `scan-extract` mirrors `effectiveTier` — Edge
Functions can't import from `src/`, so **change them together**.

Nothing downstream changed shape: `useEntitlement`, `entitlement.ts` and
`scan-extract` still read the same single `plb_entitlements` row. Re-running
`schema.sql` backfills existing subscribers from it (idempotent), so their
grant and their customer-id lookup survive.

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

1. **DB:** run `supabase/schema.sql` — it is **idempotent and safe to re-run**
   (adds `plb_entitlements` + `plb_subscriptions`; the old destructive
   `plb_app_state` drop was removed). Verify RLS is on for both, each with a
   single SELECT policy (`entitlements_select_own` / `subscriptions_select_own`)
   and no insert/update/delete.
   - Re-running is **required** when upgrading an existing deployment: the tail
     of the file backfills `plb_subscriptions` from the current
     `plb_entitlements` rows so existing subscribers keep their grant and stay
     resolvable by Stripe customer id. It's `on conflict do nothing`, so a
     later re-run never clobbers what the webhook has written since.
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
  still billed for — is reachable. See "Why not Payment Links" above. The
  entitlement row is also no longer a clobberable slot: it's derived from
  per-subscription rows (see "One row per subscription"), so even a stray
  subscription could only add access, never remove it.
- **The derived entitlement row is a snapshot, not a live view.** It's
  recomputed on each Stripe event, so if the winning subscription lapses while
  a lower-tier one is still live, the row under-grants until the next event
  re-derives it. Stripe emits an event on every status change (including the
  period-end delete) and the whole system already depends on those arriving, so
  in practice the window is event latency. To remove it, have `useEntitlement`
  read `plb_subscriptions` (already read-your-own under RLS) and apply
  `entitlementFromSubscriptions` client-side, keeping `plb_entitlements` for
  `scan-extract`'s server-side gate.
- **Plan changes create a second subscription rather than modifying the first.**
  Checkout Sessions still start a *new* subscription each time, so upgrading
  leaves the old one running until it's cancelled — the user is briefly billed
  for both. The derived entitlement handles this correctly (they get the higher
  tier), but nothing cancels the old subscription automatically. Adding the
  Stripe **Customer Portal** for plan changes would modify the existing
  subscription in place and settle it; until then an upgrade wants a manual
  cancel, or a `create-checkout` step that cancels the caller's other active
  subscriptions once the new one is confirmed.

## App Store note

iOS may **honor** a web-purchased subscription but may not **sell** premium
in-app without Apple IAP — keep the iOS app login-only for premium (the
"Spotify method"). Add RevenueCat/native IAP later per the plan below.

**Decision — reviewed 2026-07-27: web-only for launch, revisit once there's
usage data.** Before this date the iOS app was in violation: `/pricing`
shipped inside the app bundle with no native guard, so it contained a working
Stripe checkout — selling a subscription outside IAP, in-app. Fixed (see
below); the app now sells nothing anywhere.

- **What's fixed:** a `useCanPurchase()` hook (`src/hooks/useCanPurchase.ts`)
  is `false` in the native shell and fails closed until it resolves. Every
  upgrade affordance — the sidebar Upgrade link, `PremiumGate`, the scan PRO
  chip, the currency-rules PRO chip — gates on it; in the app they degrade to
  a plain statement that the feature is Pro, with **no link and no mention of
  where to buy** (naming the website is itself the steering Guideline 3.1.1
  prohibits). `/pricing` itself redirects the native shell to `/logger`, so
  checkout is unreachable even by URL. `claims.eval.ts` (#20) asserts all of
  this structurally, so a future CTA can't quietly reopen the hole.
- **What a Pro subscriber sees in the app:** Settings → **Your plan**
  (`src/components/SettingsModal.tsx`, wording from the pure
  `describeEntitlement()` in `entitlement.ts`) — tier, renewal/trial/past-due
  state, and *"Subscriptions are managed wherever you signed up for them, not
  in the app."* This is the only in-app evidence a subscription is live; there
  is currently no way to reach a "Manage" screen from there because there is
  nothing on Apple's side to manage.
- **Why defer IAP rather than build it now:** the honest comparison isn't
  85%/100% (Apple's Small Business Program is **15%** for developers under
  ~$1M/yr, so $10/mo nets $8.50, not $7 — confirm current terms before
  relying on this number). It's 85% vs **zero** — an iOS pilot who hits a Pro
  wall today has no path forward at all, and in-app paywalls convert far
  better than "go find our website" (which can't even be said out loud). But
  IAP is a real project: StoreKit 2 behind a Capacitor bridge, App Store
  Server Notifications v2 into a new Edge Function, receipt validation, the
  Apple-required restore-purchases flow, and two billing systems to reconcile
  forever (refunds/upgrades/proration differ on each side). Building it
  without knowing whether App Store discovery is even a meaningful channel is
  guessing.
- **Revisit when:** analytics show a meaningful share of signups arriving via
  the App Store rather than the website, or the Pro-wall dead-end is visibly
  costing conversions. Until then, ship web-only and let real numbers decide.
- **What's already ready for it:** the entitlement model needs no logic
  change — `plb_entitlements.source` is already `'stripe' (later: 'apple' |
  'google')`, and `entitlementFromSubscriptions` already picks the best grant
  across multiple rows, so a pilot holding both a Stripe and an Apple
  subscription would resolve correctly on day one. The one schema change
  needed: `plb_subscriptions` is keyed `stripe_subscription_id text primary
  key`; add a generic `id text primary key` + `source text not null default
  'stripe'` (Stripe rows keep using their subscription id as `id`) before an
  Apple row can be inserted. See the RevenueCat plan below for the rest of the
  wiring.

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
