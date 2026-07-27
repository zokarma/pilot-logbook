import type { Metadata } from "next";
import Help from "./Help";
import JsonLd from "@/components/JsonLd";
import { helpFaqPageLd, breadcrumbLd } from "@/lib/seo";
import "./help.css";

export const metadata: Metadata = {
  // Slots into "Help & guides · Pilot Logbook" via the root title template.
  title: "Help & guides",
  description:
    "How to import an old logbook from CSV, scan paper pages, log circuits, read your currency, and track medicals, PPC/PCC and recurrent training in Pilot Logbook.",
  alternates: { canonical: "/help" },
  openGraph: {
    title: "Pilot Logbook — Help & guides",
    description:
      "Short answers to the questions pilots ask: importing an old logbook, scanning paper pages, logging circuits, currency, and document reminders.",
    url: "/help",
  },
};

export default function HelpPage() {
  return (
    <>
      {/* The guides double as FAQ rich results, and give AI answer engines
          clean Q&A pairs about how the product actually works. */}
      <JsonLd
        data={[
          helpFaqPageLd(),
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Help", path: "/help" },
          ]),
        ]}
      />
      <Help />
    </>
  );
}
