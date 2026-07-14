# Pilot Logbook — Ship Checklist

Work through top to bottom; each section unblocks the next.
(Last updated: 2026-07-12, v0.10.0)

## 1. Xcode (one-time, ~15 min)

- [ ] Drag `ios/App/App/PrivacyInfo.xcprivacy` into the **App** group in the
      project navigator (tick "App" target membership). The widget's copy is
      picked up automatically.
- [ ] **App Groups** capability on BOTH targets (Signing & Capabilities →
      + Capability → App Groups → `group.ca.pilotlogbook.app`):
  - [ ] App target
  - [ ] PilotLogbookWidgetExtension target
- [ ] Decide iPad: recommend iPhone-only for v1 → App target →
      General → Supported Destinations, remove iPad (reviewers WILL run it on
      an iPad otherwise).
- [ ] Build & run on the phone (picks up: scan upload + multi-page batching,
      duplicate flagging, OCR row/column fixes, widget deep links, route-map
      z-index fix, collapsed flight form).

## 2. On-device testing

- [ ] Log a flight → home-screen **Hours widget** updates.
- [ ] Tap **Log Flight widget** with the app killed → opens logger with the
      form auto-opened (cold-launch deep link).
- [ ] Lock-screen widget variants render (circular gauge / rectangular / inline).
- [ ] **Scan a filled logbook page** (Upload + one landscape photo of the whole
      two-page spread works best).
  - [ ] Rows come through with hours in the right columns.
  - [ ] "+ Scan next page" / "+ Add pages" batch flow works, single Save.
  - [ ] Re-scan the same page → rows flagged "Already in your logbook".
  - [ ] If accuracy is off: screenshot the "Raw scan data" panel and give it to
        Claude for parser tuning (this is the expected iteration loop).
- [ ] Route map no longer draws over the sidebar/top bar when scrolling.
- [ ] Delete-account flow reachable (Settings → Danger zone) — reviewers check.

## 3. App Store Connect — listing

- [ ] Register app: My Apps → + → bundle ID `ca.pilotlogbook.app`, name
      "Pilot Logbook" (backup name idea: "Pilot Logbook CA").
- [ ] Privacy questionnaire (must match the privacy manifest): collects
      **email address** + **user content** (flight records), linked to
      identity, NOT used for tracking; data deletable in-app.
- [ ] Privacy policy URL → the live `/privacy` page.
- [ ] Screenshots: 6.9" and 6.5" iPhone sizes. Good set: dashboard, logger,
      scan confirm sheet, route map, widget on home screen.
- [ ] Description, keywords, category (Productivity), support URL/email.
- [ ] Age rating questionnaire (all "no" → 4+).
- [ ] Create a **demo account** with a few flights; put credentials in App
      Review notes + note: "Scanning requires a physical device with a camera;
      on-device AI extraction requires iOS 26 with Apple Intelligence."

## 4. Upload & release

- [ ] Product → Archive → Distribute → App Store Connect.
      (Export compliance auto-answered — `ITSAppUsesNonExemptEncryption` is set.)
- [ ] Bump `CURRENT_PROJECT_VERSION` (build number) on every re-upload.
- [ ] TestFlight: install and run one full pass — sign up → onboard → log
      flight → scan → widget — before submitting.
- [ ] Submit for review (first reviews typically 1–3 days).

## Later / nice-to-have

- [ ] **Marketing home page** before the login screen (currently `/` redirects
      straight to the app): what the app does, screenshots, App Store badge,
      Sign Up / Log In buttons, and a footer link to `/privacy`. Native app
      should keep launching straight into the logbook.
- [ ] **403studio.ca**: upload the standalone privacy policy
      (`~/Desktop/pilot-logbook-privacy-policy.html`) or just link to
      `https://pilotlogbook.ca/privacy`; add a Pilot Logbook product blurb.

- [ ] OCR tuning round 2 with real raw-scan samples (Claude).
- [ ] iPad layout pass, then re-enable iPad destination.
- [ ] Duplicate guard for the CSV Import Wizard (scan sheet already has it).
- [ ] Consider bumping `MARKETING_VERSION` in lockstep with `APP_VERSION`
      for future releases.
