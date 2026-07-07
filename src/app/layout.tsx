import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DataProvider } from "@/context/DataContext";

export const metadata: Metadata = {
  title: "Pilot Logbook",
  description: "Offline-friendly flight time tracking",
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
    <html lang="en">
      <body>
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
