// Help content — the single source for the /help page.
//
// Task-based, not feature-based: pilots arrive with "how do I get my paper
// logbook in?", not "tell me about the import subsystem". Every step here must
// describe behaviour that actually ships, using the real on-screen labels —
// evals/claims.eval.ts checks this file for claims the product can't back up,
// the same way it guards the pricing copy.
//
// Keep it framework-free so it can be asserted in evals.

export interface HelpStep {
  /** Imperative instruction. Use the exact button/menu label the pilot sees. */
  text: string;
}

export interface HelpTopic {
  id: string;
  question: string;
  /** One-line answer shown under the heading before the steps. */
  answer: string;
  steps?: string[];
  /** Shown as a subtle note under the steps (caveats, platform limits, plan). */
  note?: string;
  /** Marks a topic that needs a paid plan, so the page can badge it honestly. */
  pro?: boolean;
}

export interface HelpSection {
  id: string;
  title: string;
  blurb: string;
  topics: HelpTopic[];
}

export const HELP: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    blurb: "Set up once, then logging a flight takes seconds.",
    topics: [
      {
        id: "first-run",
        question: "What happens when I first sign up?",
        answer: "A two-step setup asks for your name and pilot role, then lets you add licences and medicals. Both steps can be skipped and changed later.",
        steps: [
          "Enter your name and pick your pilot role — this decides which gauges the dashboard shows you.",
          "Add your date of birth if you want medical expiry worked out automatically.",
          "Add documents now, or choose Skip for now and add them from the Documents page later.",
        ],
        note: "A short guided tour runs once afterwards. You can replay it any time from the profile menu → Settings → Take the tour.",
      },
      {
        id: "try-first",
        question: "Can I look around before signing up?",
        answer: "Yes. The live demo opens the real app loaded with a sample logbook — around 260 flights, documents and currency already filled in.",
        steps: [
          "Open the Live demo link from the top of any page.",
          "Click through anything — dashboard, flight logs, currency, route map.",
          "Nothing you change in the demo is saved, and it never touches a real account.",
        ],
      },
    ],
  },
  {
    id: "logging",
    title: "Logging flights",
    blurb: "The form remembers what it can so you type less.",
    topics: [
      {
        id: "log-a-flight",
        question: "How do I log a flight?",
        answer: "Open Flight Logs and use Add a Flight. The form pre-fills what it can from your last entry.",
        steps: [
          "Go to Flight Logs in the sidebar and click Add a Flight.",
          "From is pre-filled with where your last flight landed — change it if you repositioned.",
          "Type a registration you've flown before and the aircraft type fills itself in.",
          "Fill the hours, then Save.",
        ],
        note: "After saving, the form resets ready for the next leg, with From set to where this one landed.",
      },
      {
        id: "circuits",
        question: "How do I log circuits or multiple landings?",
        answer: "The Landing field has a ×N count beside it for the number of landings on that flight.",
        steps: [
          "Set Landing to Day or Night.",
          "Set the ×N box beside it to the number of landings — six circuits is ×6.",
          "Those landings count towards your takeoff/landing recency.",
        ],
        note: "Set Landing to None for a leg you were pilot monitoring — it then counts zero landings.",
      },
      {
        id: "quick-edit",
        question: "How do I fix a flight quickly?",
        answer: "Double-click any row in the flight table to edit it in place, or use Quick on the row.",
        steps: [
          "Double-click the row (or click Quick) to edit inline.",
          "Click Save on the row when done, or Cancel to discard.",
          "For bigger changes, use Edit to open the full form.",
        ],
      },
      {
        id: "bulk-edit",
        question: "Can I change many flights at once?",
        answer: "Yes — select rows with the checkboxes and use Bulk edit.",
        steps: [
          "Tick the checkbox on each row you want, or Shift-click to select a range.",
          "Click Bulk edit, tick the fields to change, and set the new values.",
          "Apply — every selected flight is updated.",
        ],
      },
      {
        id: "find-flights",
        question: "How do I find a particular flight?",
        answer: "Use the search box and date range above the flight table.",
        steps: [
          "Type a registration, airport, aircraft type or pilot name into the search box.",
          "Narrow further with the from/to date fields.",
          "Clear resets the filter and shows everything again.",
        ],
      },
      {
        id: "undo-delete",
        question: "I deleted a flight by mistake — can I get it back?",
        answer: "Yes. Deleting shows an Undo button for a few seconds that restores it exactly.",
        note: "If the Undo message has already gone, the flight is removed. Exports are a good habit for peace of mind.",
      },
    ],
  },
  {
    id: "import",
    title: "Bringing in an existing logbook",
    blurb: "Move years of history over without retyping it.",
    topics: [
      {
        id: "import-csv",
        question: "How do I import my old logbook from a CSV?",
        answer: "Flight Logs → Import CSV walks you through matching your file's columns to logbook fields.",
        steps: [
          "Export a CSV from your current logbook app or spreadsheet.",
          "Go to Flight Logs and click Import CSV, then choose the file.",
          "Check the column matches the wizard suggests and correct any it got wrong.",
          "Confirm — the flights are added to your logbook.",
        ],
        note: "The wizard remembers the layout of a file it has seen before, so re-importing the same export skips the matching step.",
      },
      {
        id: "import-shape",
        question: "What does my CSV need to contain?",
        answer: "At minimum a date and flight time. Aircraft type, registration, from/to and crew names are matched when present.",
        note: "Grouped Transport Canada style logbooks with multi-row headers are detected and handled differently from a flat spreadsheet — you don't need to flatten it first.",
      },
      {
        id: "duplicates",
        question: "Will importing twice duplicate my flights?",
        answer: "Scanned pages are checked against what you already have and flagged as Already in your logbook before you save. Review the list before confirming an import.",
      },
    ],
  },
  {
    id: "scanning",
    title: "Scanning paper pages",
    blurb: "Photograph a page instead of typing it out.",
    topics: [
      {
        id: "how-scan",
        question: "How does logbook scanning work?",
        answer: "You photograph or upload a page, the text is read for you, and a confirm sheet appears pre-filled with the flights it found.",
        steps: [
          "On Flight Logs, choose Scan Logbook (camera) or Upload (a photo or PDF).",
          "Review the confirm sheet — anything read with low confidence is highlighted.",
          "Fix anything that's wrong, then Confirm scan to save.",
        ],
        note: "Scans are never saved automatically. Nothing enters your logbook until you confirm it.",
        pro: true,
      },
      {
        id: "scan-plans",
        question: "Do I need a paid plan to scan?",
        answer: "Yes — scanning is a Pro feature on every platform, camera and upload alike. It's included in the 14-day Pro trial, so you can digitize a stack of paper before deciding.",
        // Careful: this is a PRIVACY statement, not a pricing one. Camera
        // captures staying on the device does NOT mean camera scanning is free
        // — ScanImport gates the whole scan UI (camera included) behind Pro.
        note: "On iPhone and iPad the camera capture is read on the device itself and never leaves it; uploads are the ones sent for cloud extraction.",
        pro: true,
      },
      {
        id: "scan-privacy",
        question: "What happens to the photo of my logbook?",
        answer: "Photos are used to read the flight details and are not kept — only the flight data you confirm is saved to your logbook.",
      },
    ],
  },
  {
    id: "currency",
    title: "Currency & recency",
    blurb: "See where you stand at a glance.",
    topics: [
      {
        id: "currency-red",
        question: "Why does everything say Not current?",
        answer: "The gauges are computed from your logged flights, so a new logbook with no flights reads as not current. Log or import flights and they update straight away.",
      },
      {
        id: "currency-works",
        question: "How is my currency worked out?",
        answer: "From the takeoffs, landings and approaches on your flights, over the windows in the Canadian Aviation Regulations.",
        steps: [
          "A flight with no landing count is treated as one takeoff and one landing.",
          "Day or night is taken from the flight's Takeoff and Landing fields.",
          "Instrument approaches come from the Approaches box on the flight form.",
        ],
        note: "These gauges are a reference aid. The CARs and your company minima always govern.",
      },
      {
        id: "custom-currency",
        question: "Can I track my own or my company's minima?",
        answer: "Yes — Currency → Add Rule creates your own rule, optionally limited to one aircraft type.",
        steps: [
          "Go to Currency and click Add Rule.",
          "Choose what to count, how many, and over how many days.",
          "Optionally restrict it to a single aircraft type.",
        ],
        pro: true,
      },
      {
        id: "hide-currency",
        question: "Can I hide gauges that don't apply to me?",
        answer: "Yes. Click Hide on any currency card and it disappears from this page and the dashboard widget. Show brings it back.",
      },
    ],
  },
  {
    id: "documents",
    title: "Documents & reminders",
    blurb: "Medicals, licences and recurrent checks, tracked to the day.",
    topics: [
      {
        id: "add-document",
        question: "How do I track a licence or medical?",
        answer: "Documents → + Add Document. Expiry is worked out for you where the rules allow it.",
        steps: [
          "Pick the document type — the form then asks for the dates that type needs.",
          "Choose Auto-calculate to have the expiry worked out, Manual date to type it in, or No expiry.",
          "Save — the document appears with its status and days remaining.",
        ],
        note: "Medical expiry uses Transport Canada validity based on your age at the exam date, so add your date of birth in your profile for it to calculate.",
      },
      {
        id: "ppc-pcc",
        question: "How do I track a PPC or PCC?",
        answer: "Add a Pilot Proficiency Check (PPC) or Pilot Competency Check (PCC) from the document list and enter the expiry printed on your check-ride form.",
        steps: [
          "Documents → + Add Document → Pilot Proficiency Check (PPC) or Pilot Competency Check (PCC).",
          "Enter the expiry date exactly as it appears on your form.",
          "It then appears on the Currency page alongside your recency gauges.",
        ],
        note: "These use a date you enter rather than a calculated one, because validity depends on the operation you fly — single or multi-crew, and the check you completed.",
      },
      {
        id: "reminders",
        question: "Will I be warned before something expires?",
        answer: "Yes. The bell in the top bar lists anything coming due, 30 days ahead by default.",
        steps: [
          "Click the bell in the top bar to see what's expiring.",
          "Change how far ahead you're warned, or turn categories off, in Settings.",
        ],
        note: "On iPhone and iPad you can also allow notifications to be reminded when the app isn't open.",
      },
    ],
  },
  {
    id: "exports",
    title: "Exports & backups",
    blurb: "Your logbook is yours — take a copy whenever you want.",
    topics: [
      {
        id: "export-csv",
        question: "How do I get a copy of my logbook?",
        answer: "Flight Logs → Export CSV downloads every flight as a spreadsheet.",
        note: "Worth doing occasionally as your own backup, and it's the file to keep if you ever move to something else.",
      },
      {
        id: "export-pdf",
        question: "Can I produce a printable logbook?",
        answer: "Yes — Export PDF produces a summary plus Transport Canada style logbook pages with running totals.",
        pro: true,
      },
    ],
  },
  {
    id: "sync",
    title: "Offline & devices",
    blurb: "Log a flight with no signal; it catches up later.",
    topics: [
      {
        id: "offline",
        question: "Does it work without a connection?",
        answer: "Yes. Your logbook is stored on the device, so you can log and edit with no signal. Changes sync when you're back online.",
      },
      {
        id: "devices",
        question: "Can I use it on my phone and my computer?",
        answer: "Yes. Sign in on iPhone, iPad and the web and your logbook is the same on each.",
        note: "If you edit the same flight on two devices while offline, the most recent edit wins — nothing is silently dropped.",
      },
    ],
  },
  {
    id: "account",
    title: "Account & plans",
    blurb: "Free is a complete logbook. Pro adds the time-savers.",
    topics: [
      {
        id: "whats-free",
        question: "What do I get on the free plan?",
        answer: "Unlimited flight logging, currency tracking, documents and reminders, the route map, CSV import and export, and sync across your devices.",
      },
      {
        id: "whats-pro",
        question: "What does Pro add?",
        answer: "AI scanning of paper pages and documents, the Transport Canada style PDF export, custom currency rules, and duty and rest tracking.",
      },
      {
        id: "cancel",
        question: "What happens to my logbook if I cancel?",
        answer: "It stays. You keep full access to your flights and can still export them — the Pro-only features simply switch off.",
      },
      {
        id: "delete-account",
        question: "How do I delete my account?",
        answer: "Profile menu → Settings → Delete account. It's permanent and removes your logbook data.",
        note: "Export a CSV first if you want to keep a copy.",
      },
    ],
  },
];

/** Every topic, flattened — used by the page and by the eval that guards it. */
export function allHelpTopics(): HelpTopic[] {
  return HELP.flatMap((s) => s.topics);
}
