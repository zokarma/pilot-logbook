import type { Metadata } from "next";
import "./globals.css";
import { DataProvider } from "@/context/DataContext";

export const metadata: Metadata = {
  title: "Pilot Logbook",
  description: "Offline-friendly flight time tracking",
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
