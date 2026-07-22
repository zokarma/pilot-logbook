import type { Metadata } from "next";
import Landing from "./Landing";
import JsonLd from "@/components/JsonLd";
import { SITE_NAME, SITE_DESCRIPTION, softwareApplicationLd } from "@/lib/seo";
import "./landing.css";

// The site root (pilotlogbook.ca) is the public marketing landing page. It
// drives visitors into the app (`/dashboard`) and to the plans (`/pricing`);
// the login screen lives on its own URL (`/login`). The native Capacitor shell
// also boots here and is redirected straight to `/logger` inside <Landing />.
export const metadata: Metadata = {
  // Keyword-forward home title (bypasses the "· Pilot Logbook" template).
  title: { absolute: `${SITE_NAME} — Digital Pilot Logbook App with AI Scanning, Currency & Duty Tracking` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      {/* Product structured data for rich results + AI answer engines.
          (Organization + WebSite are already emitted site-wide in the layout.) */}
      <JsonLd data={softwareApplicationLd()} />
      <Landing />
    </>
  );
}
