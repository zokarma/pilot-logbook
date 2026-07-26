// Eval #3 — offline mirror & local-only auth (src/lib/clientStore.ts + hash.ts).
//
// Two promises live in this module and both are load-bearing:
//   1. "A pilot is never locked out of a legal document." The localStorage
//      mirror is what a cold, offline launch renders, and `loadBase` is the
//      merge ancestor — if either throws or returns garbage, boot breaks or the
//      three-way merge loses edits.
//   2. "Bug-report screenshots never leave the browser." stripScreenshots is
//      the only thing standing between a screenshot and the cloud row.
// Local-only auth (no Supabase configured) is the third surface: PBKDF2-
// HMAC-SHA256 over a per-user salt, with in-place upgrade of every legacy
// digest shape (unsalted djb2, salted one-round SHA-256, salted djb2).

import {
  loadCache, saveCache, loadBase, saveBase, loadLastUser, saveLastUser, clearLastUser,
  stripScreenshots, mergeScreenshots, localSignup, localLogin, localSession, localLogout,
} from "../src/lib/clientStore";
import { hashStr } from "../src/lib/hash";
import { AppData, BugReport, emptyData } from "../src/lib/types";
import { Suite } from "./harness";
import { mkData, mkFlight, clone } from "./fixtures";

// Minimal localStorage stand-in. `throwOnSet` simulates a full/disabled store
// (Safari private mode, quota exceeded) — the app must survive it.
class MemStorage {
  m = new Map<string, string>();
  throwOnSet = false;
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void {
    if (this.throwOnSet) throw new Error("QuotaExceededError");
    this.m.set(k, String(v));
  }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  dump(): string { return JSON.stringify([...this.m.entries()]); }
}

const g = globalThis as unknown as { localStorage?: MemStorage; crypto: Crypto };

function withReport(id: string, shot: string): BugReport {
  return {
    id,
    username: "amelia",
    created_at: "2026-07-01T00:00:00.000Z",
    status: "open",
    severity: "normal",
    description: "desc-" + id,
    steps: "",
    tab: "logger",
    url: "/logger",
    user_agent: "evals",
    viewport: "390x844",
    app_version: "0.15.0",
    app_state: {},
    recent_errors: [],
    screenshot: shot,
  };
}

export async function run(): Promise<Suite> {
  const s = new Suite(3, "Offline mirror & local auth (clientStore.ts)", "A pilot must never be locked out of their logbook, and screenshots must never reach the cloud.");
  const store = new MemStorage();
  const priorStorage = g.localStorage;
  g.localStorage = store;

  try {
    /* ------------------------- the offline mirror ------------------------- */
    const data = mkData({ flights: [mkFlight("f1"), mkFlight("f2", { date: "2026-07-02" })] });
    saveCache("u1", data);
    s.eq("mirror round-trips the logbook", loadCache("u1"), data);
    s.check("mirror is per-user (another uid sees nothing)", loadCache("u2") === null);

    store.m.set("plb_cache_bad", "{not json");
    s.check("corrupt mirror reads as null instead of throwing (boot survives)", loadCache("bad") === null);

    store.throwOnSet = true;
    let threw = false;
    try { saveCache("u1", data); } catch { threw = true; }
    s.check("a full/disabled store never throws out of saveCache", !threw);
    store.throwOnSet = false;

    /* ------------------------ the merge ancestor -------------------------- */
    s.check("absent base reads as null (first sync degrades to a union)", loadBase("u9") === null);

    saveBase("u1", { data, updatedAt: "2026-07-01T10:00:00.000Z" });
    const base = loadBase("u1")!;
    s.check("base round-trips with its freshness token", base.updatedAt === "2026-07-01T10:00:00.000Z");
    s.eq("base data round-trips", base.data.flights.map((f) => f.id), ["f1", "f2"]);

    {
      // A base written by an older app version, stored pre-migration. If it came
      // back un-normalized, every field migrate adds would look locally-edited
      // and win the next merge.
      const legacy = {
        flights: [{ id: "old1", year: "2025", month: "3", day: "4", civilIdent: "c-gxyz", se: 1 }],
      } as unknown as AppData;
      saveBase("legacy", { data: legacy, updatedAt: null });
      const got = loadBase("legacy")!;
      s.check("a legacy base is migrated on load (date derived)", got.data.flights[0].date === "2025-03-04");
      // migrate copies civilIdent verbatim; syncFlightMirrors is what uppercases
      // it later, so the ancestor must hold the value migrate would produce.
      s.check("a legacy base is migrated on load (registration derived from civilIdent)", got.data.flights[0].registration === "c-gxyz");
      s.check("migrated base gains the fields added since it was written", Array.isArray(got.data.fleet) && Array.isArray(got.data.currencyRules));
    }

    store.m.set("plb_base_bad", "]]not json[[");
    s.check("corrupt base reads as null (sync degrades, never crashes)", loadBase("bad") === null);

    /* ---------------------- remembered user (cold boot) ------------------- */
    s.check("no remembered user before a sign-in", loadLastUser() === null);
    saveLastUser({ uid: "uid-1", email: "pilot@example.com" });
    s.eq("remembered user round-trips (mirror-first boot)", loadLastUser(), { uid: "uid-1", email: "pilot@example.com" });
    clearLastUser();
    s.check("sign-out forgets the remembered user", loadLastUser() === null);
    store.m.set("plb_last_user", "{broken");
    s.check("corrupt remembered user reads as null", loadLastUser() === null);
    store.m.delete("plb_last_user");

    /* ------------------- screenshots never leave the browser -------------- */
    {
      const withShots = mkData({
        flights: [mkFlight("f1")],
        bugReports: [withReport("b1", "data:image/png;base64,AAAA"), withReport("b2", "data:image/png;base64,BBBB")],
      } as Partial<AppData>);
      const original = clone(withShots);
      const stripped = stripScreenshots(withShots);

      s.check("every screenshot is blanked before a cloud write", stripped.bugReports.every((b) => b.screenshot === ""));
      s.check("no screenshot payload survives anywhere in the serialized cloud row", !JSON.stringify(stripped).includes("base64,AAAA"));
      s.eq("stripping does not mutate the in-memory state", withShots, original);
      s.eq("the rest of the report is preserved", stripped.bugReports.map((b) => [b.id, b.description]), [["b1", "desc-b1"], ["b2", "desc-b2"]]);
      s.eq("state with no bugReports strips to an empty list", stripScreenshots(emptyData()).bugReports, []);

      const server = clone(stripped);
      const remerged = mergeScreenshots(server, withShots);
      s.eq("screenshots are re-attached from the local cache by id", remerged.bugReports.map((b) => b.screenshot), ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"]);

      const serverPlusNew = clone(stripped);
      serverPlusNew.bugReports.push(withReport("b3", ""));
      const merged2 = mergeScreenshots(serverPlusNew, withShots);
      s.check("a report this device never saw keeps its empty screenshot", merged2.bugReports.find((b) => b.id === "b3")!.screenshot === "");
      s.eq("null cache leaves the server state untouched", mergeScreenshots(clone(stripped), null).bugReports.map((b) => b.screenshot), ["", ""]);
      s.eq("strip → merge is lossless for this device", mergeScreenshots(clone(stripped), withShots).bugReports, original.bugReports);
    }

    /* --------------------- local-only fallback auth ----------------------- */
    {
      store.m.delete("plb_local_users");
      const signup = await localSignup("amelia", "hunter2-correct-horse");
      s.check("signup succeeds on a fresh device", !signup.error);
      s.check("signup opens a session", localSession() === "amelia");
      s.check("signup seeds an empty logbook for the new user", !!loadCache("amelia") && loadCache("amelia")!.flights.length === 0);

      const users = JSON.parse(store.getItem("plb_local_users")!) as Record<string, { pass: string; salt?: string; scheme?: string; iterations?: number }>;
      s.check("the password is never stored in plaintext", !store.dump().includes("hunter2-correct-horse"));
      s.check("the stored digest is salted", !!users.amelia.salt && users.amelia.salt.length >= 16);
      s.check("the digest is SHA-256, not the legacy djb2", users.amelia.pass.length === 64 && users.amelia.pass !== hashStr("hunter2-correct-horse"));
      // A KDF, not a bare hash: a stolen digest must not fall to a wordlist in
      // seconds. The explicit scheme tag is what lets the verifier tell the
      // hashing schemes apart instead of guessing (see the probe below).
      s.check("the record records its hashing scheme", users.amelia.scheme === "pbkdf2-sha256");
      s.check("PBKDF2 runs a real work factor", (users.amelia.iterations ?? 0) >= 100_000);

      const dup = await localSignup("amelia", "another");
      s.check("a duplicate username is refused (no silent overwrite)", dup.error === "Username already exists. Try logging in.");
      s.check("the refused signup left the original digest intact", (JSON.parse(store.getItem("plb_local_users")!) as typeof users).amelia.pass === users.amelia.pass);

      localLogout();
      s.check("logout clears the session", localSession() === null);

      s.check("wrong password is refused", (await localLogin("amelia", "wrong")).error === "Incorrect password.");
      s.check("a failed login does not open a session", localSession() === null);
      s.check("unknown user gets the signup hint", (await localLogin("nobody", "x")).error === "No such user. Please sign up.");
      s.check("correct password logs in", !(await localLogin("amelia", "hunter2-correct-horse")).error);
      s.check("successful login opens the session", localSession() === "amelia");

      await localSignup("bertrand", "hunter2-correct-horse");
      const both = JSON.parse(store.getItem("plb_local_users")!) as typeof users;
      s.check("two users sharing a password get different digests (per-user salt)", both.amelia.pass !== both.bertrand.pass);
    }

    /* ------------- legacy (unsalted djb2) records upgrade in place -------- */
    {
      store.m.set("plb_local_users", JSON.stringify({ oldtimer: { pass: hashStr("legacy-pass") } }));
      s.check("a legacy record rejects a wrong password", (await localLogin("oldtimer", "nope")).error === "Incorrect password.");
      s.check("a rejected legacy login is NOT upgraded", !(JSON.parse(store.getItem("plb_local_users")!) as Record<string, { salt?: string }>).oldtimer.salt);

      s.check("a legacy record still logs in with the right password", !(await localLogin("oldtimer", "legacy-pass")).error);
      const upgraded = (JSON.parse(store.getItem("plb_local_users")!) as Record<string, { pass: string; salt?: string; scheme?: string }>).oldtimer;
      s.check("the legacy record is upgraded to a salted PBKDF2 digest in place",
        !!upgraded.salt && upgraded.scheme === "pbkdf2-sha256" && upgraded.pass.length === 64 && upgraded.pass !== hashStr("legacy-pass"));
      s.check("the upgraded record accepts the same password on the next login", !(await localLogin("oldtimer", "legacy-pass")).error);
      s.check("the upgraded record still rejects the wrong password", (await localLogin("oldtimer", "nope")).error === "Incorrect password.");
    }

    /* ---- salted one-round SHA-256 (the previous scheme) also upgrades ----- */
    {
      // Written by the version before PBKDF2: salt present, no scheme tag.
      const salt = "0123456789abcdef0123456789abcdef";
      const legacyDigest = Array.from(
        new Uint8Array(await g.crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + "sha-era-pass"))),
        (b: number) => b.toString(16).padStart(2, "0"),
      ).join("");
      store.m.set("plb_local_users", JSON.stringify({ shaera: { pass: legacyDigest, salt } }));

      s.check("a salted-SHA256 record rejects a wrong password", (await localLogin("shaera", "nope")).error === "Incorrect password.");
      s.check("a salted-SHA256 record logs in with the right password", !(await localLogin("shaera", "sha-era-pass")).error);
      const up = (JSON.parse(store.getItem("plb_local_users")!) as Record<string, { pass: string; scheme?: string }>).shaera;
      s.check("it is rehashed to PBKDF2 in place", up.scheme === "pbkdf2-sha256" && up.pass !== legacyDigest);
      s.check("and still accepts the same password afterwards", !(await localLogin("shaera", "sha-era-pass")).error);
    }

    /* ------------------------------ hash.ts ------------------------------- */
    s.check("hashStr is deterministic (unknown-airport coords don't jitter)", hashStr("CXYZ") === hashStr("CXYZ"));
    s.check("hashStr separates similar inputs", hashStr("CXYZ") !== hashStr("CXYY"));
    s.check("hashStr is unsigned/stable in shape", /^\d+$/.test(hashStr("")));

    /* ------------------------------- probes ------------------------------- */
    {
      // crypto.subtle only exists in a secure context. Signup there used to
      // write a salted *djb2* digest indistinguishable from a salted SHA-256
      // one, which locked the account out for good once the app was served
      // over https. Now signup refuses outright rather than creating an
      // account it can never verify.
      const realCrypto = g.crypto;
      Object.defineProperty(globalThis, "crypto", {
        value: { getRandomValues: (b: Uint8Array) => realCrypto.getRandomValues(b) },
        configurable: true, writable: true,
      });
      store.m.delete("plb_local_users");
      const insecureSignup = await localSignup("insecure", "same-password");
      const wroteRecord = !!store.getItem("plb_local_users") &&
        Object.keys(JSON.parse(store.getItem("plb_local_users")!)).length > 0;
      Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true, writable: true });

      s.check("signup in an insecure context is refused, not silently weakened", !!insecureSignup.error);
      s.check("...and no unverifiable account is left behind", !wroteRecord);

      // A salted djb2 digest already on disk from that old path still logs in
      // and gets rehashed — nobody is stranded by the fix.
      const oldSalt = "fedcba9876543210fedcba9876543210";
      store.m.set("plb_local_users", JSON.stringify({
        stranded: { pass: hashStr(oldSalt + ":" + "rescue-me"), salt: oldSalt },
      }));
      s.check("a salted-djb2 record written over http can still log in", !(await localLogin("stranded", "rescue-me")).error);
      const rescued = (JSON.parse(store.getItem("plb_local_users")!) as Record<string, { scheme?: string }>).stranded;
      s.check("...and is rehashed to PBKDF2", rescued.scheme === "pbkdf2-sha256");
    }

    s.probe(
      "local-only mode security model",
      "passwords are now PBKDF2-HMAC-SHA256 (210k iterations, per-user salt), so a stolen digest resists a wordlist — but the logbook itself still sits unencrypted in localStorage, so the gate remains an offline convenience rather than protection against someone holding the device. The cloud path (Supabase Auth + RLS) is the real security boundary.",
    );
    s.probe(
      "mirror eviction",
      "loadCache/loadBase treat a missing key and a browser-evicted key identically (null). After eviction the next sync degrades to a base-less union rather than losing edits, but a delete made offline on that device would resurrect — the eviction case is invisible to the app.",
    );

    return s;
  } finally {
    if (priorStorage) g.localStorage = priorStorage;
    else delete g.localStorage;
  }
}
