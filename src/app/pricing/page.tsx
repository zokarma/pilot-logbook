import type { Metadata } from "next";
import Pricing from "./Pricing";
import "./pricing.css";

export const metadata: Metadata = {
  title: "Pricing · Pilot Logbook",
  description:
    "Photograph your paper logbook and let AI fill it in. Free, Pro ($7/mo), and Professional ($10/mo) plans — 14-day free trial, scan your first 10 pages free.",
};

export default function PricingPage() {
  return <Pricing />;
}
