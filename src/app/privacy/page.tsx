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
        <h1 className="text-2xl font-bold text-white mb-1">Privacy Policy — Pilot Logbook</h1>
        <p className="text-sm text-slate-400 mb-6">Last updated: July 14, 2026</p>

        <div className="space-y-6 text-sm text-slate-300 leading-relaxed">
          <p>
            Pilot Logbook is built and published by 403 Studio. We understand the critical nature
            of flight deck data and are committed to maintaining the absolute confidentiality of
            your logs and duty metrics. This policy outlines how your data is handled.
          </p>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">1. Flight Data &amp; Privacy</h2>
            <p>
              Pilot Logbook allows you to log flight entries, block times, air times, landing
              counts, night calculations, duty tracking parameters, and aviation documents. Your
              flight logs are securely backed up on our Supabase server and can be accessed by PC
              or on your iOS device using your own credentials—which we do not have access to. We
              will <b>never</b> share, sell, or monetize your flight logs.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">2. Cloud Synchronization &amp; Accounts</h2>
            <p>
              By signing into your Pilot Logbook account on your iPhone or iPad, your logbook data
              is synchronized securely with our website database. This ensures your logs are backed
              up and accessible from any supported browser on PC or iOS devices.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">3. Device Permissions &amp; SDKs</h2>
            <p>
              Pilot Logbook requests camera access for one purpose only: scanning your paper
              logbook pages and aviation documents so you can import them without retyping.
              <b> Camera scanning is processed entirely on your device</b>—text recognition and AI
              extraction run locally, and camera captures are never uploaded to our servers or
              any third party. Only the entries you review and save become part of your logbook.
              The app does not request access to GPS Location Services, Contacts, or Microphone,
              and does not integrate any third-party behavioral tracking SDKs. If you add the home
              screen widget, your hour totals and next document expiry are stored on your device
              only.
            </p>
            <p className="mt-2">
              <b>Optional cloud AI extraction.</b> When you choose to upload a photo or PDF and
              enable AI-enhanced extraction (and always when scanning from the website, which has
              no on-device scanner), that file is transmitted over an encrypted connection to our
              processing service, which uses Anthropic&apos;s Claude API solely to extract the
              logbook or document fields. The file is processed transiently, is not used to train
              AI models, and is not retained by us after processing. This is opt-in on the app:
              if you never enable it, your images never leave your device.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">4. GDPR &amp; CCPA Rights</h2>
            <p>
              You have full control over your data. You can access, export, modify, or delete your
              account and all associated flight logs at any time directly through the app settings
              or by logging into your profile on our website.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white mb-2">5. Contact Information</h2>
            <p>
              If you have questions regarding data privacy on the flight deck, please contact us
              at: <a href="mailto:support@403studio.ca" className="text-cyan-400 hover:text-cyan-300">support@403studio.ca</a>
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
