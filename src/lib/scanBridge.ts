// Bridge to the native Scan plugin (ios/App/App/ScanPlugin.swift).
//
// The plugin is registered on the injected window.Capacitor bridge, so no
// @capacitor/core import is needed (the web bundle stays Capacitor-free).
// On the website these helpers report "unavailable" and the scan UI hides.

import { isNativeApp } from "./native";
import { ScanPluginResult } from "./scan";

// Why the on-device model is or isn't usable — surfaced in the confirm sheet.
export type AiReason =
  | "available"
  | "not-enabled"        // Apple Intelligence off in Settings
  | "model-downloading"  // enabled, model still downloading
  | "device-not-eligible"
  | "os-too-old"         // iOS < 26
  | "framework-missing"  // built against an SDK without FoundationModels
  | "unavailable";

export interface ScanAvailability {
  docCamera: boolean;
  appleIntelligence: boolean;
  aiReason: AiReason;
}

interface ScanPluginApi {
  availability(): Promise<ScanAvailability>;
  scan(options: { extract?: "flights" | "document" }): Promise<ScanPluginResult>;
}

function plugin(): ScanPluginApi | null {
  if (!isNativeApp()) return null;
  const cap = (window as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown> };
  }).Capacitor;
  return (cap?.Plugins?.Scan as ScanPluginApi | undefined) ?? null;
}

export async function scanAvailability(): Promise<ScanAvailability> {
  const p = plugin();
  if (!p) return { docCamera: false, appleIntelligence: false, aiReason: "unavailable" };
  try {
    const a = await p.availability();
    // aiReason ?? default guards an older native build that predates it.
    return { docCamera: a.docCamera, appleIntelligence: a.appleIntelligence, aiReason: a.aiReason ?? "unavailable" };
  } catch {
    return { docCamera: false, appleIntelligence: false, aiReason: "unavailable" };
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
