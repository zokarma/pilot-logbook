"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/context/DataContext";

export default function LoginPage() {
  const { ready, currentUser, login, signup } = useData();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && currentUser) router.replace("/logger");
  }, [ready, currentUser, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setMsg(null);
    const res = mode === "login" ? await login(username, password) : await signup(username, password);
    setBusy(false);
    if (res.error) {
      setMsg({ text: res.error, ok: false });
      return;
    }
    if (mode === "signup") setMsg({ text: "Account created! Logging you in…", ok: true });
    router.replace("/logger");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md modal-card p-8 fade-in">
        <div className="text-center mb-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/40 flex items-center justify-center mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Pilot Logbook</h1>
          <p className="text-sm text-slate-400 mt-1">Offline flight time tracking</p>
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
            <label className="block text-sm font-medium mb-1">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-brand-500"
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
              minLength={4}
              className="w-full px-3 py-2 border border-slate-700 rounded-lg focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
          >
            {mode === "login" ? "Log In" : "Create Account"}
          </button>
        </form>

        <p className={"text-center text-sm mt-4 min-h-[1.25rem] " + (msg ? (msg.ok ? "text-emerald-600" : "text-red-500") : "")}>
          {msg?.text || ""}
        </p>
      </div>
    </div>
  );
}
