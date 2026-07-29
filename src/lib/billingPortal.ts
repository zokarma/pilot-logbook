// Open the Stripe Billing Portal — the self-serve place a pilot cancels,
// changes plan, updates a card, or sees invoices. Same shape as checkout.ts:
// the create-portal-session Edge Function derives the account from the
// caller's own JWT, so nothing here can be pointed at another account.
//
// Web only, deliberately: on iOS this must never be reachable (see
// useCanPurchase) — a subscriber there is told in Settings that management
// happens wherever they signed up, not offered a button that opens billing
// from inside the app.

export interface PortalStart {
  url?: string;
  error?: string;
}

// Same shape as CheckoutClient in checkout.ts — declared locally so this
// module doesn't depend on that one, and so an eval can inject a stub without
// a browser or a live session.
export interface PortalClient {
  auth: { getSession: () => Promise<{ data: { session: unknown } }> };
  functions: {
    invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;
  };
}

// Resolve the portal URL, or an error to show. Split from openBillingPortal
// so the request-building logic is testable without a browser.
export async function billingPortalTarget(client?: PortalClient): Promise<PortalStart> {
  const sb = client ?? (await import("./supabaseClient")).getSupabaseClient() as PortalClient | null;
  if (!sb) return { error: "Billing isn't available right now." };

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: "Please sign in again to manage your subscription." };

  try {
    const { data, error } = await sb.functions.invoke("create-portal-session", { body: {} });
    if (error) {
      let detail = "";
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try { detail = ((await ctx.json()) as { error?: string }).error ?? ""; } catch { /* opaque */ }
      }
      return { error: detail || "Could not open the billing portal — please try again." };
    }
    const url = (data as { url?: string } | null)?.url;
    if (!url) return { error: "Could not open the billing portal — please try again." };
    return { url };
  } catch {
    return { error: "Could not reach billing — check your connection and try again." };
  }
}

// Convenience for a button onClick. Navigates on success; returns an error
// string for the caller to display otherwise.
export async function openBillingPortal(): Promise<{ error?: string }> {
  if (typeof window === "undefined") return {};
  const target = await billingPortalTarget();
  if (target.url) { window.location.href = target.url; return {}; }
  return { error: target.error };
}
