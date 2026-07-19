"use client";

import { useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { dstr, flightDateStr, num } from "@/lib/logbook";
import { DutyEntry } from "@/lib/types";
import { OPERATION_TYPES, DUTY_LIMITS, DEFAULT_OPERATION, operationLimits, effectiveLimits, FDP_TABLE } from "@/lib/dutyLimits";

// Windows match the CARs rolling periods the limits are written against:
// 7 days (work), 28 days (flight time + work), 90 days (flight time).
type DutyType = "7" | "28" | "90";

function calcDutyHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => isNaN(n))) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

// Reference rows for the selected operation, built from the CARs limit tables
// (lib/dutyLimits) so the numbers can never drift from what the gauges use.
function limitRows(profile: { carsSubpart?: string; duty7DayOption?: number } | null | undefined): { value: string; label: string; tone: string }[] {
  const l = effectiveLimits(profile);
  const hrs = (n: number) => `${n.toLocaleString()} hours`;
  return [
    { value: hrs(l.fdpDailyMax), label: "Max flight duty period (daily ceiling)", tone: "amber" },
    ...(l.singlePilot24 ? [{ value: hrs(l.singlePilot24), label: "Max flight time, single-pilot (24h)", tone: "amber" }] : []),
    { value: hrs(l.flightTime28), label: "Max flight time per 28 days", tone: "sky" },
    { value: hrs(l.flightTime90), label: "Max flight time per 90 days", tone: "sky" },
    { value: hrs(l.flightTime365), label: "Max flight time per 365 days", tone: "sky" },
    { value: hrs(l.duty7Day), label: "Max hours of work per 7 days", tone: "violet" },
    { value: hrs(l.duty28Day), label: "Max hours of work per 28 days", tone: "violet" },
    { value: hrs(l.duty365), label: "Max hours of work per 365 days", tone: "violet" },
    { value: hrs(l.minRestHome), label: "Minimum rest at home base", tone: "emerald" },
    { value: hrs(l.minRestAway), label: "Minimum rest away from base", tone: "emerald" },
  ];
}

export default function DutyPage() {
  const { data, mutate } = useData();
  const carsOp = data.profile?.carsSubpart ?? DEFAULT_OPERATION;
  // The 7-day work limit actually in force (60 or 70, per the operator's schedule).
  const sevenDayOptions = operationLimits(carsOp).duty7DayOptions;
  const sevenDay = effectiveLimits(data.profile).duty7Day;
  const [dutyType, setDutyType] = useState<DutyType>("28");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [modalKey, setModalKey] = useState<string | null>(null);

  const flightDateSet = useMemo(() => {
    const pid = data.currentPilotId;
    return new Set(
      data.flights.filter((f) => !pid || f.pilotId === pid).map(flightDateStr).filter(Boolean),
    );
  }, [data.flights, data.currentPilotId]);

  // Trailing window ENDING on the anchor (today by default) — the CARs limits
  // are "in any N consecutive days", so what matters is the look-back.
  const { cells, label } = useMemo(() => {
    const out: (Date | null)[] = [];
    const n = parseInt(dutyType, 10);
    const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const days: Date[] = [];
    for (let i = n - 1; i >= 0; i--) {
      days.push(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i));
    }
    // Pad so the Su–Sa column headers line up with the real weekdays.
    for (let i = 0; i < days[0].getDay(); i++) out.push(null);
    days.forEach((d) => out.push(d));
    const lbl = `${dstr(days[0])} → ${dstr(days[days.length - 1])} (${n} days)`;
    return { cells: out, label: lbl };
  }, [dutyType, anchor]);

  const { onCount, offCount, totalHrs } = useMemo(() => {
    let on = 0, off = 0, hrs = 0;
    cells.forEach((d) => {
      if (!d) return;
      const k = dstr(d);
      const entry = data.duty[k];
      if ((entry && entry.on) || flightDateSet.has(k)) { on++; if (entry?.hours) hrs += +entry.hours; }
      else off++;
    });
    return { onCount: on, offCount: off, totalHrs: hrs };
  }, [cells, data.duty, flightDateSet]);

  function shift(dir: number) {
    const n = parseInt(dutyType, 10);
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dir * n));
  }

  const todayKey = dstr(new Date());
  const toneCls: Record<string, string> = {
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    sky: "bg-sky-500/10 border-sky-500/30 text-sky-300",
    emerald: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    violet: "bg-violet-500/10 border-violet-500/30 text-violet-300",
  };
  const toneSub: Record<string, string> = {
    amber: "text-amber-400", sky: "text-sky-400", emerald: "text-emerald-400", violet: "text-violet-400",
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-semibold">Duty Schedule</h3>
          <select
            value={dutyType}
            onChange={(e) => { setDutyType(e.target.value as DutyType); setAnchor(new Date()); }}
            className="px-3 py-2 border border-slate-700 rounded-lg text-sm"
          >
            <option value="7">7-Day</option>
            <option value="28">28-Day</option>
            <option value="90">90-Day</option>
          </select>
        </div>

        <div className="flex items-center justify-between mb-3">
          <button onClick={() => shift(-1)} className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg">← Prev</button>
          <span className="text-sm font-medium text-slate-300">{label}</span>
          <button onClick={() => shift(1)} className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg">Next →</button>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="text-center text-xs font-medium text-slate-500 pb-1">{d}</div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={"pad" + i} />;
            const key = dstr(d);
            const entry = data.duty[key];
            const hasFlight = flightDateSet.has(key);
            const on = (entry && entry.on) || hasFlight;
            const isToday = key === todayKey;
            let bottom: string;
            if (entry && (entry.hours || entry.operationType)) {
              const parts: string[] = [];
              if (entry.hours) parts.push((+entry.hours).toFixed(1) + "h");
              if (entry.operationType) parts.push(entry.operationType);
              bottom = parts.join(" · ");
            } else bottom = hasFlight ? "FLIGHT" : on ? "ON" : "off";
            return (
              <button
                key={key}
                onClick={() => setModalKey(key)}
                className={
                  "aspect-square rounded-lg text-xs font-medium flex flex-col items-center justify-center gap-0.5 transition px-1 " +
                  (on ? "bg-brand-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700") +
                  (isToday ? " ring-2 ring-amber-400" : "")
                }
              >
                <span className="text-sm">{d.getDate()}</span>
                {hasFlight && <span className="text-[10px] leading-none">✈</span>}
                <span className="text-[10px] opacity-80 leading-tight text-center">{bottom}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-4 text-sm">
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-brand-600 inline-block" /> On duty ({onCount})</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-slate-700 inline-block" /> Off ({offCount})</span>
          {totalHrs > 0 && <span className="text-slate-400 text-xs">({totalHrs.toFixed(1)} duty hrs)</span>}
          <span className="text-slate-400 text-xs ml-auto">Click a day to add start/end times &amp; op type.</span>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-1">CARs Part VII Limits</h3>
        <p className="text-xs text-slate-400 mb-3">Canadian Aviation Regulations — flight &amp; duty time reference.</p>
        <label className="block text-xs font-medium text-slate-400 mb-1">Operation type</label>
        <select
          value={carsOp}
          onChange={(e) => mutate((d) => { if (d.profile) d.profile.carsSubpart = e.target.value; })}
          className="w-full px-3 py-2 border border-slate-700 rounded-lg text-sm mb-2"
        >
          {OPERATION_TYPES.map((t) => (
            <option key={t} value={t}>{DUTY_LIMITS[t].label}</option>
          ))}
        </select>
        <label className="block text-xs font-medium text-slate-400 mb-1">
          7-day work limit (operator&apos;s approved schedule)
        </label>
        <select
          value={String(sevenDay)}
          onChange={(e) => mutate((d) => { if (d.profile) d.profile.duty7DayOption = Number(e.target.value); })}
          className="w-full px-3 py-2 border border-slate-700 rounded-lg text-sm mb-2"
        >
          {sevenDayOptions.map((h) => (
            <option key={h} value={h}>{h} hours / 7 days</option>
          ))}
        </select>
        <p className="text-xs text-slate-500 mb-4">
          Sets the limits used by the Daily/Weekly Duty and Flight Time gauges on the dashboard.
        </p>
        <div className="space-y-3 text-sm">
          {limitRows(data.profile).map((l) => (
            <div key={l.label} className={"p-3 rounded-lg border " + toneCls[l.tone]}>
              <div className="font-semibold">{l.value}</div>
              <div className={toneSub[l.tone]}>{l.label}</div>
            </div>
          ))}
        </div>
        <details className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-300 select-none">
            Max FDP by report time &amp; segments
          </summary>
          <div className="px-3 pb-3">
            <p className="text-xs text-slate-500 mb-2">
              The daily maximum is a sliding scale, not a single number — the ceiling above
              is the best case. Flights averaging 50 minutes or more.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="text-left font-medium py-1 pr-2">Report</th>
                    <th className="text-right font-medium py-1 px-2">1–4</th>
                    <th className="text-right font-medium py-1 px-2">5–6</th>
                    <th className="text-right font-medium py-1 pl-2">7+</th>
                  </tr>
                </thead>
                <tbody>
                  {FDP_TABLE.map((r) => (
                    <tr key={r.start} className={"border-t border-slate-800 " + (r.wocl ? "text-amber-300" : "text-slate-300")}>
                      <td className="py-1 pr-2 whitespace-nowrap">{r.start}{r.wocl ? " ·WOCL" : ""}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{r.legs1to4.toFixed(1)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{r.legs5to6.toFixed(1)}</td>
                      <td className="py-1 pl-2 text-right tabular-nums">{r.legs7plus.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 mt-2">Hours of flight duty period, by number of flight segments.</p>
          </div>
        </details>

        <details className="mt-2 rounded-lg border border-slate-800 bg-slate-900/40">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-300 select-none">
            Rest, time off &amp; extensions
          </summary>
          <ul className="px-3 pb-3 space-y-2 text-xs text-slate-400 list-disc pl-6">
            {effectiveLimits(data.profile).notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      </div>

      {modalKey && (
        <DutyModal
          dateKey={modalKey}
          entry={data.duty[modalKey]}
          flightsToday={data.flights.filter(
            (fl) => flightDateStr(fl) === modalKey && (!data.currentPilotId || fl.pilotId === data.currentPilotId),
          )}
          onClose={() => setModalKey(null)}
          onSave={(e) => { mutate((d) => { d.duty[modalKey] = e; }); setModalKey(null); }}
          onRemove={() => { mutate((d) => { delete d.duty[modalKey]; }); setModalKey(null); }}
        />
      )}
    </div>
  );
}

function DutyModal({
  dateKey, entry, flightsToday, onClose, onSave, onRemove,
}: {
  dateKey: string;
  entry: DutyEntry | undefined;
  flightsToday: import("@/lib/types").Flight[];
  onClose: () => void;
  onSave: (e: DutyEntry) => void;
  onRemove: () => void;
}) {
  const [start, setStart] = useState(entry?.start || "");
  const [end, setEnd] = useState(entry?.end || "");
  const [hours, setHours] = useState(entry?.hours != null ? String(entry.hours) : "");
  const [operationType, setOperationType] = useState(entry?.operationType || "");
  const [hoursDirty, setHoursDirty] = useState(false);

  const [y, m, d] = dateKey.split("-").map(Number);
  const headerDate = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  function recalc(s: string, e: string) {
    if (!hoursDirty) setHours(String(calcDutyHours(s, e) || ""));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const h = hours ? +hours : calcDutyHours(start, end) || 0;
    onSave({ on: true, start, end, hours: h, operationType });
  }

  const inputCls = "w-full px-3 py-2 border border-slate-700 rounded-lg";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-semibold">Duty Day</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">&times;</button>
        </div>
        <p className="text-sm text-slate-400 mb-4">{headerDate}</p>
        {flightsToday.length > 0 && (
          <div className="mb-4 text-xs bg-brand-500/10 text-brand-300 border border-brand-500/30 rounded-lg p-2">
            <b>{flightsToday.length} flight{flightsToday.length === 1 ? "" : "s"} on this day:</b>
            <br />
            {flightsToday.map((fl) => (
              <span key={fl.id}>
                {fl.aircraftType} {fl.registration} {fl.from || "?"}→{fl.to || "?"} ({(num(fl.se) + num(fl.me)).toFixed(1)}h)
                <br />
              </span>
            ))}
          </div>
        )}
        <form onSubmit={save} className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-400 mb-1">Start</span>
            <input type="time" value={start} onChange={(e) => { setStart(e.target.value); recalc(e.target.value, end); }} className={inputCls} />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-400 mb-1">End</span>
            <input type="time" value={end} onChange={(e) => { setEnd(e.target.value); recalc(start, e.target.value); }} className={inputCls} />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-400 mb-1">Duty hours</span>
            <input type="number" step="0.1" min="0" value={hours} onChange={(e) => { setHours(e.target.value); setHoursDirty(true); }} className={inputCls} />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-400 mb-1">Operation type</span>
            <input value={operationType} onChange={(e) => setOperationType(e.target.value)} placeholder="e.g. Line, Sim" className={inputCls} />
          </label>
          <div className="col-span-2 flex items-center justify-between mt-2">
            {entry ? (
              <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-300 text-sm">Remove duty</button>
            ) : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg hover:bg-slate-800">Cancel</button>
              <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition">Save</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
