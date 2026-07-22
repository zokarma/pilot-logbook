// Single source of truth for SEO: canonical site facts, keyword-rich copy, and
// JSON-LD structured-data builders. Structured data is what Google uses for
// rich results AND what AI answer engines (ChatGPT, Perplexity, Google AI
// Overviews, Gemini) read to describe and cite the product — so keep it factual
// and in sync with what the pages actually show. Pure/framework-free.

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
// Logbook cost" are accurate. Prices in USD, monthly.
export const PLANS = [
  { name: "Free", price: 0, tagline: "Everything you need to keep a proper logbook." },
  { name: "Pro", price: 7, tagline: "Backed up, syncing everywhere — with AI logbook scanning." },
  { name: "Professional", price: 10, tagline: "For working pilots who live in their logbook." },
] as const;

// FAQ content — the single source rendered on /pricing AND emitted as FAQPage
// structured data (Google requires the Q&A be visible on the page, which it is).
export const FAQS: { q: string; a: string }[] = [
  { q: "Do I need a credit card to start?", a: "No. Create a free account and start logging immediately, or begin a 14-day Pro trial and scan your first 10 pages free — no card until you decide to keep it." },
  { q: "What counts as a scan?", a: "One photographed logbook page. Pro includes a generous monthly allowance; Professional is unlimited, so you can digitize a lifetime of paper in one sitting." },
  { q: "Does it work offline?", a: "Yes. Your logbook is mirrored to your device, so you can log in the air with no signal. It syncs automatically the moment you're back online." },
  { q: "Is my logbook data safe?", a: "Your logbook is a legal document, and we treat it that way — encrypted, scoped to your account so no one else can read it, and yours to export as CSV or a Transport Canada-style PDF at any time." },
  { q: "Can I cancel anytime?", a: "Anytime, from your account. You keep every flight you've logged and simply drop back to the free plan — nothing is deleted." },
  { q: "Which devices are included?", a: "Free and Pro run in any browser and sync across devices. Professional adds the native iPhone, iPad, and Mac apps for cockpit-side logging and offline scanning." },
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
      priceCurrency: "USD",
      lowPrice: "0",
      highPrice: "10",
      offerCount: PLANS.length,
      offers: PLANS.map((p) => ({
        "@type": "Offer",
        name: `${SITE_NAME} ${p.name}`,
        price: String(p.price),
        priceCurrency: "USD",
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
