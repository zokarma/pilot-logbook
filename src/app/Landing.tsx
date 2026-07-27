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
const DEMO_HREF = "/demo";     // real app, seeded sample data, no sign-up
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
  { title: "AI logbook scanning", body: "Photograph a paper page and AI fills in every flight — dates, aircraft, routes, hours, crew. Included with Pro.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" /></svg> },
  { title: "Currency & duty", body: "Day/night recency and IFR approaches on every plan; 703/704/705 duty and rest gauges on Pro.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5" /><path d="M9 2h6" /></svg> },
  { title: "Document reminders", body: "Medicals, ratings, PPC/PCC and recurrent training — with Transport Canada expiry math built in.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg> },
  { title: "Yours, offline & exportable", body: "Works in the air with no signal, syncs everywhere, and exports to CSV or a TC-style PDF anytime.", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> },
];

// The same product at four stages of a licence — this is the "student to
// airline" promise made concrete. Each line must describe something that
// actually ships (see evals/claims.eval.ts).
const AUDIENCES: { title: string; body: string }[] = [
  { title: "Training", body: "Log circuits with the landings that count, watch dual and PIC time build, and keep your medical in view." },
  { title: "Building time", body: "Cross-country, night and instrument time totalled automatically, with a route map of everywhere you've been." },
  { title: "Commercial", body: "Duty and rest gauges for the 703/704/705 operation you fly, plus PPC/PCC and recurrent training tracked to the day." },
  { title: "Airline", body: "Multi-crew legs, type-by-type totals, and a TC-style PDF whenever someone asks for your hours." },
];

const STEPS: { title: string; body: string }[] = [
  { title: "Look around the demo", body: "Open a sample logbook with no sign-up and click through everything. When you're ready, create a free account." },
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

  const appCta = "Start free";
  const demoCta = "Explore the live demo";

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
            <a className="link" href="#who">Who it&apos;s for</a>
            <Link className="link" href={PRICING_HREF}>Pricing</Link>
            {/* Returning pilots need one obvious way back in from any public
                page — a button, not a text link lost among the section jumps. */}
            <Link className="btn btn-ghost btn-sm" href={LOGIN_HREF}>Log in</Link>
            <Link className="btn btn-primary btn-sm" href={DEMO_HREF}>Live demo</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="eyebrow">Pilot logbook · currency · duty · documents</p>
            <h1>Every hour you fly, <span className="accent">in one logbook.</span></h1>
            <p className="sub">From your first circuit to your last leg of the month — hours, currency, duty and document expiries, all kept current for you. Works on your phone and the web, in the air or out of signal.</p>
            <div className="hero-cta">
              <Link className="btn btn-primary btn-lg" href={DEMO_HREF}>{demoCta} <Arrow /></Link>
              <Link className="btn btn-ghost btn-lg" href={APP_HREF}>{appCta}</Link>
            </div>
            <div className="reassure">
              <span><Check /> No sign-up to look around</span>
              <span><Check /> Free plan, no credit card</span>
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
          <span className="trust-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg> Private to your account</span>
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

      {/* WHO IT'S FOR — the same logbook grows with the licence. */}
      <section id="who" style={{ paddingTop: 8 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="eyebrow">Student to airline</p>
            <h2>One logbook for the whole career</h2>
            <p>You shouldn&apos;t have to start a new logbook every time your licence changes. Pilot Logbook shows what matters at each stage and keeps the rest out of the way.</p>
          </div>
          <div className="feat-grid">
            {AUDIENCES.map((a) => (
              <div className="feat" key={a.title}>
                <h4>{a.title}</h4>
                <p>{a.body}</p>
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
              <div className="p-name">Pro</div>
              <div className="p-price"><span className="amt">$10</span><span className="per">/month</span></div>
              <div className="p-tag">Unlimited AI scanning, duty limits, and pro exports.</div>
              <Link className="btn btn-primary p-cta" href={PRICING_HREF}>See Pro</Link>
            </div>
          </div>
          <p className="plans-note">Prices in CAD. 14-day free trial on Pro. <Link href={PRICING_HREF} style={{ color: "var(--cyan)" }}>Compare every feature &rarr;</Link></p>
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <div className="final">
            <p className="eyebrow" style={{ justifyContent: "center" }}>Ready when you are</p>
            <h2>Have a look before you sign up.</h2>
            <p>The demo is the real app, loaded with a sample logbook — click through the dashboard, currency and route map. Nothing to install, no card, no account.</p>
            <div className="btns">
              <Link className="btn btn-primary btn-lg" href={DEMO_HREF}>{demoCta} <Arrow /></Link>
              <Link className="btn btn-ghost btn-lg" href={APP_HREF}>{appCta}</Link>
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
