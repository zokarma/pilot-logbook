// Demo logbook — the sample data behind /demo, so a visitor can explore a
// populated app without signing up. Pure and deterministic: same seed, same
// logbook every time, so the marketing screenshots, the dashboard gauges and
// the evals all agree.
//
// Dates are generated RELATIVE TO `today` so the currency gauges and document
// reminders always look alive (some current, one medical expiring soon) no
// matter when the page is visited. Nothing here is ever persisted — demo mode
// keeps it in memory only (see DataContext).

import { AppData, Flight, Pilot, PilotDocument, emptyData } from "./types";

// Small deterministic PRNG (mulberry32) — keeps the logbook varied but stable.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysBefore(today: Date, n: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

// A career arc: flight-school circuits → CPL cross-countries → charter turbine.
// Each phase supplies the aircraft, typical routes and leg length.
interface Phase {
  type: string;
  regs: string[];
  multi: boolean;
  routes: [string, string][];
  minH: number;
  maxH: number;
  role: string;
  /** fraction of legs flown at night */
  nightRate: number;
  /** fraction of legs that are IFR with approaches */
  ifrRate: number;
  /** fraction of legs that are circuit details (multiple landings) */
  circuitRate: number;
}

const PHASES: Phase[] = [
  {
    type: "C172", regs: ["C-GJKL", "C-GRMP"], multi: false, role: "Student",
    routes: [["CYNJ", "CYNJ"], ["CYNJ", "CYXX"], ["CYXX", "CYNJ"], ["CYNJ", "CYPK"], ["CYPK", "CYNJ"]],
    minH: 0.8, maxH: 1.6, nightRate: 0.08, ifrRate: 0, circuitRate: 0.45,
  },
  {
    type: "DA40", regs: ["C-GDAF", "C-FDAK"], multi: false, role: "Captain",
    routes: [["CYNJ", "CYKA"], ["CYKA", "CYLW"], ["CYLW", "CYXX"], ["CYXX", "CYYJ"], ["CYYJ", "CYCD"], ["CYCD", "CYNJ"]],
    minH: 1.1, maxH: 2.4, nightRate: 0.22, ifrRate: 0.35, circuitRate: 0.1,
  },
  {
    type: "DA42", regs: ["C-GTWN"], multi: true, role: "Captain",
    routes: [["CYNJ", "CYYF"], ["CYYF", "CYKA"], ["CYKA", "CYXS"], ["CYXS", "CYNJ"], ["CYNJ", "CYQQ"]],
    minH: 1.3, maxH: 2.6, nightRate: 0.3, ifrRate: 0.6, circuitRate: 0.05,
  },
  {
    type: "BE20", regs: ["C-GKAB", "C-FKAV"], multi: true, role: "First Officer",
    routes: [
      ["CYVR", "CYXS"], ["CYXS", "CYXT"], ["CYXT", "CYPR"], ["CYPR", "CYVR"],
      ["CYVR", "CYZT"], ["CYZT", "CYBL"], ["CYVR", "CYQQ"], ["CYQQ", "CYVR"],
      ["CYVR", "CYYF"], ["CYYF", "CYXC"], ["CYXC", "CYYC"],
    ],
    minH: 0.9, maxH: 2.8, nightRate: 0.32, ifrRate: 0.75, circuitRate: 0,
  },
];

// How many flights each phase contributes, oldest phase first.
const PHASE_COUNTS = [78, 52, 34, 96];
// Days ago the phase starts / ends (oldest first) — a ~3.5 year career.
const PHASE_SPANS: [number, number][] = [[1270, 900], [900, 640], [640, 470], [470, 3]];

const PILOT_ID = "demo-pilot-self";
const INSTRUCTOR_ID = "demo-pilot-inst";
const CAPTAIN_ID = "demo-pilot-capt";

function buildFlights(today: Date): Flight[] {
  const rand = rng(20260726);
  const out: Flight[] = [];
  let n = 0;

  PHASES.forEach((phase, pi) => {
    const [startAgo, endAgo] = PHASE_SPANS[pi];
    const count = PHASE_COUNTS[pi];
    for (let i = 0; i < count; i++) {
      // Spread legs across the phase window, oldest first.
      const t = i / Math.max(1, count - 1);
      const jitter = (rand() - 0.5) * ((startAgo - endAgo) / count) * 1.2;
      const ago = Math.max(2, Math.round(startAgo - t * (startAgo - endAgo) + jitter));
      const date = iso(daysBefore(today, ago));

      const [from, to] = phase.routes[Math.floor(rand() * phase.routes.length)];
      const dur = r1(phase.minH + rand() * (phase.maxH - phase.minH));
      const isNight = rand() < phase.nightRate;
      const isIfr = rand() < phase.ifrRate;
      const isCircuits = rand() < phase.circuitRate;

      // Circuit details log several landings; a line flight logs one.
      const landings = isCircuits ? 3 + Math.floor(rand() * 5) : 1;
      // Dusk details start in daylight and finish at night — the split case.
      const dusk = isCircuits && isNight;

      const ifrActual = isIfr ? r1(Math.min(dur, rand() * dur * 0.7)) : 0;
      const approaches = isIfr ? 1 + Math.floor(rand() * 2) : 0;

      // A student flies dual (logged as SIC beside the instructor); later
      // phases are flown as PIC, and the turbine job as First Officer.
      const student = phase.role === "Student";
      const fo = phase.role === "First Officer";
      const picId = student ? INSTRUCTOR_ID : fo ? CAPTAIN_ID : PILOT_ID;
      const sicId = student || fo ? PILOT_ID : "";

      const f: Flight = {
        id: `demo-f-${String(++n).padStart(4, "0")}`,
        date,
        aircraftType: phase.type,
        registration: phase.regs[Math.floor(rand() * phase.regs.length)],
        pilotId: PILOT_ID,
        loggedRole: student ? "Student" : fo ? "First Officer" : "Captain",
        picId, sicId, socId: "",
        from, to,
        takeoff: dusk ? "Day" : isNight ? "Night" : "Day",
        landing: isNight ? "Night" : "Day",
        se: phase.multi ? 0 : dur,
        me: phase.multi ? dur : 0,
        xc: from !== to && dur > 1.2 ? dur : 0,
        dayHours: isNight ? (dusk ? r1(dur * 0.4) : 0) : dur,
        nightHours: isNight ? (dusk ? r1(dur * 0.6) : dur) : 0,
        ifrActual,
        ifrSim: isIfr && rand() < 0.2 ? r1(rand() * 0.5) : 0,
        landings,
        approaches,
        notes: "",
      };
      out.push(f);
    }
  });

  // Newest first, matching how the app stores/lists flights.
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function buildDocuments(today: Date): PilotDocument[] {
  const stamp = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const mk = (over: Partial<PilotDocument> & { id: string; type: string }): PilotDocument => ({
    expiryMode: "manual", createdAt: stamp, updatedAt: stamp, ...over,
  });
  return [
    // Exam 10 months ago, Category 1 under 40 → 12 months, so it lands ~2
    // months out: the demo always shows a live "expiring soon" reminder.
    mk({
      id: "demo-doc-med", type: "Category 1 Medical", expiryMode: "auto",
      examDate: iso(daysBefore(today, 305)), expiryDate: iso(daysBefore(today, -60)),
      number: "AB-441207",
    }),
    mk({
      id: "demo-doc-ppc", type: "Pilot Proficiency Check (PPC)",
      expiryDate: iso(daysBefore(today, -47)), notes: "King Air 200 · multi-crew",
    }),
    mk({ id: "demo-doc-cpl", type: "Commercial Pilot Licence (CPL)", expiryMode: "none", number: "CA-2298431" }),
    mk({
      id: "demo-doc-rec", type: "Recurrent Training", expiryMode: "auto",
      issueDate: iso(daysBefore(today, 610)), expiryDate: iso(daysBefore(today, -120)),
    }),
    mk({
      id: "demo-doc-rad", type: "Restricted Operator Certificate (Aeronautical)",
      expiryMode: "none", number: "ROC-A 88213",
    }),
  ];
}

const PILOTS: Pilot[] = [
  { id: PILOT_ID, firstName: "Sam", lastName: "Rivard", employeeNumber: "1042", licenseNumber: "CA-2298431", createdAt: "2023-01-04T00:00:00.000Z" },
  { id: INSTRUCTOR_ID, firstName: "Dana", lastName: "Whitfield", employeeNumber: "", licenseNumber: "CA-1180776", createdAt: "2023-01-04T00:00:00.000Z" },
  { id: CAPTAIN_ID, firstName: "Marc", lastName: "Beaulieu", employeeNumber: "0871", licenseNumber: "CA-9042118", createdAt: "2024-06-11T00:00:00.000Z" },
];

/** The demo logbook. Pure: same `today` in, same data out. */
export function buildDemoData(today: Date = new Date()): AppData {
  const base = emptyData();
  return {
    ...base,
    flights: buildFlights(today),
    pilots: PILOTS.map((p) => ({ ...p })),
    currentPilotId: PILOT_ID,
    pilotName: "Sam Rivard",
    lastLoggedRole: "First Officer",
    documents: buildDocuments(today),
    fleet: [],
    profile: {
      firstName: "Sam",
      lastName: "Rivard",
      role: "First Officer",
      dateOfBirth: "1996-04-18",
      carsSubpart: "704",
      duty7DayOption: 70,
      pilotId: PILOT_ID,
      onboarded: true,
      tourSeen: true,
    },
    // notificationPrefs comes from emptyData() above.
  };
}
