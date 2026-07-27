// Demo-session flag — the switch that puts the app into demo mode.
//
// Deliberately sessionStorage, not localStorage: a demo lasts for the tab it
// was opened in and disappears when the visitor closes it, so it can never be
// mistaken for (or linger over) a real signed-in session on a shared machine.
//
// Demo mode is read once at DataContext boot; nothing in demo mode is ever
// persisted to the local mirror or the cloud.

const KEY = "plb_demo";

export function isDemoSession(): boolean {
  if (typeof window === "undefined") return false; // prerender
  try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function enterDemoSession(): void {
  try { sessionStorage.setItem(KEY, "1"); } catch { /* ignore */ }
}

export function exitDemoSession(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
