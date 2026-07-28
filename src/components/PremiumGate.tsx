"use client";

// Gate a feature behind the pilot's plan. Renders children when their tier
// unlocks `feature`, otherwise an upsell (or a custom fallback). Enforcement is
// opt-in per feature — wrap a premium surface with this when you're ready to
// turn the paywall on; nothing is gated by default.
//
//   <PremiumGate feature="aiScanUnlimited"><CloudScanButton/></PremiumGate>

import type { ReactNode } from "react";
import Link from "next/link";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useCanPurchase } from "@/hooks/useCanPurchase";
import { FEATURE_MIN_TIER, Feature, TIER_LABEL } from "@/lib/entitlement";

export default function PremiumGate({
  feature,
  children,
  fallback,
}: {
  feature: Feature;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { has, ready } = useEntitlement();
  if (!ready) return null;              // don't flash the upsell before we know
  if (has(feature)) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  return <Upsell feature={feature} />;
}

function Upsell({ feature }: { feature: Feature }) {
  const need = TIER_LABEL[FEATURE_MIN_TIER[feature]];
  const canPurchase = useCanPurchase();
  return (
    <div className="card p-4 border border-brand-500/30 text-center">
      <p className="text-sm text-slate-300">
        This is a <span className="font-semibold text-brand-300">{need}</span> feature.
      </p>
      {canPurchase ? (
        <Link
          href="/pricing"
          className="inline-flex items-center gap-2 mt-3 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          Upgrade to {need}
        </Link>
      ) : (
        // In the app: state the fact, offer nothing. No link, no price, no
        // "buy it on our site" — that steering is what breaks Guideline 3.1.1.
        <p className="text-xs text-slate-500 mt-2">
          Your plan doesn&apos;t include it.
        </p>
      )}
    </div>
  );
}
