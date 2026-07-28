"use client";

// Public pricing / upgrade landing page. Self-contained marketing surface —
// all styling is scoped under `.pp` (pricing.css) so it can't touch the app
// shell, and it follows the viewer's theme via the app's data-theme system.
// Plan CTAs call startCheckout, which asks the create-checkout Edge Function
// for a Stripe Checkout Session and redirects to it (signed-out visitors are
// sent to /login first).

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isNativeApp } from "@/lib/native";
import { startCheckout, BillingPeriod } from "@/lib/checkout";
import type { Tier } from "@/lib/entitlement";
import { FAQS } from "@/lib/seo";
import PublicAuthLinks from "@/components/PublicAuthLinks";

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
// EVERY row here must be something the product actually does, and any row that
// differs between plans must correspond to a real gate in FEATURE_MIN_TIER.
// claims.eval.ts fails the build if this table drifts from the code.
type Cell = boolean | string;
const COMPARE: { label: string; free: Cell; pro: Cell }[] = [
  { label: "Manual logbook", free: true, pro: true },
  { label: "Flight totals & reports", free: true, pro: true },
  { label: "Route map", free: true, pro: true },
  { label: "Aircraft fleet manager", free: true, pro: true },
  { label: "Cloud sync across your devices", free: true, pro: true },
  { label: "Works offline", free: true, pro: true },
  { label: "CSV import & export", free: true, pro: true },
  { label: "Document expiry reminders", free: true, pro: true },
  { label: "Currency tracking", free: "Built-in CARs rules", pro: "+ your own custom rules" },
  // PDF export is gated end-to-end (logger routes non-subscribers to /pricing),
  // so there is no "basic" free PDF. Free export is CSV, on the row above.
  { label: "PDF export", free: false, pro: "TC-style logbook pages" },
  { label: "AI logbook scanning", free: false, pro: "Unlimited" },
  { label: "Document & licence scanning", free: false, pro: true },
  { label: "Duty & rest analysis (703/704/705)", free: false, pro: true },
  { label: "iPhone & iPad app", free: true, pro: true },
  { label: "Support", free: "Email", pro: "Email" },
];

const SPOTLIGHT: { title: string; body: string; icon: React.ReactNode }[] = [
  { title: "Unlimited AI scanning", body: "Digitize decades of paper in an afternoon. No monthly cap, no per-page counting.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" /></svg> },
  { title: "Duty & rest analysis", body: "703/704/705 flight-time, FDP and rest gauges against the operation you actually fly.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5" /><path d="M9 2h6" /></svg> },
  { title: "Your own currency rules", body: "Company and personal minima on top of the CARs built-ins — “3 landings in 90 days on type”.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> },
  { title: "TC-style PDF export", body: "Proper logbook pages with page, forward and grand totals — the format examiners expect.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg> },
  { title: "Document & licence scanning", body: "Photograph a medical or licence and the dates land in your document tracker automatically.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg> },
  { title: "Everything in Free, always", body: "Logging, totals, currency, route map, reminders and exports never go behind the paywall.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> },
];

// FAQ content lives in src/lib/seo.ts so the visible Q&A and the FAQPage
// structured data on this route stay in sync.

function cmpCell(v: Cell) {
  if (v === true) return <span className="yes"><Check /></span>;
  if (v === false) return <span className="no"><Cross /></span>;
  return v;
}

export default function Pricing() {
  const [annual, setAnnual] = useState(true);
  // Which plan button is mid-request, and the error to show if it fails. A
  // plan button that silently does nothing is a lost sale, so failures from
  // create-checkout surface here rather than only in the console.
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [checkoutErr, setCheckoutErr] = useState<{ plan: string; msg: string } | null>(null);

  // The native shell must never reach a purchase flow. /pricing is part of the
  // static bundle shipped inside the iOS app, so without this guard the app
  // contains a working Stripe checkout — selling digital goods outside In-App
  // Purchase, which Guideline 3.1.1 prohibits. Subscriptions are sold on the
  // website only; the app just honours the entitlement on the account.
  const router = useRouter();
  useEffect(() => {
    if (isNativeApp()) router.replace("/logger");
  }, [router]);

  async function buy(tier: Exclude<Tier, "free">) {
    const period: BillingPeriod = annual ? "year" : "month";
    setBusyPlan(tier);
    setCheckoutErr(null);
    const { error } = await startCheckout(tier, period);
    // On success the browser is already navigating away; only a failure
    // returns here with the page still mounted.
    if (error) { setCheckoutErr({ plan: tier, msg: error }); }
    setBusyPlan(null);
  }

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
            <Link className="link" href="/">Home</Link>
            <a className="link" href="#compare">Compare</a>
            <a className="link" href="#faq">FAQ</a>
            <Link className="link" href="/help">Help</Link>
            <Link className="link" href="/demo">Live demo</Link>
            {/* Same login affordance as the landing page — a returning pilot
                may well land straight here from a bookmark or a price search. */}
            <PublicAuthLinks>
              <Link className="btn btn-primary btn-sm" href={START_HREF}>Start free</Link>
            </PublicAuthLinks>
          </div>
        </div>
      </nav>

      {/* PAGE HEAD — /pricing is a decision page, not a second pitch. The
          product story lives on "/"; this page answers "which plan, and what
          exactly do I get?" as directly as possible. */}
      <header className="hero pp-head">
        <div className="wrap">
          <p className="eyebrow">Plans &amp; pricing</p>
          <h1>Pick a plan. <span className="accent">Change it whenever.</span></h1>
          <p className="sub">The free plan is a complete logbook you can keep forever. Pro adds the parts that save you time. Prices in CAD.</p>
          <div className="reassure">
            <span><Check /> Free plan, no card needed</span>
            <span><Check /> 14-day Pro trial</span>
            <span><Check /> Cancel anytime</span>
          </div>
        </div>

        {/* trust bar */}
        <div className="trustbar"><div className="wrap row">
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> Private to your account</span>
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 3 21l9-4 9 4-2-8.5" /><circle cx="12" cy="8" r="6" /></svg> Works offline, in the air</span>
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg> Export anytime — CSV &amp; TC-style PDF</span>
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="4" /></svg> Your logbook, your data</span>
        </div></div>
      </header>

      {/* PRICING */}
      <section id="pricing">
        <div className="wrap">
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
                <li><Check /> Currency tracking (CARs built-ins)</li>
                <li><Check /> Aircraft fleet &amp; route map</li>
                <li><Check /> Document expiry reminders</li>
                <li><Check /> CSV import &amp; export, basic PDF</li>
                <li><Check /> iPhone &amp; iPad app, works offline</li>
              </ul>
            </div>

            {/* PRO */}
            <div className="tier pro">
              <div className="t-name">Pro</div>
              <div className="t-tag">For pilots digitizing a career&apos;s worth of paper — and flying commercially.</div>
              <div className="price"><span className="amt">{annual ? "$8.33" : "$10"}</span><span className="per">/month</span></div>
              <div className="price-sub">{annual ? "$100 billed yearly — save $20." : "Billed monthly."}</div>
              <button type="button" className="btn btn-primary btn-block cta" disabled={busyPlan !== null} onClick={() => void buy("pro")}>
                {busyPlan === "pro" ? "Starting checkout…" : "Start 14-day free trial"}
              </button>
              {checkoutErr?.plan === "pro" && <p className="checkout-err" role="alert">{checkoutErr.msg}</p>}
              <ul className="flist">
                <li className="lead">Everything in Free, plus</li>
                <li><Check /> <b>Unlimited</b> AI logbook scanning</li>
                <li><Check /> Licence &amp; document scanning</li>
                <li><Check /> <b>Duty &amp; rest analysis</b> (703/704/705)</li>
                <li><Check /> Your own custom currency rules</li>
                <li><Check /> TC-style logbook PDF export</li>
              </ul>
            </div>
          </div>
          <p className="cmp-note">Prices in CAD. 14-day free trial on Pro — cancel before it ends and you&apos;re never charged.</p>
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
                <tr><th>Feature</th><th>Free</th><th className="col-pro">Pro</th></tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{cmpCell(r.free)}</td>
                    <td className="col-pro">{cmpCell(r.pro)}</td>
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
              <p className="eyebrow">Pro</p>
              <h2>Built for the pilots who fly for a living</h2>
              <p style={{ maxWidth: "60ch" }}>When your logbook is a career record, not a hobby, Pro turns it into a working tool — unlimited scanning, duty and rest gauges for the operation you actually fly, and exports in the format examiners expect.</p>
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
            <p>Start free and keep your logbook forever, or try Pro for 14 days and watch your paper logbook fill itself in. No card to start. Cancel anytime.</p>
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
            <Link className="link" href="/">Home</Link>
            <a className="link" href="#faq">FAQ</a>
            <Link className="link" href="/login">Log in</Link>
            <a className="link" href="mailto:support@403studio.ca">Contact</a>
            <Link className="link" href="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
