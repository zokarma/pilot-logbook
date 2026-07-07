// Detect the Capacitor shell. The bridge injects window.Capacitor into the
// webview at runtime, so this needs no @capacitor/core import (the web bundle
// must not depend on it). Call from effects/handlers — during prerender
// (window undefined) it returns false, so branch after mount to avoid
// hydration mismatches.
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}
