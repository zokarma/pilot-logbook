// Eval #21 — bug-report error capture (src/lib/recentErrors.ts).
// The rolling error buffer is attached to every bug report; it is how a pilot's
// "it crashed" turns into something diagnosable. Low stakes for flight data,
// but it must never grow unbounded or throw from inside an error handler.

import { installErrorCapture, getRecentErrors } from "../src/lib/recentErrors";
import { Suite } from "./harness";

type Handler = (e: unknown) => void;

export function run(): Suite {
  const s = new Suite(21, "Bug-report error capture (recentErrors.ts)", "Diagnostics for user-reported bugs; must stay bounded and never throw from a handler.");

  const g = globalThis as unknown as { window?: unknown };
  const prior = g.window;
  const handlers: Record<string, Handler[]> = {};

  s.eq("the buffer starts empty", getRecentErrors(), []);
  installErrorCapture();
  s.check("install without a window is a safe no-op (static export prerender)", getRecentErrors().length === 0);

  g.window = {
    addEventListener: (type: string, fn: Handler) => { (handlers[type] ||= []).push(fn); },
  };

  try {
    installErrorCapture();
    s.check("both global handlers are registered", handlers.error?.length === 1 && handlers.unhandledrejection?.length === 1);
    installErrorCapture();
    s.check("a second install is a no-op (no duplicate capture)", handlers.error.length === 1 && handlers.unhandledrejection.length === 1);

    const fireError = (msg: string, filename = "app.js", lineno = 12, colno = 3) =>
      handlers.error[0]({ message: msg, filename, lineno, colno });
    const fireRejection = (reason: unknown) => handlers.unhandledrejection[0]({ reason });

    fireError("boom");
    const [first] = getRecentErrors();
    s.check("a window error is captured", first?.kind === "error" && first.msg === "boom");
    s.check("the source location is recorded", first.extra === "app.js:12:3");
    s.check("the entry is timestamped in ISO form", !isNaN(Date.parse(first.t)) && first.t.endsWith("Z"));

    fireRejection(new Error("promise blew up"));
    fireRejection("bare string reason");
    fireRejection(undefined);
    const afterRejections = getRecentErrors();
    s.check("an Error rejection captures its message", afterRejections[1].kind === "promise-rejection" && afterRejections[1].msg === "promise blew up");
    s.check("a string rejection is captured verbatim", afterRejections[2].msg === "bare string reason");
    s.check("an undefined rejection is captured without throwing", afterRejections[3].kind === "promise-rejection" && afterRejections[3].msg === "");

    fireError("x".repeat(900), "y".repeat(900));
    const big = getRecentErrors().at(-1)!;
    s.check("a huge message is truncated to 500 chars", big.msg.length === 500);
    s.check("a huge source location is truncated to 500 chars", big.extra.length === 500);

    for (let i = 0; i < 30; i++) fireError("e" + i);
    const capped = getRecentErrors();
    s.check("the buffer is capped at 20 entries", capped.length === 20);
    s.check("the cap keeps the NEWEST errors (the ones near the crash)", capped.at(-1)!.msg === "e29" && capped[0].msg === "e10");

    const copy = getRecentErrors();
    copy.push({ t: "", kind: "injected", msg: "", extra: "" });
    s.check("getRecentErrors hands out a copy (a report can't corrupt the buffer)", getRecentErrors().length === 20);

    s.probe(
      "capture scope",
      "only window 'error' and 'unhandledrejection' are captured — React render errors swallowed by an error boundary, console.error calls, and failed Supabase/network responses never reach the buffer, so a sync failure a pilot reports as a bug arrives with an empty error list.",
    );
    s.probe(
      "buffer lifetime",
      "the buffer is module-level and in-memory: a hard reload or an app relaunch clears it, so a crash that reloads the page produces a report with no trace of what crashed. Persisting the last few entries to localStorage alongside the mirror would survive that.",
    );

    return s;
  } finally {
    if (prior !== undefined) g.window = prior;
    else delete g.window;
  }
}
