"use client";

// /help — task-based guides for the public site.
//
// Content lives in src/lib/help.ts so the visible page and the FAQPage
// structured data are generated from one source (the same arrangement the
// pricing FAQs use), and so an eval can assert the copy stays truthful.
//
// Public on purpose: it answers the questions pilots actually search for, so
// it doubles as the site's organic-search surface.

import Link from "next/link";
import { HELP } from "@/lib/help";
import PublicAuthLinks from "@/components/PublicAuthLinks";

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

export default function Help() {
  return (
    <div className="hp">
      {/* NAV — same shape as the landing and pricing pages. */}
      <nav className="top">
        <div className="wrap inner">
          <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z" /></svg>
            <span>Pilot Logbook<small>pilotlogbook.ca</small></span>
          </Link>
          <div className="nav-links">
            <Link className="link" href="/">Home</Link>
            <Link className="link" href="/pricing">Pricing</Link>
            <Link className="link" href="/demo">Live demo</Link>
            <PublicAuthLinks>
              <Link className="btn btn-primary btn-sm" href="/dashboard">Start free</Link>
            </PublicAuthLinks>
          </div>
        </div>
      </nav>

      <header className="head">
        <div className="wrap">
          <p className="eyebrow">Help &amp; guides</p>
          <h1>How do I…?</h1>
          <p className="sub">
            Short answers to the things pilots actually ask — getting an old logbook in, logging circuits,
            reading your currency, and keeping medicals and checks from creeping up on you.
          </p>
          <div className="jump">
            {HELP.map((s) => (
              <a key={s.id} href={`#${s.id}`}>{s.title}</a>
            ))}
          </div>
        </div>
      </header>

      {HELP.map((section) => (
        <section key={section.id}>
          <div className="wrap">
            <h2 className="sec-title" id={section.id}>{section.title}</h2>
            <p className="sec-blurb">{section.blurb}</p>
            <div className="topics">
              {section.topics.map((t) => (
                <article className="topic" key={t.id} id={t.id}>
                  <h3>
                    {t.question}
                    {t.pro && <span className="pro-tag">PRO</span>}
                  </h3>
                  <p className="ans">{t.answer}</p>
                  {t.steps && (
                    <ol>
                      {t.steps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  )}
                  {t.note && <p className="note">{t.note}</p>}
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section>
        <div className="wrap">
          <div className="final">
            <h2>Still stuck?</h2>
            <p>
              The quickest way to see how something works is to try it on a logbook that&apos;s already full.
              Or report a problem from inside the app — the profile menu has Report Bug.
            </p>
            <div className="btns">
              <Link className="btn btn-primary btn-lg" href="/demo">Explore the live demo <Arrow /></Link>
              <Link className="btn btn-ghost btn-lg" href="/pricing">See plans</Link>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap cols">
          <p className="fine">
            Currency and duty gauges are a reference aid; the Canadian Aviation Regulations and your company
            minima always govern. Pilot Logbook is built for pilots flying in Canada.
          </p>
          <nav aria-label="Footer">
            <Link className="link" href="/">Home</Link>
            <Link className="link" href="/pricing">Pricing</Link>
            <Link className="link" href="/login">Log in</Link>
            <a className="link" href="mailto:support@403studio.ca">Contact</a>
            <Link className="link" href="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
