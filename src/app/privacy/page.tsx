import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy · Pilot Logbook",
  description: "How Pilot Logbook collects, stores, and handles your data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl card p-6 sm:p-8 my-6">
        <h1 className="text-2xl font-bold text-white mb-1">Privacy Policy</h1>
        <p className="text-sm text-slate-400 mb-6">Last updated: July 4, 2026</p>

        <div className="space-y-6 text-sm text-slate-300 leading-relaxed">
          <p>
            Pilot Logbook (&quot;the app&quot;) is a personal flight-logging tool. This policy
            explains what data we collect, how it&apos;s stored, and the choices you have. By
            creating an account you agree to this policy.
          </p>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">What we collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Account:</b> your email address and a password (used only to sign you in).</li>
              <li><b>Logbook data you enter:</b> flights, pilot profiles, duty days, and related notes.</li>
              <li><b>Bug reports (if you file one):</b> your description plus basic diagnostics (app version, current tab, browser/device info). Screenshots you attach stay on your device and are never uploaded.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">How it&apos;s stored</h2>
            <p>
              Your data is stored in our cloud database (Supabase) and mirrored to your device for
              offline use. Access is protected by Row Level Security, so <b>you can only ever read or
              write your own data</b> — no other user can access it. Authentication is handled by
              Supabase Auth.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">How we use it</h2>
            <p>
              We use your data solely to provide the app&apos;s features (storing and displaying your
              logbook, syncing across your devices, and responding to bug reports). We do <b>not</b>
              sell your data, and we do <b>not</b> share it with third parties for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Third-party services</h2>
            <p>
              We rely on Supabase (database, authentication) and Resend (sending account-confirmation
              emails). These providers process data only to deliver those functions on our behalf.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Deleting your account and data</h2>
            <p>
              You can permanently delete your account at any time from within the app
              (<b>Log&nbsp;Out menu → Delete account</b>). Deletion removes your account and all
              associated logbook data from our database. You may also email us to request deletion.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">Contact</h2>
            <p>
              Questions or deletion requests: <a href="mailto:privacy@pilotlogbook.ca" className="text-cyan-400 hover:text-cyan-300">privacy@pilotlogbook.ca</a>.
            </p>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-800">
          <Link href="/login" className="text-sm text-cyan-400 hover:text-cyan-300">← Back to Pilot Logbook</Link>
        </div>
      </div>
    </div>
  );
}
