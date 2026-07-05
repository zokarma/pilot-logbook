"use client";

// Client-side redirect to /logger. (A server `redirect()` isn't supported under
// `output: "export"`, which we need for the Capacitor native build.)
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/logger");
  }, [router]);
  return null;
}
