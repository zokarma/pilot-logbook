import type { Metadata } from "next";
import Pricing from "./Pricing";
import JsonLd from "@/components/JsonLd";
import { softwareApplicationLd, faqPageLd, breadcrumbLd } from "@/lib/seo";
import "./pricing.css";

export const metadata: Metadata = {
  // Slots into "Pricing · Pilot Logbook" via the root title template.
  title: "Pricing — Free, Pro & Professional plans",
  description:
    "Photograph your paper logbook and let AI fill it in. Free forever, Pro ($10/mo), and Professional ($15/mo) plans — 14-day free trial, scan your first 10 pages free. Prices in CAD.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pilot Logbook Pricing — Free, Pro & Professional",
    description:
      "Free forever, Pro ($10/mo), and Professional ($15/mo). 14-day free trial, scan your first 10 pages free.",
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
