// Rolling buffer of the most recent JS errors, attached to bug reports.

export interface RecentError {
  t: string;
  kind: string;
  msg: string;
  extra: string;
}

const RECENT_ERRORS: RecentError[] = [];
let installed = false;

function log(kind: string, msg: unknown, extra?: string) {
  RECENT_ERRORS.push({
    t: new Date().toISOString(),
    kind,
    msg: String(msg || "").slice(0, 500),
    extra: extra ? String(extra).slice(0, 500) : "",
  });
  if (RECENT_ERRORS.length > 20) RECENT_ERRORS.shift();
}

export function installErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    log("error", e.message, `${e.filename || ""}:${e.lineno || ""}:${e.colno || ""}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: string } | string | undefined;
    log("promise-rejection", (reason && (typeof reason === "string" ? reason : reason.message)) || "");
  });
}

export function getRecentErrors(): RecentError[] {
  return RECENT_ERRORS.slice();
}
