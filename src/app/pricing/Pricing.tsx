"use client";

// Public pricing / upgrade landing page. Self-contained marketing surface —
// all styling is scoped under `.pp` (pricing.css) so it can't touch the app
// shell, and it follows the viewer's theme via the app's data-theme system.
// CTAs point at the trial signup; wire them to real checkout when billing ships.

import Link from "next/link";
import { useState } from "react";

/* ---------------- inline icons (camelCased for JSX) ---------------- */
const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);
const Cross = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
);
const Plus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
);

const START_HREF = "/login"; // signup lives on the auth page; swap for checkout later

/* ---------------- feature data ---------------- */
type Cell = boolean | string;
const COMPARE: { label: string; free: Cell; pro: Cell; prof: Cell }[] = [
  { label: "Manual logbook", free: true, pro: true, prof: true },
  { label: "Flight totals & reports", free: true, pro: true, prof: true },
  { label: "Currency tracking", free: "Basic", pro: "Advanced alerts", prof: "Advanced alerts" },
  { label: "Cloud sync", free: "Limited", pro: "Unlimited", prof: "Unlimited" },
  { label: "Multiple devices", free: false, pro: true, prof: true },
  { label: "PDF export", free: "Basic", pro: "Professional", prof: "Professional" },
  { label: "Backup & restore", free: false, pro: true, prof: true },
  { label: "Aircraft database", free: true, pro: true, prof: true },
  { label: "Document expiry reminders", free: "Limited", pro: "Unlimited", prof: "Unlimited" },
  { label: "AI / OCR logbook scanning", free: false, pro: "Limited / month", prof: "Unlimited" },
  { label: "OCR licence & document scanning", free: false, pro: "Limited", prof: "Unlimited" },
  { label: "Airline roster import", free: false, pro: false, prof: true },
  { label: "Duty & rest analysis", free: false, pro: false, prof: true },
  { label: "Company reports & advanced analytics", free: false, pro: false, prof: true },
  { label: "iPhone, iPad & Mac apps", free: "Web", pro: "Web", prof: "All platforms" },
  { label: "Support", free: "Community", pro: "Email", prof: "Priority" },
];

const SPOTLIGHT: { title: string; body: string; icon: React.ReactNode }[] = [
  { title: "Unlimited AI scanning", body: "Digitize decades of paper in an afternoon. No monthly cap, no per-page counting.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" /></svg> },
  { title: "Airline roster import", body: "Pull your pairings straight in — block time logged before you're off the jet bridge.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3M16 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /></svg> },
  { title: "Company reports", body: "Export the exact summaries your operator and insurer ask for, formatted and ready.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg> },
  { title: "Advanced analytics", body: "Trends by type, role, and category — see your hours the way a hiring board will.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg> },
  { title: "Duty & rest analysis", body: "703/704/705 flight-time, FDP and rest gauges against the operation you actually fly.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5" /><path d="M9 2h6" /></svg> },
  { title: "iPhone, iPad & Mac", body: "Log from the cockpit, review on the couch. One account, every Apple device, always in sync.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg> },
];

const FAQS: { q: string; a: string }[] = [
  { q: "Do I need a credit card to start?", a: "No. Create a free account and start logging immediately, or begin a 14-day Pro trial and scan your first 10 pages free — no card until you decide to keep it." },
  { q: "What counts as a scan?", a: "One photographed logbook page. Pro includes a generous monthly allowance; Professional is unlimited, so you can digitize a lifetime of paper in one sitting." },
  { q: "Does it work offline?", a: "Yes. Your logbook is mirrored to your device, so you can log in the air with no signal. It syncs automatically the moment you're back online." },
  { q: "Is my logbook data safe?", a: "Your logbook is a legal document, and we treat it that way — encrypted, scoped to your account so no one else can read it, and yours to export as CSV or a Transport Canada-style PDF at any time." },
  { q: "Can I cancel anytime?", a: "Anytime, from your account. You keep every flight you've logged and simply drop back to the free plan — nothing is deleted." },
  { q: "Which devices are included?", a: "Free and Pro run in any browser and sync across devices. Professional adds the native iPhone, iPad, and Mac apps for cockpit-side logging and offline scanning." },
];

function cmpCell(v: Cell) {
  if (v === true) return <span className="yes"><Check /></span>;
  if (v === false) return <span className="no"><Cross /></span>;
  return v;
}

export default function Pricing() {
  const [annual, setAnnual] = useState(true);

  return (
    <div className="pp">
      {/* NAV */}
      <nav className="top">
        <div className="wrap inner">
          <div className="brand">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z" /></svg>
            <span>Pilot Logbook<small>pilotlogbook.ca</small></span>
          </div>
          <div className="nav-links">
            <a className="link" href="#pricing">Pricing</a>
            <a className="link" href="#compare">Compare</a>
            <a className="link" href="#faq">FAQ</a>
            <Link className="btn btn-primary btn-sm" href={START_HREF}>Start free trial</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow">AI logbook scanning · currency · duty</p>
            <h1>Stop typing your logbook. <span className="accent">Photograph it.</span></h1>
            <p className="sub">Snap a page and AI fills in every flight — dates, aircraft, routes, hours, crew. Then Pilot Logbook tracks your currency, duty limits, and document expiries automatically, on every device.</p>
            <div className="hero-cta">
              <Link className="btn btn-primary" href={START_HREF}>Start your 14-day free trial</Link>
              <a className="btn btn-ghost" href="#compare">See what&apos;s included</a>
            </div>
            <div className="reassure">
              <span><Check /> Scan your first 10 pages free</span>
              <span><Check /> No credit card to start</span>
              <span><Check /> Cancel anytime</span>
            </div>
          </div>

          {/* scanning device mock */}
          <div className="device" aria-hidden="true">
            <div className="screen-head">
              <span className="dots"><i></i><i></i><i></i></span>
              <span className="scan-tag"><i></i> Scanning page</span>
            </div>
            <div className="logsheet">
              <div className="beam"></div>
              <table className="log">
                <thead><tr><th>Date</th><th>Type</th><th>Reg</th><th>Route</th><th className="hrs">Hrs</th></tr></thead>
                <tbody>
                  <tr><td>2026-05-04</td><td>C172</td><td>C-GABC</td><td>CYNJ→CYPK</td><td className="hrs">1.2</td></tr>
                  <tr><td>2026-05-06</td><td>PA28</td><td>C-GXYZ</td><td>CYPK→CYNJ</td><td className="hrs">1.0</td></tr>
                  <tr><td>2026-05-11</td><td>DA40</td><td>C-FLYW</td><td>CYYZ→CYOW</td><td className="hrs">1.4</td></tr>
                  <tr><td>2026-05-18</td><td>C172</td><td>C-GABC</td><td>CYNJ→CYXX</td><td className="hrs">0.9</td></tr>
                  <tr><td>2026-05-23</td><td>BE76</td><td>C-GMEL</td><td>CYVR→CYYJ</td><td className="hrs">1.6</td></tr>
                </tbody>
              </table>
            </div>
            <div className="caption"><Check /> 5 flights read · review &amp; save</div>
          </div>
        </div>

        {/* trust bar */}
        <div className="trustbar"><div className="wrap row">
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> Encrypted &amp; account-scoped</span>
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 3 21l9-4 9 4-2-8.5" /><circle cx="12" cy="8" r="6" /></svg> Works offline, in the air</span>
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg> Export anytime — CSV &amp; TC-style PDF</span>
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="4" /></svg> Your logbook, your data</span>
        </div></div>
      </header>

      {/* PRICING */}
      <section id="pricing">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow">Plans</p>
            <h2>Fly free. Upgrade when it earns its keep.</h2>
            <p>Start free and keep your logbook forever. Go Pro when you want it to fill itself in.</p>
          </div>

          <div className="toggle-wrap">
            <div className="toggle" role="group" aria-label="Billing period">
              <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button>
              <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>Annual <span className="save-pill">2 MONTHS FREE</span></button>
            </div>
          </div>

          <div className="tiers">
            {/* FREE */}
            <div className="tier">
              <div className="t-name">Free</div>
              <div className="t-tag">Everything you need to keep a proper logbook.</div>
              <div className="price"><span className="amt">$0</span><span className="per">/forever</span></div>
              <div className="price-sub">No card, no expiry.</div>
              <Link className="btn btn-ghost btn-block cta" href={START_HREF}>Create free account</Link>
              <ul className="flist">
                <li><Check /> Unlimited manual flight logging</li>
                <li><Check /> Flight totals &amp; reports</li>
                <li><Check /> Basic currency tracking</li>
                <li><Check /> Aircraft database &amp; route map</li>
                <li><Check /> Basic PDF export</li>
              </ul>
            </div>

            {/* PRO */}
            <div className="tier pro">
              <span className="ribbon">Most popular</span>
              <div className="t-name">Pro</div>
              <div className="t-tag">Your logbook, backed up and syncing everywhere — with AI scanning.</div>
              <div className="price"><span className="amt">{annual ? "$5.83" : "$7"}</span><span className="per">/month</span></div>
              <div className="price-sub">{annual ? "$70 billed yearly — save $14." : "Billed monthly."}</div>
              <Link className="btn btn-primary btn-block cta" href={START_HREF}>Start 14-day free trial</Link>
              <ul className="flist">
                <li className="lead">Everything in Free, plus</li>
                <li><Check /> <b>AI logbook scanning</b> — photo → filled rows</li>
                <li><Check /> Licence &amp; document OCR</li>
                <li><Check /> <b>Unlimited</b> cloud sync &amp; multi-device</li>
                <li><Check /> Advanced currency &amp; expiry alerts</li>
                <li><Check /> Professional PDF export</li>
                <li><Check /> Backup &amp; restore</li>
              </ul>
            </div>

            {/* PROFESSIONAL */}
            <div className="tier">
              <div className="t-name">Professional</div>
              <div className="t-tag">For working pilots who live in their logbook.</div>
              <div className="price"><span className="amt">{annual ? "$8.33" : "$10"}</span><span className="per">/month</span></div>
              <div className="price-sub">{annual ? "$100 billed yearly — save $20." : "Billed monthly."}</div>
              <Link className="btn btn-ghost btn-block cta" href={START_HREF}>Start 14-day free trial</Link>
              <ul className="flist">
                <li className="lead">Everything in Pro, plus</li>
                <li><Check /> <b>Unlimited</b> AI scanning</li>
                <li><Check /> Airline roster import</li>
                <li><Check /> Company reports</li>
                <li><Check /> Advanced analytics</li>
                <li><Check /> Duty &amp; rest analysis</li>
                <li><Check /> iPhone, iPad &amp; Mac apps</li>
                <li><Check /> Priority support</li>
              </ul>
            </div>
          </div>
          <p className="cmp-note">Prices in USD. 14-day free trial on Pro &amp; Professional — cancel before it ends and you&apos;re never charged.</p>
        </div>
      </section>

      {/* COMPARE */}
      <section id="compare" style={{ paddingTop: 20 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow">Full comparison</p>
            <h2>Every feature, side by side</h2>
          </div>
          <div className="table-scroll">
            <table className="cmp">
              <thead>
                <tr><th>Feature</th><th>Free</th><th className="col-pro">Pro</th><th>Professional</th></tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{cmpCell(r.free)}</td>
                    <td className="col-pro">{cmpCell(r.pro)}</td>
                    <td>{cmpCell(r.prof)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cmp-note">Currency &amp; duty gauges are a reference aid — the CARs and your company minima always govern.</p>
        </div>
      </section>

      {/* PRO SPOTLIGHT */}
      <section style={{ paddingTop: 20 }}>
        <div className="wrap">
          <div className="spotlight">
            <div className="sec-head" style={{ marginBottom: 8, textAlign: "left", maxWidth: "none" }}>
              <p className="eyebrow">Professional</p>
              <h2>Built for the pilots who fly for a living</h2>
              <p style={{ maxWidth: "60ch" }}>When your logbook is a career record, not a hobby, Professional turns it into a working tool — unlimited scanning, roster import, and the analytics your chief pilot asks for.</p>
            </div>
            <div className="feat-grid">
              {SPOTLIGHT.map((f) => (
                <div className="feat" key={f.title}>
                  <div className="ic">{f.icon}</div>
                  <h4>{f.title}</h4>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow">Before you upgrade</p>
            <h2>Questions, answered</h2>
          </div>
          <div className="faq">
            {FAQS.map((f) => (
              <details className="qa" key={f.q}>
                <summary>{f.q} <span className="chev"><Plus /></span></summary>
                <div className="ans">{f.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <div className="final">
            <p className="eyebrow" style={{ justifyContent: "center" }}>14-day free trial</p>
            <h2>Your next logbook entry could log itself.</h2>
            <p>Start free, scan your first 10 pages on us, and see your paper logbook fill itself in. No card to start. Cancel anytime.</p>
            <div className="btns">
              <Link className="btn btn-primary" href={START_HREF}>Start your free trial</Link>
              <a className="btn btn-ghost" href="#pricing">Compare plans</a>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap cols">
          <p className="fine">Pilot Logbook keeps your flight records, currency, and documents in one place — with a paper trail you can export anytime. Currency and duty gauges are a reference aid; the CARs and your company minima always govern.</p>
          <nav aria-label="Footer">
            <a className="link" href="#pricing">Pricing</a>
            <a className="link" href="#faq">FAQ</a>
            <Link className="link" href="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
