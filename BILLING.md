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
- **`supabase/functions/stripe-webhook`** — verifies the Stripe signature, maps
  the subscription's price → tier via `STRIPE_PRICE_MAP`, and upserts the row.
- **`src/lib/entitlement.ts`** (pure, eval-covered) — `effectiveTier` (with a
  `GRACE_DAYS` window so a paying pilot is never locked out offline / on a
  retriable payment), `hasFeature`, and `entitlementFromRow` (a malformed row
  can never read as premium).
- **`src/hooks/useEntitlement.ts`** — offline-first read of the row (cached in
  localStorage), interpreted by the pure helpers.
- **`src/components/PremiumGate.tsx`** — `<PremiumGate feature="…">` wrapper;
  enforcement is opt-in per feature.
- **`src/lib/checkout.ts`** + the `/pricing` plan buttons — start a Stripe
  Payment Link checkout with `client_reference_id = supabase user id`.

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
2. **Stripe:** create the Pro & Professional products + monthly/yearly prices,
   then a **Payment Link** per price with a **14-day trial**.
   - **Do NOT enable "collect client reference id"** on the link — the app
     appends `?client_reference_id=<user id>` to the URL itself
     (`lib/checkout.ts`), and an on-screen field only confuses customers (an
     empty submit can blank the value). The URL param is the sole source.
3. **Function** (Supabase CLI, from the repo root; project ref
   `gnfdhxzvivrmltrkdugy`):
   ```
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
   Register the function URL
   (`https://<ref>.supabase.co/functions/v1/stripe-webhook`) as a Stripe
   webhook endpoint subscribing to `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`; copy its
   signing secret. Then set the three secrets:
   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_…
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
   ```
   For `STRIPE_PRICE_MAP` (JSON), PowerShell mangles inline quotes — write a
   temp `.env.stripe` (gitignored via `.env.*`) and load it, then delete it:
   ```powershell
   'STRIPE_PRICE_MAP={"price_proM":"pro","price_proY":"pro","price_profM":"professional","price_profY":"professional"}' | Out-File -Encoding ascii .env.stripe
   supabase secrets set --env-file .env.stripe
   Remove-Item .env.stripe
   ```
   The function holds one secret set, so `STRIPE_SECRET_KEY`/`WEBHOOK_SECRET`
   are either both test or both live — switching to live retires the test flow
   (test-mode signatures stop matching, by design). `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.
4. **App env** (Vercel → Production, public): `NEXT_PUBLIC_STRIPE_LINK_PRO_MONTHLY`,
   `_PRO_YEARLY`, `_PROFESSIONAL_MONTHLY`, `_PROFESSIONAL_YEARLY` = the payment
   link URLs. **`NEXT_PUBLIC_` vars bake in at build time — redeploy after
   changing them.** Until set, plan buttons fall back to `/login`.
5. **Enforcement is ON** (see the table at the top). Gated surfaces show a
   PRO/lock affordance that routes to `/pricing`; add more gates with
   `<PremiumGate feature="…">` or `useEntitlement().has(...)`.

## Going live (when incorporated)

Live and Test are fully separate in Stripe. Repeat setup in **live mode**:
recreate the 2 products + 4 prices (CAD), 4 Payment Links (14-day trial, **no**
client-reference-id field), and a **live webhook endpoint** on the same
function URL. Then re-set the three Supabase secrets with **live** values
(`sk_live_…`, the live `whsec_…`, and `STRIPE_PRICE_MAP` with the **live**
price IDs), swap the 4 Vercel link vars to the live URLs, and **redeploy**.
Smoke-test with a real card — the trial means $0 due today, so verify the
`plb_entitlements` row then cancel before day 14.

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
- **Bad `client_reference_id` retries forever.** If a checkout arrives with a
  `client_reference_id` that isn't a real `auth.users` id, the upsert violates
  the FK, the handler 500s and Stripe retries for ~3 days. Harmless but noisy;
  validating the id (or 200-ing with a logged error) would settle it.
- A payer can pass **someone else's** user id as `client_reference_id` and grant
  *them* premium at their own expense. Self-harming rather than an escalation,
  so it's accepted — worth knowing if support ever sees a "surprise premium".

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
