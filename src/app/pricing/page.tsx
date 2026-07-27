import type { Metadata } from "next";
import Pricing from "./Pricing";
import JsonLd from "@/components/JsonLd";
import { softwareApplicationLd, faqPageLd, breadcrumbLd } from "@/lib/seo";
import "./pricing.css";

export const metadata: Metadata = {
  // Slots into "Pricing · Pilot Logbook" via the root title template.
  title: "Pricing — Free & Pro plans",
  description:
    "A complete pilot logbook, free forever — flights, currency, document reminders and exports. Pro ($10/mo) adds unlimited AI logbook scanning, 703/704/705 duty limits and TC-style PDF export. 14-day free trial. Prices in CAD.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pilot Logbook Pricing — Free & Pro",
    description:
      "A complete logbook free forever. Pro ($10/mo) adds unlimited AI scanning, duty & rest limits, and TC-style PDF export. 14-day free trial.",
    url: "/pricing",
  },
};

export default function PricingPage() {
  return (
    <>
      {/* Pricing (SoftwareApplication offers) + FAQ rich results, and a
          breadcrumb trail — all read by Google and AI answer engines. */}
      <JsonLd
        data={[
          softwareApplicationLd(),
          faqPageLd(),
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Pricing", path: "/pricing" },
          ]),
        ]}
      />
      <Pricing />
    </>
  );
}
