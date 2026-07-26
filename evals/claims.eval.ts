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
    const [free, pro, prof] = PLANS;
    s.check("plan names match the entitlement tier labels", stable(PLANS.map((p) => p.name)) === stable([TIER_LABEL.free, TIER_LABEL.pro, TIER_LABEL.professional]));
    s.check(`/pricing shows the structured-data monthly prices ($${pro.price} / $${prof.price})`, pricing.includes(`"$${pro.price}"`) && pricing.includes(`"$${prof.price}"`));
    s.check(`/pricing shows the free tier as $${free.price}`, pricing.includes(`$${free.price}</span>`));
    s.check("the landing page quotes the same prices", landing.includes(`>$${pro.price}<`) && landing.includes(`>$${prof.price}<`));
    s.check("the /pricing meta description quotes the same prices", pricingMeta.includes(`Pro ($${pro.price}/mo)`) && pricingMeta.includes(`Professional ($${prof.price}/mo)`));
    s.check("prices are stated in CAD wherever they appear", pricing.includes("Prices in CAD") && landing.includes("Prices in CAD"));

    // Annual copy has to survive a pilot with a calculator.
    const annual = { pro: 100, prof: 150 };
    s.check("Pro annual math is self-consistent ($100/yr → $8.33/mo, save $20)",
      pricing.includes('"$8.33"') && pricing.includes("$100 billed yearly") &&
      Math.round((annual.pro / 12) * 100) / 100 === 8.33 && pro.price * 12 - annual.pro === 20 && pricing.includes("save $20"));
    s.check("Professional annual math is self-consistent ($150/yr → $12.50/mo, save $30)",
      pricing.includes('"$12.50"') && pricing.includes("$150 billed yearly") &&
      annual.prof / 12 === 12.5 && prof.price * 12 - annual.prof === 30 && pricing.includes("save $30"));
  }

  /* ---------------- comparison table vs the enforced entitlement matrix -------- */
  {
    const row = (label: string): string => (pricing.match(new RegExp(`\\{ label: "${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}".*`)) || [""])[0];
    const dutyRow = row("Duty & rest analysis");
    s.check("comparison table lists Duty & rest as Professional-only, matching FEATURE_MIN_TIER",
      /free: false, pro: false, prof: true/.test(dutyRow) && FEATURE_MIN_TIER.dutyRest === "professional");
    s.check("AI scanning is sold as paid-only and gated at Pro",
      /free: false/.test(row("AI / OCR logbook scanning")) && FEATURE_MIN_TIER.aiScan === "pro");
    s.check("document OCR is sold as paid-only and gated at Pro",
      /free: false/.test(row("OCR licence & document scanning")) && FEATURE_MIN_TIER.docOcr === "pro");
    s.check("currency tracking stays usable on Free, with the advanced rules at Pro",
      /free: "Basic"/.test(row("Currency tracking")) && FEATURE_MIN_TIER.advancedCurrency === "pro");
    s.check("roster import / company reports / analytics are all sold as Professional-only",
      (["rosterImport", "companyReports", "advancedAnalytics"] as Feature[]).every((f) => FEATURE_MIN_TIER[f] === "professional"));
    s.check("no gated feature is left without a tier", (Object.keys(FEATURE_MIN_TIER) as Feature[]).every((f) => (["free", "pro", "professional"] as Tier[]).includes(FEATURE_MIN_TIER[f])));
  }

  /* -------------------------------- probes ------------------------------------ */
  {
    // A tier is only real if something in the UI actually asks for it. Comments
    // don't count — PremiumGate documents itself with a `feature="…"` example.
    const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const ui = [...sourceFiles("src/app"), ...sourceFiles("src/components")].map((f) => stripComments(read(f))).join("\n");
    const features = Object.keys(FEATURE_MIN_TIER) as Feature[];
    const unwired = features.filter((f) => !new RegExp(`["'\`]${f}["'\`]`).test(ui));
    const profUnwired = unwired.filter((f) => FEATURE_MIN_TIER[f] === "professional");
    s.probe(
      "gated features with no enforcement site in the UI",
      `${unwired.length}/${features.length} declared features are never referenced by a PremiumGate or has(): ${unwired.join(", ")}. ` +
      `Of those, ${profUnwired.length} are the Professional tier's headline promises (${profUnwired.join(", ")}) — advertised on /pricing at $${PLANS[2].price}/mo but not built, so a Professional subscriber today gets the Duty page and nothing else beyond Pro. ` +
      `The enforced set is: ${features.filter((f) => !unwired.includes(f)).join(", ")}.`,
    );

    const scanMeter = /scansUsed|scanCount|scanQuota|scanAllowance|pagesScanned/.test(ui);
    s.probe(
      "\"Pro: limited scans / Professional: unlimited\" is not metered",
      scanMeter
        ? "a scan counter exists in the UI"
        : `no scan counter exists anywhere in src/app or src/components — ScanImport gates on has("aiScan") only, so Pro scanning is de-facto unlimited and aiScanUnlimited (the Professional differentiator, and the /pricing row "Limited / month" vs "Unlimited") is unenforced. The FAQ's "scan your first 10 pages free" has no counter behind it either.`,
    );

    const devices = FAQS.find((f) => /devices/i.test(f.q))!;
    s.probe(
      "FAQ device claim contradicts the entitlement matrix",
      `structured-data FAQ says "${devices.a}" — i.e. Professional adds the native apps — but FEATURE_MIN_TIER.nativeApps is "${FEATURE_MIN_TIER.nativeApps}" and the /pricing comparison row says Pro already gets "All platforms". Google and AI answer engines quote the FAQ, so the answer a pilot gets is the wrong one. Also: the repo ships an iOS/iPadOS Capacitor target only — there is no macOS/Catalyst target, so "Mac apps" is true only via "iPad apps on Apple silicon Macs".`,
    );

    const trialCode = /trial/i.test(ui.replace(/free trial/gi, "")) ;
    s.probe(
      "the 14-day free trial is a Stripe-side promise with no in-app representation",
      `the copy sells a 14-day trial in ${(pricing.match(/free trial/gi) || []).length} places on /pricing plus the landing page, and entitlement.ts honors status "trialing" if Stripe sends it — but nothing in the client starts, counts down, or surfaces a trial${trialCode ? "" : " (no trial state in the UI at all)"}. It holds only if every Payment Link is configured with a 14-day trial in the Stripe dashboard; that's an operator step, not a code path, and no eval can catch it drifting.`,
    );

    s.probe(
      "hero CTAs bypass checkout",
      `START_HREF is "/login" in Pricing.tsx, so the hero and footer "Start your 14-day free trial" buttons go to signup while only the plan-card buttons call startCheckout(). Intentional (BILLING.md rule #1: log in before the paywall), but it means the most prominent CTA never reaches Stripe — worth confirming it's still what you want now that checkout is live.`,
    );

    s.probe(
      "\"encrypted\" claim in the data-safety FAQ",
      `the FAQ says the logbook is "encrypted, scoped to your account". Accurate for the cloud row (Supabase at-rest encryption + RLS on plb_app_state) and in transit, but the offline mirror — the full logbook, plus bug-report screenshots — sits in plain localStorage on the device, and local-only mode has no encryption at all. Qualifying it ("encrypted in transit and at rest in the cloud") keeps the claim defensible.`,
    );
  }

  return s;
}
