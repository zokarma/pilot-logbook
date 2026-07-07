// Bridge to the native Scan plugin (ios/App/App/ScanPlugin.swift).
//
// The plugin is registered on the injected window.Capacitor bridge, so no
// @capacitor/core import is needed (the web bundle stays Capacitor-free).
// On the website these helpers report "unavailable" and the scan UI hides.

import { isNativeApp } from "./native";
import { ScanPluginResult } from "./scan";

interface ScanPluginApi {
  availability(): Promise<{ docCamera: boolean; appleIntelligence: boolean }>;
  scan(options: { extract?: "flights" | "document" }): Promise<ScanPluginResult>;
}

function plugin(): ScanPluginApi | null {
  if (!isNativeApp()) return null;
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown> };
  }).Capacitor;
  return (cap?.Plugins?.Scan as ScanPluginApi | undefined) ?? null;
}

export async function scanAvailability(): Promise<{ docCamera: boolean; appleIntelligence: boolean }> {
  const p = plugin();
  if (!p) return { docCamera: false, appleIntelligence: false };
  try {
    return await p.availability();
  } catch {
    return { docCamera: false, appleIntelligence: false };
  }
}

// Presents the VisionKit document camera and resolves with OCR pages (plus a
// Foundation-Models extraction on Apple Intelligence devices). Rejects with
// "cancelled" if the pilot dismisses the camera.
export async function scanDocuments(extract: "flights" | "document"): Promise<ScanPluginResult> {
  const p = plugin();
  if (!p) throw new Error("Scanning requires the iOS app.");
  return p.scan({ extract });
}
