"use client";

import { useState } from "react";
import Link from "next/link";
import { useData } from "@/context/DataContext";
import { aircraftName } from "@/lib/aircraft";
import {
  currentPilot, flightDate, flightsForCurrentPilot, flightDateStr, ifrHours, num, pilotName, totalHours,
} from "@/lib/logbook";
import { DASH_METRICS, computeActiveDuty, computeCars, isHidden } from "@/lib/dashboard";

/* ---------- presentational helpers ---------- */
function RingGauge({ pct, size = 96, color }: { pct: number; size?: number; color: string }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  const offset = c * (1 - p / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        style={{ filter: `drop-shadow(0 0 6px ${color}80)`, transition: "stroke-dashoffset .4s ease" }}
      />
    </svg>
  );
}

function GaugeCard({ title, subLabel, pct, color }: { title: string; subLabel: string; pct: number; color: string }) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: 96, height: 96 }}>
        <RingGauge pct={pct} color={color} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-bold text-white leading-none">{Math.round(pct)}%</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-slate-400">{title}</div>
        <div className="text-sm text-slate-300 mt-1">{subLabel}</div>
      </div>
    </div>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  clock: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
  trend: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>,
  bar: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M12 20V4M20 20v-7" /></svg>,
  plane: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z" /></svg>,
};

export default function DashboardPage() {
  const { data, mutate } = useData();
  const [customizing, setCustomizing] = useState(false);
  const hidden = (k: string) => isHidden(data, k);

  const pid = data.currentPilotId;
  const fl = data.flights.filter((x) => !pid || x.pilotId === pid);
  const total = fl.reduce((s, x) => s + totalHours(x), 0);
  const xc = fl.reduce((s, x) => s + num(x.xc), 0);
  const ifr = fl.reduce((s, x) => s + ifrHours(x), 0);
  const dayH = fl.reduce((s, x) => s + num(x.dayHours), 0);
  const nightH = fl.reduce((s, x) => s + num(x.nightHours), 0);
  const pic = pid ? fl.filter((x) => x.picId === pid).reduce((s, x) => s + totalHours(x), 0) : 0;
  const dual = pid ? fl.filter((x) => x.sicId === pid).reduce((s, x) => s + totalHours(x), 0) : 0;
  const routes = new Set(fl.filter((x) => x.from && x.to).map((x) => x.from + "-" + x.to));

  const now = new Date();
  const curMonthHrs = fl.filter((x) => { const d = flightDate(x); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).reduce((s, x) => s + totalHours(x), 0);
  const curYearHrs = fl.filter((x) => flightDate(x).getFullYear() === now.getFullYear()).reduce((s, x) => s + totalHours(x), 0);

  const primary: [string, string, string, string][] = [
    ["totalTime", "Total Time", total.toFixed(1) + " hrs", "clock"],
    ["currentMonth", "Current Month", curMonthHrs.toFixed(1) + " hrs", "trend"],
    ["annualTotal", "Annual Total", curYearHrs.toFixed(1) + " hrs", "bar"],
    ["totalFlights", "Total Flights", String(fl.length), "plane"],
  ];
  const secondary: [string, string, string, string][] = [
    ["pic", "PIC Hours", pic.toFixed(1), "text-emerald-400"],
    ["dual", "Dual (SIC) Hours", dual.toFixed(1), "text-violet-400"],
    ["xc", "Cross Country", xc.toFixed(1), "text-amber-400"],
    ["day", "Day Hours", dayH.toFixed(1), "text-yellow-400"],
    ["night", "Night Hours", nightH.toFixed(1), "text-indigo-400"],
    ["ifr", "IFR Hours", ifr.toFixed(1), "text-sky-400"],
    ["routes", "Unique Routes", String(routes.size), "text-teal-400"],
  ];

  const byType: Record<string, number> = {};
  fl.forEach((x) => { const t = x.aircraftType || "Unknown"; byType[t] = (byType[t] || 0) + totalHours(x); });
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const maxType = entries.length ? entries[0][1] : 1;

  const cp = currentPilot(data);
  const duty = computeActiveDuty(data);
  const cars = computeCars(data);
  const recent = flightsForCurrentPilot(data)[0];

  const primaryVisible = primary.filter((c) => !hidden(c[0]));
  const secondaryVisible = secondary.filter((c) => !hidden(c[0]));
  const dutyCards = [
    !hidden("dailyDuty") && <GaugeCard key="d" title="Daily Duty" subLabel={`${duty.dailyHrs.toFixed(1)}h / ${duty.dailyCap}h today`} pct={duty.dailyPct} color="#22d3ee" />,
    !hidden("weeklyDuty") && <GaugeCard key="w" title="Weekly Duty" subLabel={`${duty.weeklyHrs.toFixed(1)}h / ${duty.weeklyCap}h (7 days)`} pct={duty.weeklyPct} color="#22d3ee" />,
  ].filter(Boolean);
  const carsCards = [
    !hidden("carMonthly") && <GaugeCard key="m" title="CAR 700.15 — Monthly" subLabel={`${cars.hrs28.toFixed(1)} / ${cars.monthlyCap} hrs (28-day)`} pct={cars.monthlyPct} color={cars.monthlyPct > 90 ? "#f59e0b" : "#34d399"} />,
    !hidden("carRest") && <GaugeCard key="r" title="CAR 700.16 — Rest" subLabel={cars.restLabel} pct={cars.restPct} color={cars.restPct < 100 ? "#f59e0b" : "#34d399"} />,
  ].filter(Boolean);

  const panelsVisible = !hidden("aircraftHours") || !hidden("currentPilot");

  function toggle(key: string) {
    mutate((d) => {
      const set = new Set(d.dashboardHidden || []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      d.dashboardHidden = Array.from(set);
    });
  }

  const sectionH = "text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3";

  return (
    <section className="space-y-8">
      {/* Customize toolbar */}
      <div className="flex items-center justify-end -mb-4">
        <button onClick={() => setCustomizing((v) => !v)} className="flex items-center gap-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" /></svg>
          <span>Customize</span>
        </button>
      </div>
      {customizing && (
        <div className="card p-5 -mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Customize dashboard</h3>
            <div className="flex items-center gap-3">
              <button onClick={() => mutate((d) => { d.dashboardHidden = []; })} className="text-xs text-slate-400 hover:text-slate-200">Show all</button>
              <button onClick={() => setCustomizing(false)} className="text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg transition">Done</button>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">Turn individual metrics on or off. Your choice is saved to this device.</p>
          <div className="space-y-4">
            {DASH_METRICS.map((g) => (
              <div key={g.section}>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{g.section}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {g.items.map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer select-none">
                      <input type="checkbox" checked={!hidden(key)} onChange={() => toggle(key)} className="accent-cyan-500 w-4 h-4" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flight Stats */}
      {primaryVisible.length > 0 && (
        <div>
          <h3 className={sectionH}>Flight Stats</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {primaryVisible.map(([key, label, val, ic]) => (
              <div key={key} className="card p-4">
                <div className="flex items-start justify-between">
                  <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="text-brand-400">{ICONS[ic]}</div>
                </div>
                <div className="text-2xl font-bold text-white mt-2">{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flight Time Breakdown */}
      {secondaryVisible.length > 0 && (
        <div>
          <h3 className={sectionH}>Flight Time Breakdown</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {secondaryVisible.map(([key, label, val, color]) => (
              <div key={key} className="card p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
                <div className={"text-lg font-bold mt-1 " + color}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Duty */}
      {dutyCards.length > 0 && (
        <div>
          <h3 className={sectionH}>Active Duty</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{dutyCards}</div>
        </div>
      )}

      {/* Panels */}
      {panelsVisible && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {!hidden("aircraftHours") && (
            <div className="card p-5">
              <h3 className="font-semibold mb-4">Hours by Aircraft Type</h3>
              <div className="space-y-3">
                {!entries.length && <p className="text-slate-400 text-sm">No flights logged yet.</p>}
                {entries.map(([t, h]) => {
                  const friendly = aircraftName(t);
                  return (
                    <div key={t}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium">{t}{friendly && friendly !== t && <span className="text-slate-400 font-normal"> — {friendly}</span>}</span>
                        <span className="text-slate-400">{h.toFixed(1)} hrs</span>
                      </div>
                      <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${maxType ? (h / maxType) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!hidden("currentPilot") && (
            <div className="card p-5">
              <h3 className="font-semibold mb-2">Current Pilot</h3>
              <p className="text-sm text-slate-400 mb-3">All metrics on this page are for the pilot selected in the header.</p>
              {!cp ? (
                <p className="text-slate-400 text-sm">No pilot selected. Add a profile in the Pilots tab.</p>
              ) : (
                <div className="text-sm space-y-2">
                  <div className="flex justify-between"><span className="text-slate-400">Name:</span><span className="font-medium">{pilotName(data, cp.id)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Employee #:</span><span>{cp.employeeNumber || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">License #:</span><span>{cp.licenseNumber || "—"}</span></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recent Logs */}
      {!hidden("recentLogs") && (
        <div>
          <h3 className={sectionH}>Recent Logs</h3>
          {!recent ? (
            <div className="card p-5 text-slate-400 text-sm">No flights logged yet.</div>
          ) : (
            <div className="card p-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div><div className="text-xs uppercase text-slate-400 mb-1">Date</div><div className="font-semibold text-slate-100">{flightDateStr(recent)}</div></div>
                <div><div className="text-xs uppercase text-slate-400 mb-1">Aircraft</div><div className="font-semibold text-slate-100">{recent.registration || recent.civilIdent || "—"} <span className="text-slate-400 font-normal">({recent.aircraftType || "—"})</span></div></div>
                <div className="col-span-2 sm:col-span-1"><div className="text-xs uppercase text-slate-400 mb-1">Route</div><div className="font-semibold text-slate-100">{recent.from || "?"} <span className="text-brand-400">→</span> {recent.to || "?"}</div></div>
                <div><div className="text-xs uppercase text-slate-400 mb-1">Flight Time</div><div className="font-semibold text-slate-100">{totalHours(recent).toFixed(1)}h</div></div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-500">Role: {recent.loggedRole || "—"} · PIC: {pilotName(data, recent.picId) || recent.pic || "—"}</span>
                <Link href="/logger" className="text-xs text-cyan-400 hover:text-cyan-300 font-medium">Details</Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CARs Compliance */}
      {carsCards.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">CARs Compliance · Duty Tracker</h3>
            <Link href="/duty" className="text-xs font-medium text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
              View in Duty Tracker
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </Link>
          </div>
          <p className="text-xs text-slate-500 mb-3">Live from your Duty Tracker — edit duty days there and these update automatically.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{carsCards}</div>
        </div>
      )}
    </section>
  );
}
