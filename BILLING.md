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

## Operator setup (to go live)

1. **DB:** run `supabase/schema.sql` (adds `plb_entitlements`; safe to re-run).
2. **Stripe:** create the Pro & Professional products + monthly/yearly prices;
   make a **Payment Link** per price with a 14-day trial and "collect
   client reference id" on.
3. **Function:**
   ```
   supabase functions deploy stripe-webhook --no-verify-jwt
   supabase secrets set STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=… \
     STRIPE_PRICE_MAP='{"price_pro_m":"pro","price_pro_y":"pro","price_prof_m":"professional","price_prof_y":"professional"}'
   ```
   Add the function URL as a Stripe webhook endpoint subscribing to
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
4. **App env** (Vercel, public): `NEXT_PUBLIC_STRIPE_LINK_PRO_MONTHLY`,
   `_PRO_YEARLY`, `_PROFESSIONAL_MONTHLY`, `_PROFESSIONAL_YEARLY` = the payment
   link URLs. Until set, the plan buttons fall back to signup.
5. **Turn on enforcement** feature-by-feature by wrapping surfaces in
   `<PremiumGate feature="…">` (or checking `useEntitlement().has(...)`). Do
   this deliberately so beta users aren't suddenly paywalled.

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
