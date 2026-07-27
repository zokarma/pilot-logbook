"use client";

// Auth affordance for the public pages (/, /pricing, /help).
//
// The marketing site used to force signed-in visitors into the app the moment
// they touched "/", which made the site unbrowsable once you had an account —
// clicking "Home" from Help dumped you in your logbook. Instead the pages stay
// put and simply offer the right door: "Open my logbook" when you're signed in,
// "Log in" + the page's own CTA when you're not.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useData } from "@/context/DataContext";

/**
 * True once we're mounted AND the session has resolved. Deliberately false
 * during prerender and the first client render so the static HTML and the
 * hydrated markup agree (the logged-out state is the prerendered one).
 */
export function useSignedIn(): boolean {
  const { ready, currentUser } = useData();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && ready && !!currentUser;
}

/** `children` is the page's own logged-out CTA — hidden once signed in. */
export default function PublicAuthLinks({ children }: { children?: ReactNode }) {
  const signedIn = useSignedIn();

  if (signedIn) {
    return (
      <Link className="btn btn-primary btn-sm" href="/dashboard">
        Open my logbook
      </Link>
    );
  }
  return (
    <>
      <Link className="btn btn-ghost btn-sm" href="/login">Log in</Link>
      {children}
    </>
  );
}
