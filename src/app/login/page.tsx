"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/context/DataContext";
import { isNativeApp } from "@/lib/native";

export default function LoginPage() {
  const { ready, currentUser, cloud, login, signup } = useData();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Set after mount (isNativeApp reads window) so the prerendered HTML and the
  // first client render agree — no hydration mismatch.
  const [native, setNative] = useState(false);
  useEffect(() => { setNative(isNativeApp()); }, []);

  useEffect(() => {
    if (ready && currentUser) router.replace("/logger");
  }, [ready, currentUser, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) return;
    setBusy(true);
    setMsg(null);
    const res = mode === "login" ? await login(identifier, password) : await signup(identifier, password);
    setBusy(false);
    if (res.error) {
      setMsg({ text: res.error, ok: false });
      return;
    }
    if (mode === "signup" && res.needsConfirmation) {
      setMsg({ text: "Account created — check your email to confirm, then log in.", ok: true });
      setMode("login");
      setPassword("");
      return;
    }
    // On success the auth listener sets currentUser and the effect redirects.
    router.replace("/logger");
  }

  const label = cloud ? "Email" : "Username";
  const inputType = cloud ? "email" : "text";
  const autoComplete = cloud
    ? mode === "login" ? "email" : "email"
    : "username";

  // In the Capacitor shell, drop the floating-card-on-a-page chrome — the
  // form sits directly on the app background like a native sign-in screen.
  const frameCls = native ? "w-full max-w-md p-6 fade-in" : "w-full max-w-md modal-card p-8 fade-in";
  const inputCls =
    "w-full px-3 border border-slate-700 rounded-lg focus:ring-2 focus:ring-brand-500 " +
    (native ? "py-3 text-base" : "py-2");

  return (
    <div className="min-h-screen flex items-center justify-center safe-screen">
      <div className={frameCls}>
        <div className="text-center mb-6">
          <div className={"mx-auto rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/40 flex items-center justify-center mb-3 " + (native ? "w-20 h-20" : "w-14 h-14")}>
            <svg xmlns="http://www.w3.org/2000/svg" className={native ? "w-11 h-11 text-white" : "w-8 h-8 text-white"} viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z" />
            </svg>
          </div>
          <h1 className={"font-bold text-white " + (native ? "text-3xl" : "text-2xl")}>Pilot Logbook</h1>
          <p className="text-sm text-slate-400 mt-1">
            {native ? "Your logbook, in your pocket" : cloud ? "Cloud-synced flight time tracking" : "Offline flight time tracking"}
          </p>
        </div>

        <div className="flex bg-slate-800/60 rounded-lg p-1 mb-5">
          <button
            onClick={() => { setMode("login"); setMsg(null); }}
            className={"flex-1 py-2 text-sm font-medium rounded-md " + (mode === "login" ? "bg-slate-700 text-white shadow-sm" : "text-slate-400")}
          >
            Log In
          </button>
          <button
            onClick={() => { setMode("signup"); setMsg(null); }}
            className={"flex-1 py-2 text-sm font-medium rounded-md " + (mode === "signup" ? "bg-slate-700 text-white shadow-sm" : "text-slate-400")}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{label}</label>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              type={inputType}
              autoComplete={autoComplete}
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={cloud ? 6 : 4}
              className={inputCls}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className={"w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg transition " + (native ? "py-3.5 text-base" : "py-2.5")}
          >
            {mode === "login" ? "Log In" : "Create Account"}
          </button>
        </form>

        <p className={"text-center text-sm mt-4 min-h-[1.25rem] " + (msg ? (msg.ok ? "text-emerald-400" : "text-red-400") : "")}>
          {msg?.text || ""}
        </p>
      </div>
    </div>
  );
}
