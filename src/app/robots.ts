import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Emitted as a static /robots.txt at build time (output: "export"). We allow
// every crawler — including AI/answer-engine bots (GPTBot, ClaudeBot,
// PerplexityBot, Google-Extended, etc., which match "*") — since the goal is to
// be found in both classic and AI search. The app's own data is behind auth and
// never served as crawlable pages, so a blanket allow is safe. /_next/ internals
// are not useful to index.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/_next/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
