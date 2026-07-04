// Cookie-based session. This is a convenience gate for a personal tool, NOT a
// security boundary — the cookie simply names the current user. Real server
// auth (signed sessions, hashing at rest) is a follow-up.

import { cookies } from "next/headers";

export const SESSION_COOKIE = "plb_user";

export async function getSessionUser(): Promise<string | null> {
  const store = await cookies();
  const c = store.get(SESSION_COOKIE);
  return c?.value || null;
}

export async function setSessionUser(username: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, username, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearSessionUser(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
