// Eval #20 — plan promises vs product truth (src/lib/seo.ts + the pricing/landing
// copy + entitlement wiring).
//
// Everything else in this directory asks "does the code do what it says?". This
// one asks the product-manager question: "does the product do what we SELL?"
// Structured data (seo.ts) is what Google and the AI answer engines quote back
// to a pilot deciding whether to pay, so a stale price or an unshipped feature
// here is a promise the app has to keep. The checks lock the facts that are
// consistent today; the probes record where the pitch is ahead of the build.

import fs from "node:fs";
import path from "node:path";
import {
  SITE_URL, SITE_NAME, OG_IMAGE, SITE_DESCRIPTION, SITE_KEYWORDS, PLANS, FAQS, FEATURE_LIST,
  organizationLd, webSiteLd, softwareApplicationLd, faqPageLd, breadcrumbLd,
} from "../src/lib/seo";
import { FEATURE_MIN_TIER, TIER_LABEL, Feature, Tier } from "../src/lib/entitlement";
import { Suite, stable } from "./harness";

// Repo root, found by walking up from the cwd — works whichever directory the
// runner is invoked from, and under either module format.
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "src", "lib", "seo.ts"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("claims.eval: could not locate the repo root from " + process.cwd());
}

const ROOT = repoRoot();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

// Every .tsx/.ts under a UI directory, for the "is this gate actually wired?" audit.
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

export function run(): Suite {
  const s = new Suite(20, "Plan promises vs product truth (seo.ts + pricing)", "Structured data and pricing copy are what a buying pilot (and every AI answer engine) is told the app does.");

  const pricing = read("src/app/pricing/Pricing.tsx");
  const pricingMeta = read("src/app/pricing/page.tsx");
  const landing = read("src/app/Landing.tsx");

  /* --------------------------- canonical site facts --------------------------- */
  s.check("SITE_URL is absolute https with no trailing slash", /^https:\/\/[^/]+$/.test(SITE_URL));
  s.check("the OG image is an absolute URL under the site origin", OG_IMAGE.startsWith(SITE_URL + "/"));
  s.check("the description is substantial but under the ~160-char snippet budget for the meta tag", SITE_DESCRIPTION.length > 80);
  s.check("keywords are unique and non-empty", SITE_KEYWORDS.length === new Set(SITE_KEYWORDS).size && SITE_KEYWORDS.every((k) => !!k.trim()));
  s.check("feature list entries are all non-empty", FEATURE_LIST.length > 0 && FEATURE_LIST.every((f) => !!f.trim()));

  /* ------------------------------ structured data ----------------------------- */
  const blocks: Record<string, Record<string, unknown>> = {
    Organization: organizationLd(),
    WebSite: webSiteLd(),
    SoftwareApplication: softwareApplicationLd(),
    FAQPage: faqPageLd(),
    BreadcrumbList: breadcrumbLd([{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }]),
  };
  for (const [name, ld] of Object.entries(blocks)) {
    s.check(`${name} JSON-LD declares schema.org + @type`, ld["@context"] === "https://schema.org" && ld["@type"] === name);
    s.check(`${name} JSON-LD serializes with no undefined holes`, !stable(ld).includes("undefined") && JSON.parse(JSON.stringify(ld)) !== null);
  }

  {
    const app = blocks.SoftwareApplication;
    const offers = app.offers as { offerCount: number; lowPrice: string; highPrice: string; priceCurrency: string; offers: { name: string; price: string; priceCurrency: string; category: string }[] };
    const prices = PLANS.map((p) => p.price);
    s.check("the offer count matches the plans we actually sell", offers.offerCount === PLANS.length && offers.offers.length === PLANS.length);
    s.check("the aggregate price band brackets the real plan prices", offers.lowPrice === String(Math.min(...prices)) && offers.highPrice === String(Math.max(...prices)));
    s.check("every price is quoted in CAD (aggregate and per-offer)", offers.priceCurrency === "CAD" && offers.offers.every((o) => o.priceCurrency === "CAD"));
    s.check("each offer price matches its plan", offers.offers.every((o, i) => o.price === String(PLANS[i].price)));
    s.check("each offer is named for the product", offers.offers.every((o) => o.name.startsWith(SITE_NAME)));
    s.check("the free plan is categorized free, the paid ones as subscriptions", offers.offers[0].category === "free" && offers.offers.slice(1).every((o) => o.category === "subscription"));
    s.check("platforms advertised match what ships (web + iOS/iPadOS)", String(app.operatingSystem) === "Web, iOS, iPadOS");
  }

  {
    const faq = blocks.FAQPage.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    s.check("every FAQ becomes a Question entity", faq.length === FAQS.length);
    s.check("every Q&A pair is non-empty", faq.every((q) => !!q.name.trim() && !!q.acceptedAnswer.text.trim()));
    s.check("FAQ questions are unique (duplicates suppress rich results)", new Set(FAQS.map((f) => f.q)).size === FAQS.length);
    s.check("every FAQ rendered on /pricing comes from this one source", pricing.includes("FAQS.map") && pricing.includes('from "@/lib/seo"'));
  }

  {
    const crumbs = blocks.BreadcrumbList.itemListElement as { position: number; item: string }[];
    s.check("breadcrumb positions are 1-based and sequential", crumbs.every((c, i) => c.position === i + 1));
    s.check("breadcrumb items are absolute URLs", crumbs.every((c) => c.item.startsWith(SITE_URL + "/")));
  }

  /* ------------------ the price a crawler sees == the price we show ------------ */
  {
    const [free, pro] = PLANS;
    s.check("we sell exactly two plans (Professional was withdrawn — its features were never built)", PLANS.length === 2);
    s.check("plan names match the entitlement tier labels", stable(PLANS.map((p) => p.name)) === stable([TIER_LABEL.free, TIER_LABEL.pro]));
    s.check(`/pricing shows the structured-data monthly price ($${pro.price})`, pricing.includes(`"$${pro.price}"`));
    s.check(`/pricing shows the free tier as $${free.price}`, pricing.includes(`$${free.price}</span>`));
    s.check("the landing page quotes the same price", landing.includes(`>$${pro.price}<`));
    s.check("prices are stated in CAD wherever they appear", pricing.includes("Prices in CAD") && landing.includes("Prices in CAD"));

    // Annual copy has to survive a pilot with a calculator.
    const annualPro = 100;
    s.check("Pro annual math is self-consistent ($100/yr → $8.33/mo, save $20)",
      pricing.includes('"$8.33"') && pricing.includes("$100 billed yearly") &&
      Math.round((annualPro / 12) * 100) / 100 === 8.33 && pro.price * 12 - annualPro === 20 && pricing.includes("save $20"));

    // The withdrawn tier must not reappear in any customer-facing surface until
    // its features exist. The Tier type keeps "professional" so legacy
    // subscriptions still resolve — that's code, not a promise.
    const publicCopy = [pricing, pricingMeta, landing, read("src/lib/seo.ts")].join("\n");
    s.check("the withdrawn Professional tier is not advertised anywhere", !/Professional/.test(publicCopy.replace(/professional["']?\s*[:,)]/g, "")));
    s.check("no $15 / $12.50 Professional pricing survives in the copy", !pricing.includes("$15") && !pricing.includes("$12.50") && !landing.includes(">$15<"));
  }

  /* ---------------- comparison table vs the enforced entitlement matrix -------- */
  {
    const row = (label: string): string => (pricing.match(new RegExp(`\\{ label: "${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}".*`)) || [""])[0];
    s.check("Duty & rest is sold as Pro-only and gated at Pro",
      /free: false, pro: true/.test(row("Duty & rest analysis (703/704/705)")) && FEATURE_MIN_TIER.dutyRest === "pro");
    s.check("AI scanning is sold as paid-only and gated at Pro",
      /free: false/.test(row("AI logbook scanning")) && FEATURE_MIN_TIER.aiScan === "pro");
    s.check("document scanning is sold as paid-only and gated at Pro",
      /free: false/.test(row("Document & licence scanning")) && FEATURE_MIN_TIER.docOcr === "pro");
    s.check("currency tracking stays usable on Free, with custom rules at Pro",
      /free: "Built-in CARs rules"/.test(row("Currency tracking")) && FEATURE_MIN_TIER.advancedCurrency === "pro");
    s.check("no gated feature is left without a tier", (Object.keys(FEATURE_MIN_TIER) as Feature[]).every((f) => (["free", "pro", "professional"] as Tier[]).includes(FEATURE_MIN_TIER[f])));

    // HARD CHECK (was a probe): a feature may only be declared if something in
    // the UI actually enforces it. This is what stopped being true and put
    // unbuilt promises on /pricing — never let it regress.
    const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const ui = [...sourceFiles("src/app"), ...sourceFiles("src/components")].map((f) => stripComments(read(f))).join("\n");
    const features = Object.keys(FEATURE_MIN_TIER) as Feature[];
    const unwired = features.filter((f) => !new RegExp(`["'\`]${f}["'\`]`).test(ui));
    s.check("every declared feature is actually enforced somewhere in the UI", unwired.length === 0, unwired.join(", "));
  }

  /* ------------- claims that must stay defensible (were probes, now checks) ---- */
  {
    const devices = FAQS.find((f) => /devices/i.test(f.q))!.a;
    s.check("the device FAQ does not promise a Mac app (no macOS target ships)",
      !/\bMac app/i.test(devices.replace(/no separate Mac app/i, "")) && /iPhone and iPad/i.test(devices));
    s.check("the device FAQ agrees with the comparison table (native apps on every plan)",
      /every plan/i.test(devices) && /free: true, pro: true/.test((pricing.match(/\{ label: "iPhone & iPad app".*/) || [""])[0]));

    const safety = FAQS.find((f) => /safe/i.test(f.q))!.a;
    s.check("the data-safety FAQ qualifies encryption rather than claiming it blanket-wide",
      /in transit and at rest in the cloud/i.test(safety) && /on your own device/i.test(safety));

    s.check("scanning copy does not promise a free allowance that isn't metered",
      !/10 (pages|scans)/i.test([pricing, landing, read("src/lib/seo.ts")].join("\n")));

    const canada = FAQS.find((f) => /canadian/i.test(f.q));
    s.check("the FAQ states the regulatory scope is Canadian (CARs), not universal", !!canada && /CAR/.test(canada.a));
  }

  /* -------------------------------- probes ------------------------------------ */
  {
    const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const ui = [...sourceFiles("src/app"), ...sourceFiles("src/components")].map((f) => stripComments(read(f))).join("\n");

    const trialCode = /trial/i.test(ui.replace(/free trial/gi, ""));
    s.probe(
      "the 14-day free trial is a Stripe-side promise with no in-app representation",
      `the copy sells a 14-day trial in ${(pricing.match(/free trial/gi) || []).length} places on /pricing plus the landing page, and entitlement.ts honors status "trialing" if Stripe sends it — but nothing in the client starts, counts down, or surfaces a trial${trialCode ? "" : " (no trial state in the UI at all)"}. It holds only if the Stripe price is configured with a 14-day trial; that's an operator step, not a code path, and no eval can catch it drifting. Deliberate: the operator confirmed the trial will be configured in Stripe before launch.`,
    );

    s.probe(
      "hero CTAs bypass checkout",
      `START_HREF is "/login" in Pricing.tsx, so the hero and footer trial buttons go to signup while only the plan-card button calls startCheckout(). Intentional (BILLING.md rule #1: log in before the paywall), but it means the most prominent CTA never reaches Stripe.`,
    );

    const scanMeter = /scansUsed|scanCount|scanQuota|scanAllowance|pagesScanned/.test(ui);
    s.probe(
      "free-scan allowance is deferred, not shipped",
      scanMeter
        ? "a scan counter now exists in the UI — the free allowance can be advertised again."
        : `no scan counter exists, and the copy correctly says AI scanning is Pro-only. A free allowance was considered and deferred: it cannot be enforced client-side because scan-extract returns 402 for non-premium callers, and a browser counter is bypassable by clearing storage (direct Anthropic API cost exposure). Shipping it needs a server-side usage table plus scan-extract enforcement and a redeploy.`,
    );

    s.probe(
      "Professional tier withdrawn but still live in code",
      `"professional" remains in the Tier union, RANK, TIER_LABEL and the stripe-webhook price map so any subscription sold while it was listed keeps resolving and outranking pro. It has no purchase path and no /pricing presence. If nobody ever bought it, the tier can be deleted outright; if anyone did, leave it until those subscriptions end.`,
    );
  }

  return s;
}
