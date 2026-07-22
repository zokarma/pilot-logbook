import type { Metadata } from "next";
import Landing from "./Landing";
import "./landing.css";

// The site root (pilotlogbook.ca) is the public marketing landing page. It
// drives visitors into the app (`/dashboard`) and to the plans (`/pricing`);
// the login screen lives on its own URL (`/login`). The native Capacitor shell
// also boots here and is redirected straight to `/logger` inside <Landing />.
export const metadata: Metadata = {
  title: "Pilot Logbook — Your logbook, flown into the future",
  description:
    "Photograph your paper logbook and let AI fill it in. Pilot Logbook tracks your hours, currency, duty limits, and document expiries automatically — on every device, online or off. Free to start.",
};

export default function Home() {
  return <Landing />;
}
