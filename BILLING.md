# Billing & Subscriptions — setup plan (future work)

Not built yet. v1.0 ships free. This is the blueprint for when we add premium.

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
