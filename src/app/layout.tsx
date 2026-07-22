import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DataProvider } from "@/context/DataContext";
import JsonLd from "@/components/JsonLd";
import { SITE_URL, SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION, SITE_KEYWORDS, OG_IMAGE, organizationLd, webSiteLd } from "@/lib/seo";

export const metadata: Metadata = {
  // metadataBase makes every relative canonical / OG / Twitter URL absolute.
  metadataBase: new URL(SITE_URL),
  // Per-page titles slot into "%s · Pilot Logbook"; pages that want a full
  // custom title use `title: { absolute: "…" }`.
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "aviation",
  alternates: { canonical: "/" },
  formatDetection: { telephone: false },
  // Explicitly invite crawlers (incl. AI/answer-engine bots) and allow full
  // rich-result rendering. robots.txt allows the same.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_CA",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME} — ${SITE_TAGLINE}` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

// viewport-fit=cover lets the page extend into the iPhone notch / home-bar
// areas inside the Capacitor shell (padded back via the .safe-* utilities in
// globals.css). Harmless on the website.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme boot script below sets data-theme on
    // <html> before hydration; React must not treat that as a mismatch.
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Apply the stored theme before anything paints (no light/dark flash).
            Also flag the native (Capacitor) shell so the root marketing page
            (landing.css hides `.lp` under [data-native]) never flashes before
            it redirects into the logbook. Runs synchronously as the first thing
            in <body>. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("plb_theme")==="light")document.documentElement.setAttribute("data-theme","light");var c=window.Capacitor;if(c&&c.isNativePlatform&&c.isNativePlatform())document.documentElement.setAttribute("data-native","1")}catch(e){}',
          }}
        />
        {/* Site-wide structured data (identifies the site + publisher as
            entities). Page-specific schema (SoftwareApplication, FAQPage) is
            added on the relevant marketing pages. */}
        <JsonLd data={[organizationLd(), webSiteLd()]} />
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
