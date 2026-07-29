// Single source of truth for SEO: canonical site facts, keyword-rich copy, and
// JSON-LD structured-data builders. Structured data is what Google uses for
// rich results AND what AI answer engines (ChatGPT, Perplexity, Google AI
// Overviews, Gemini) read to describe and cite the product — so keep it factual
// and in sync with what the pages actually show. Pure/framework-free.

import { allHelpTopics } from "./help";

// Canonical production origin. Overridable per environment; defaults to the
// custom domain so canonicals/sitemap/OG URLs are absolute and stable.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://pilotlogbook.ca").replace(/\/+$/, "");
export const SITE_NAME = "Pilot Logbook";
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

// The one-line pitch reused across metadata + structured data.
export const SITE_TAGLINE = "Digital pilot logbook with AI scanning, currency & duty tracking";
export const SITE_DESCRIPTION =
  "Photograph your paper logbook and let AI fill it in. Pilot Logbook tracks your flight hours, currency, duty limits, and document expiries automatically — on the web, iPhone, and iPad. Free to start, works offline.";

// Primary keyword set (informs meta keywords + copy; not a ranking silver
// bullet, but keeps intent explicit for crawlers and AI extractors).
export const SITE_KEYWORDS = [
  "pilot logbook",
  "digital pilot logbook",
  "electronic pilot logbook",
  "pilot logbook app",
  "flight time tracking",
  "logbook scanning app",
  "AI logbook scanning",
  "pilot currency tracker",
  "duty time tracker",
  "Transport Canada logbook",
  "CARs currency",
  "aviation logbook app",
  "pilot logbook Canada",
  "iPhone pilot logbook",
];

// Pricing tiers — mirrors /pricing so AI answers to "how much does Pilot
// Logbook cost" are accurate. Prices in CAD, monthly.
export const PLANS = [
  { name: "Free", price: 0, tagline: "Everything you need to keep a proper logbook." },
  { name: "Pro", price: 10, tagline: "AI scanning, duty limits, and pro exports." },
] as const;

// FAQ content — the single source rendered on /pricing AND emitted as FAQPage
// structured data (Google requires the Q&A be visible on the page, which it is).
export const FAQS: { q: string; a: string }[] = [
  { q: "Do I need a credit card to start?", a: "No. Create a free account and start logging immediately — no card, no expiry. The free plan is a complete logbook: unlimited flights, currency tracking, document reminders, and CSV and PDF export." },
  { q: "What counts as a scan?", a: "One photographed logbook page. AI scanning is a Pro feature and Pro has no page limit, so you can digitize a lifetime of paper in one sitting. The 14-day trial lets you scan as much as you like before deciding." },
  { q: "Does it work offline?", a: "Yes. Your logbook is mirrored to your device, so you can log in the air with no signal. It syncs automatically the moment you're back online." },
  { q: "Is my logbook data safe?", a: "Your logbook is a legal document, and we treat it that way. It's encrypted in transit and at rest in the cloud, and row-level security scopes every record to your account so no one else can read it. A copy is also kept on your own device for offline use, and everything is yours to export as CSV or a Transport Canada-style PDF at any time." },
  { q: "Can I cancel anytime?", a: "Yes — Settings → Your plan → Manage subscription opens self-serve billing where you can cancel, switch plans, or update your card. Cancelling stops future billing; you keep Pro until the end of the period you already paid for, then drop to the free plan. Every flight you've logged stays — nothing is deleted." },
  { q: "What's your refund policy?", a: "We don't offer refunds for partial billing periods — cancelling stops future charges but doesn't refund the current period. The 14-day free trial exists so you can try Pro fully before you're ever charged. If something billed incorrectly, contact us and we'll sort it out." },
  { q: "Which devices are included?", a: "Every plan runs in any modern browser and syncs across your devices, and the native iPhone and iPad app is included on every plan too — it works offline, so you can log in the cockpit with no signal. There's no separate Mac app; the iPad app also runs on Apple-silicon Macs." },
  { q: "Is this built for Canadian pilots?", a: "Yes. Currency, duty and document expiry are modelled on the Canadian Aviation Regulations — CAR 401.05 recency, 703/704/705 duty and rest limits, and Transport Canada medical validity. Pilots outside Canada can still log flights, import and export, but the regulatory gauges won't match their rules. They're a reference aid either way: the CARs and your company minima always govern." },
];

// Feature list surfaced to crawlers/AI as concrete capabilities.
export const FEATURE_LIST = [
  "AI logbook scanning (photo to filled flight rows)",
  "Automatic currency & recency tracking (day/night/IFR)",
  "703/704/705 duty & rest limit tracking",
  "Aviation document expiry reminders (Transport Canada expiry math)",
  "CSV import/export and Transport Canada-style PDF export",
  "Offline-first with cloud sync across web, iPhone, and iPad",
];

type Json = Record<string, unknown>;

// Organization — who publishes the app (helps entity/knowledge extraction).
export function organizationLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    description: SITE_DESCRIPTION,
  };
}

// WebSite — names the site as an entity for site-name display in results.
export function webSiteLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
  };
}

// SoftwareApplication — the richest signal: category, platforms, features, and
// an AggregateOffer covering the pricing tiers so AI answers get price right.
export function softwareApplicationLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Pilot Logbook",
    operatingSystem: "Web, iOS, iPadOS",
    description: SITE_DESCRIPTION,
    featureList: FEATURE_LIST,
    image: OG_IMAGE,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "CAD",
      // Derived from PLANS — a hardcoded band silently kept advertising the
      // withdrawn $15 tier to crawlers after it left /pricing.
      lowPrice: String(Math.min(...PLANS.map((p) => p.price))),
      highPrice: String(Math.max(...PLANS.map((p) => p.price))),
      offerCount: PLANS.length,
      offers: PLANS.map((p) => ({
        "@type": "Offer",
        name: `${SITE_NAME} ${p.name}`,
        price: String(p.price),
        priceCurrency: "CAD",
        category: p.name === "Free" ? "free" : "subscription",
        description: p.tagline,
      })),
    },
  };
}

// FAQPage — powers FAQ rich results and gives AI engines clean Q&A pairs.
export function faqPageLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

// FAQPage for /help, built from the same task guides the page renders. Steps
// are folded into the answer text so the rich result carries the actual
// instructions rather than a bare one-liner.
export function helpFaqPageLd(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: allHelpTopics().map((t) => ({
      "@type": "Question",
      name: t.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: [t.answer, ...(t.steps ?? []), t.note ?? ""].filter(Boolean).join(" "),
      },
    })),
  };
}

// BreadcrumbList helper for interior pages.
export function breadcrumbLd(items: { name: string; path: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  };
}
