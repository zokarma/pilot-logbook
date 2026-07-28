"use client";

// Whether this surface is allowed to sell anything.
//
// The business model is web-only subscriptions: pilots buy on pilotlogbook.ca,
// and the iOS app simply honours whatever entitlement their account already has
// (the same arrangement Netflix and Spotify use). That keeps 100% of the
// revenue, but it comes with a hard rule from Apple's side: an app that doesn't
// use In-App Purchase must not sell, link to, or steer users toward an outside
// purchase. Buttons like "Upgrade", a reachable /pricing page, or anything that
// opens Stripe are exactly what gets a build rejected under Guideline 3.1.1.
//
// So every purchase affordance is gated on this hook. In the native shell it is
// false and the UI must degrade to a plain, non-actionable statement that the
// feature belongs to Pro — no link, no price, no instructions on where to buy.
//
// Returns false during prerender and the first client render (isNativeApp()
// reads an injected global), so the static HTML and hydrated markup agree. That
// direction is the safe one: a purchase CTA appears a beat late on the web
// rather than flashing inside the app.

import { useEffect, useState } from "react";
import { isNativeApp } from "@/lib/native";

export function useCanPurchase(): boolean {
  const [canPurchase, setCanPurchase] = useState(false);
  useEffect(() => { setCanPurchase(!isNativeApp()); }, []);
  return canPurchase;
}
