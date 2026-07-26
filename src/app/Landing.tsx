"use client";

// Public marketing landing page served at the site root (pilotlogbook.ca "/").
// Self-contained CRO surface: all styling is scoped under `.lp` (landing.css)
// so it can't touch the app shell, and it follows the viewer's theme via the
// app's data-theme system. The two primary conversion paths the page drives are
// the app itself (`/dashboard`) and the plans page (`/pricing`); auth lives on
// its own URL (`/login`).
//
// The native (Capacitor) shell also boots at "/", so on that platform we skip
// the marketing page entirely and send the pilot straight to their logbook —
// preserving the pre-existing `/` → `/logger` behavior. A pre-paint script in
// the root layout stamps `data-native` to hide this page before it can flash;
// the effect below performs the actual SPA redirect.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/context/DataContext";
import { isNativeApp } from "@/lib/native";

const APP_HREF = "/dashboard"; // the app opens on the dashboard
const PRICING_HREF = "/pricing";
const LOGIN_HREF = "/login";

/* ---------------- inline icons ---------------- */
const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);
const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

const FEATURES: { title: string; body: string; icon: React.ReactNode }[] = [
  { title: "AI logbook scanning", body: "Photograph a paper page and AI fills in every flight — dates, aircraft, routes, hours, crew.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" /></svg> },
  { title: "Currency & duty", body: "Day/night recency, IFR approaches, and 703/704/705 duty limits tracked automatically.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5" /><path d="M9 2h6" /></svg> },
  { title: "Document reminders", body: "Medicals, ratings, and recurrent training with Transport Canada expiry math built in.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg> },
  { title: "Yours, offline & exportable", body: "Works in the air with no signal, syncs everywhere, and exports to CSV or a TC-style PDF anytime.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> },
];

const STEPS: { title: string; body: string }[] = [
  { title: "Create your free account", body: "Sign up in seconds — no credit card. Your logbook is yours to keep, forever." },
  { title: "Snap or import your flights", body: "Photograph paper pages, import a CSV, or log by hand. Everything lands in one place." },
  { title: "Fly current, stay compliant", body: "Your dashboard tracks totals, currency, duty, and document expiries in real time." },
];

export default function Landing() {
  const router = useRouter();
  const { ready, currentUser } = useData();

  // isNativeApp() and currentUser read window / client-only state, so resolve
  // them after mount — the prerendered HTML and first client render must agree
  // (no hydration mismatch). The marketing copy defaults to the logged-out CTA.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (isNativeApp()) {
      router.replace("/logger");
      return;
    }
    setMounted(true);
  }, [router]);

  // Auto-forward already-signed-in visitors straight into the app — the
  // marketing page is for logged-out visitors. Anonymous visitors stay put.
  // (mounted stays false in the native shell, so this never fights the
  // /logger redirect above.)
  const signedIn = mounted && ready && !!currentUser;
  useEffect(() => {
    if (signedIn) router.replace("/dashboard");
  }, [signedIn, router]);

  const appCta = "Get started — it’s free";

  // While a signed-in visitor is being redirected, render nothing so the
  // marketing page never flashes over their app.
  if (signedIn) return null;

  return (
    <div className="lp">
      {/* NAV */}
      <nav className="top">
        <div className="wrap inner">
          <div className="brand">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z" /></svg>
            <span>Pilot Logbook<small>pilotlogbook.ca</small></span>
          </div>
          <div className="nav-links">
            <a className="link" href="#features">Features</a>
            <a className="link" href="#how">How it works</a>
            <Link className="link" href={PRICING_HREF}>Pricing</Link>
            <Link className="link" href={LOGIN_HREF}>Log in</Link>
            <Link className="btn btn-primary btn-sm" href={APP_HREF}>Get started</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow">Pilot logbook · currency · duty · documents</p>
            <h1>Your logbook, <span className="accent">flown into the future.</span></h1>
            <p className="sub">Photograph your paper logbook and let AI fill it in. Then Pilot Logbook tracks your hours, currency, duty limits, and document expiries automatically — on every device, online or off.</p>
            <div className="hero-cta">
              <Link className="btn btn-primary btn-lg" href={APP_HREF}>{appCta} <Arrow /></Link>
              <Link className="btn btn-ghost btn-lg" href={PRICING_HREF}>See pricing</Link>
            </div>
            <div className="reassure">
              <span><Check /> Free to start</span>
              <span><Check /> No credit card</span>
              <span><Check /> Works offline</span>
            </div>
          </div>

          {/* dashboard preview mock */}
          <div className="preview" aria-hidden="true">
            <div className="screen-head">
              <span className="dots"><i></i><i></i><i></i></span>
              <span className="tag">Dashboard</span>
            </div>
            <div className="gauges">
              <div className="gauge"><div className="ring" style={{ "--p": 82 } as React.CSSProperties}><i>82%</i></div><b>Day current</b></div>
              <div className="gauge"><div className="ring" style={{ "--p": 64 } as React.CSSProperties}><i>64%</i></div><b>Night current</b></div>
              <div className="gauge"><div className="ring" style={{ "--p": 91 } as React.CSSProperties}><i>91%</i></div><b>IFR current</b></div>
            </div>
            <div className="stat-row">
              <div className="stat"><div className="n cy">1,248.6</div><div className="l">Total hours</div></div>
              <div className="stat"><div className="n">312</div><div className="l">Flights</div></div>
              <div className="stat"><div className="n">14</div><div className="l">Types flown</div></div>
            </div>
          </div>
        </div>

        {/* stat / trust bar */}
        <div className="statbar"><div className="wrap row">
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> Encrypted &amp; account-scoped</span>
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 3 21l9-4 9 4-2-8.5" /><circle cx="12" cy="8" r="6" /></svg> Works offline, in the air</span>
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg> Export to CSV &amp; TC-style PDF</span>
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="4" /></svg> Built around the CARs</span>
        </div></div>
      </header>

      {/* FEATURES */}
      <section id="features">
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow">Everything in one logbook</p>
            <h2>The whole picture of your flying</h2>
            <p>Log a flight once and Pilot Logbook does the rest — totals, recency, duty, and paperwork, kept current for you.</p>
          </div>
          <div className="feat-grid">
            {FEATURES.map((f) => (
              <div className="feat" key={f.title}>
                <div className="ic">{f.icon}</div>
                <h4>{f.title}</h4>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" style={{ paddingTop: 8 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow">Up and running in minutes</p>
            <h2>How it works</h2>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="step" key={s.title}>
                <div className="num">{i + 1}</div>
                <h4>{s.title}</h4>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLANS TEASER */}
      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow">Plans</p>
            <h2>Fly free. Upgrade when it earns its keep.</h2>
            <p>Start free and keep your logbook forever. Go Pro when you want it to fill itself in.</p>
          </div>
          <div className="plans">
            <div className="plan">
              <div className="p-name">Free</div>
              <div className="p-price"><span className="amt">$0</span><span className="per">/forever</span></div>
              <div className="p-tag">Everything you need to keep a proper logbook.</div>
              <Link className="btn btn-ghost p-cta" href={APP_HREF}>Start free</Link>
            </div>
            <div className="plan pop">
              <span className="ribbon">Most popular</span>
              <div className="p-name">Pro</div>
              <div className="p-price"><span className="amt">$10</span><span className="per">/month</span></div>
              <div className="p-tag">Backed up, syncing everywhere — with AI scanning.</div>
              <Link className="btn btn-primary p-cta" href={PRICING_HREF}>See Pro</Link>
            </div>
            <div className="plan">
              <div className="p-name">Professional</div>
              <div className="p-price"><span className="amt">$15</span><span className="per">/month</span></div>
              <div className="p-tag">For working pilots who live in their logbook.</div>
              <Link className="btn btn-ghost p-cta" href={PRICING_HREF}>See Professional</Link>
            </div>
          </div>
          <p className="plans-note">Prices in CAD. 14-day free trial on Pro &amp; Professional. <Link href={PRICING_HREF} style={{ color: "var(--cyan)" }}>Compare every feature &rarr;</Link></p>
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <div className="final">
            <p className="eyebrow" style={{ justifyContent: "center" }}>Ready when you are</p>
            <h2>Your next logbook entry could log itself.</h2>
            <p>Open the app to start logging in seconds, or see the plans to find the right fit. No card to start. Cancel anytime.</p>
            <div className="btns">
              <Link className="btn btn-primary btn-lg" href={APP_HREF}>{appCta} <Arrow /></Link>
              <Link className="btn btn-ghost btn-lg" href={PRICING_HREF}>See pricing</Link>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap cols">
          <p className="fine">Pilot Logbook keeps your flight records, currency, and documents in one place — with a paper trail you can export anytime. Currency and duty gauges are a reference aid; the CARs and your company minima always govern.</p>
          <nav aria-label="Footer">
            <Link className="link" href={PRICING_HREF}>Pricing</Link>
            <Link className="link" href={LOGIN_HREF}>Log in</Link>
            <Link className="link" href="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
