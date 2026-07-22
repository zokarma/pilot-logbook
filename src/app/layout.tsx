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
        <DataProvider>{children}</DataProvider>
      </body>
    </html>
  );
}
