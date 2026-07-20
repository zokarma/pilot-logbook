"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { useData } from "@/context/DataContext";
import { isNativeApp } from "@/lib/native";
import { airportCoord, airportLabel, normalizeAirportCode } from "@/lib/airports";
import { flightDate } from "@/lib/logbook";
import { uid } from "@/lib/id";
import { useUi } from "@/components/UiProvider";

interface RouteAgg { count: number; aircraft: Set<string>; last: Date | null; a: string; b: string }

// Leaflet renders string popup/tooltip content as HTML, and airport codes are
// user-supplied (form input or CSV import) — escape them before interpolating.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

export default function RouteMapPage() {
  const { data, mutate } = useData();
  const { toast } = useUi();
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const divRef = useRef<HTMLDivElement>(null);

  // "Place this airport" form. While it's open, clicking the map fills the
  // lat/lon fields (the handler lives in a ref so the map listener, registered
  // once at init, always sees the current form).
  const [placing, setPlacing] = useState<string | null>(null);
  const [apForm, setApForm] = useState({ lat: "", lon: "", name: "" });
  const [apMsg, setApMsg] = useState("");
  const mapClickRef = useRef<((lat: number, lon: number) => void) | null>(null);
  mapClickRef.current = placing
    ? (lat, lon) => setApForm((f) => ({ ...f, lat: lat.toFixed(4), lon: lon.toFixed(4) }))
    : null;

  function saveAirport() {
    if (!placing) return;
    const lat = parseFloat(apForm.lat);
    const lon = parseFloat(apForm.lon);
    if (!isFinite(lat) || lat < -90 || lat > 90) { setApMsg("Latitude must be between -90 and 90."); return; }
    if (!isFinite(lon) || lon < -180 || lon > 180) { setApMsg("Longitude must be between -180 and 180."); return; }
    const code = normalizeAirportCode(placing);
    const name = apForm.name.trim();
    mutate((d) => {
      if (!Array.isArray(d.customAirports)) d.customAirports = [];
      const existing = d.customAirports.find((a) => normalizeAirportCode(a.code) === code);
      if (existing) {
        existing.lat = lat; existing.lon = lon;
        if (name) existing.name = name;
        existing.updatedAt = new Date().toISOString();
      } else {
        d.customAirports.push({
          id: uid("ap"), code, lat, lon, ...(name ? { name } : {}),
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
      }
    });
    setPlacing(null);
    setApForm({ lat: "", lon: "", name: "" });
    setApMsg("");
    toast(`${code} placed on the map — synced to your logbook`);
  }

  function removeAirport(id: string) {
    const removed = (data.customAirports || []).find((a) => a.id === id);
    if (!removed) return;
    mutate((d) => { d.customAirports = (d.customAirports || []).filter((a) => a.id !== id); });
    toast(`${normalizeAirportCode(removed.code)} removed`, {
      actionLabel: "Undo",
      onAction: () => mutate((d) => {
        if (!Array.isArray(d.customAirports)) d.customAirports = [];
        d.customAirports.push(structuredClone(removed));
      }),
    });
  }

  // In the native app, contain Leaflet's internal z-index (panes 400,
  // controls 1000) in its own stacking context so the map can't paint over the
  // sticky top bar / sidebar when scrolling. Set after mount (isNativeApp is
  // false during prerender) — safe because the map is client-only anyway.
  const [native, setNative] = useState(false);
  useEffect(() => { setNative(isNativeApp()); }, []);

  const pid = data.currentPilotId;
  const flights = useMemo(
    () => data.flights.filter((x) => (!pid || x.pilotId === pid) && x.from && x.to),
    [data.flights, pid],
  );

  const { routesSorted, codes } = useMemo(() => {
    const codeSet = new Set<string>();
    const routes: Record<string, RouteAgg> = {};
    flights.forEach((fl) => {
      codeSet.add(fl.from); codeSet.add(fl.to);
      const key = [fl.from, fl.to].sort().join("-");
      if (!routes[key]) routes[key] = { count: 0, aircraft: new Set(), last: null, a: fl.from, b: fl.to };
      routes[key].count++;
      if (fl.aircraftType) routes[key].aircraft.add(fl.aircraftType);
      const d = flightDate(fl);
      if (!routes[key].last || d > routes[key].last!) routes[key].last = d;
    });
    return { routesSorted: Object.values(routes).sort((x, y) => y.count - x.count), codes: codeSet };
  }, [flights]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !divRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(divRef.current, { worldCopyJump: true, zoomControl: true, scrollWheelZoom: true }).setView([45, -75], 3);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
        // Feeds the "place this airport" form while it's open; no-op otherwise.
        mapRef.current.on("click", (e) => mapClickRef.current?.(e.latlng.lat, e.latlng.lng));
      }
      const map = mapRef.current;
      const layer = layerRef.current!;
      layer.clearLayers();
      setTimeout(() => map.invalidateSize(), 50);

      if (!routesSorted.length) return;

      // Unknown airports are NOT plotted (no coordinates → no marker, and a
      // route leg is drawn only when both ends are known). They're listed
      // beside the map with a "Place" action instead.
      const custom = data.customAirports;
      const maxCount = Math.max(...routesSorted.map((r) => r.count));
      const allLatLngs: [number, number][] = [];
      routesSorted.forEach((r) => {
        const c1 = airportCoord(r.a, custom);
        const c2 = airportCoord(r.b, custom);
        if (!c1 || !c2) return;
        const ratio = r.count / maxCount;
        L.polyline([c1, c2], { color: "#22d3ee", weight: 1.5 + ratio * 6, opacity: 0.4 + ratio * 0.5, lineCap: "round" }).addTo(layer);
        allLatLngs.push(c1, c2);
      });
      Array.from(codes).forEach((code) => {
        const c = airportCoord(code, custom);
        if (!c) return;
        const marker = L.circleMarker(c, { radius: 6, color: "#ffffff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 }).addTo(layer);
        marker.bindTooltip(esc(code), { permanent: true, direction: "top", offset: [0, -8], className: "route-airport-label" });
        marker.bindPopup(`<b>${esc(airportLabel(code, custom))}</b>`);
        allLatLngs.push(c);
      });
      if (allLatLngs.length) map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40], maxZoom: 7 });
    })();
    return () => { cancelled = true; };
  }, [routesSorted, codes, data.customAirports]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  const dstr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

  const unknownCodes = useMemo(
    () => Array.from(codes).filter((c) => !airportCoord(c, data.customAirports)).sort(),
    [codes, data.customAirports],
  );
  const customSorted = useMemo(
    () => [...(data.customAirports || [])].sort((a, b) => a.code.localeCompare(b.code)),
    [data.customAirports],
  );

  function startPlacing(code: string) {
    const existing = (data.customAirports || []).find(
      (a) => normalizeAirportCode(a.code) === normalizeAirportCode(code),
    );
    setPlacing(code);
    setApForm(existing
      ? { lat: String(existing.lat), lon: String(existing.lon), name: existing.name || "" }
      : { lat: "", lon: "", name: "" });
    setApMsg("");
  }

  const inputCls = "w-full px-3 py-2 border border-slate-700 rounded-lg text-sm";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 card p-5">
        {!flights.length && <p className="text-xs text-slate-400 mb-2">No routes yet — log a flight with From/To airports.</p>}
        <div ref={divRef} style={{ height: 500 }} className={"border border-slate-800 rounded-lg overflow-hidden" + (native ? " relative z-0" : "")} />

        {/* Place-airport form */}
        {placing && (
          <div className="mt-4 p-4 rounded-lg border border-brand-500/40 bg-slate-900/40">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">Place {normalizeAirportCode(placing)}</h4>
              <button onClick={() => { setPlacing(null); setApMsg(""); }} className="text-sm text-slate-400 hover:text-slate-200">Cancel</button>
            </div>
            <p className="text-xs text-brand-300 mb-3">Click the airport&apos;s location on the map to fill the coordinates, or type them in.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Latitude</label>
                <input inputMode="decimal" value={apForm.lat} onChange={(e) => setApForm((f) => ({ ...f, lat: e.target.value }))} placeholder="49.1939" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Longitude</label>
                <input inputMode="decimal" value={apForm.lon} onChange={(e) => setApForm((f) => ({ ...f, lon: e.target.value }))} placeholder="-123.1844" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Name (optional)</label>
                <input value={apForm.name} onChange={(e) => setApForm((f) => ({ ...f, name: e.target.value }))} placeholder="Grass strip" className={inputCls} />
              </div>
              <button onClick={saveAirport} className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                Save airport
              </button>
            </div>
            {apMsg && <p className="text-xs text-red-400 mt-2">{apMsg}</p>}
          </div>
        )}

        {/* Airports with no known position */}
        {unknownCodes.length > 0 && !placing && (
          <div className="mt-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
            <p className="text-xs text-amber-300 mb-2">
              {unknownCodes.length} airport{unknownCodes.length === 1 ? "" : "s"} in your logbook {unknownCodes.length === 1 ? "has" : "have"} no map
              position yet, so {unknownCodes.length === 1 ? "it" : "they"} aren&apos;t plotted. Place them to complete your map:
            </p>
            <div className="flex flex-wrap gap-2">
              {unknownCodes.map((c) => (
                <button
                  key={c}
                  onClick={() => startPlacing(c)}
                  className="text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 rounded-lg transition"
                >
                  {c} — Place
                </button>
              ))}
            </div>
          </div>
        )}

        {/* The pilot's placed airports */}
        {customSorted.length > 0 && (
          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Your placed airports</h4>
            <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg">
              {customSorted.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{normalizeAirportCode(a.code)}</span>
                    {a.name && <span className="text-slate-400"> — {a.name}</span>}
                    <span className="text-slate-500 text-xs"> ({a.lat.toFixed(4)}, {a.lon.toFixed(4)})</span>
                  </span>
                  <span className="shrink-0 flex items-center gap-3">
                    <button onClick={() => startPlacing(a.code)} className="text-xs text-cyan-400 hover:text-cyan-300">Edit</button>
                    <button onClick={() => removeAirport(a.id)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="card p-5">
        <h3 className="font-semibold mb-3">Routes Flown</h3>
        <div className="space-y-3 max-h-[460px] overflow-y-auto">
          {!routesSorted.length && <p className="text-slate-400 text-sm">No routes yet.</p>}
          {routesSorted.map((r) => (
            <div key={r.a + "-" + r.b} className="border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{r.a} ↔ {r.b}</span>
                <span className="text-xs bg-brand-500/10 text-brand-300 px-2 py-0.5 rounded-full">{r.count}×</span>
              </div>
              <div className="text-xs text-slate-400 mt-1">Aircraft: {Array.from(r.aircraft).join(", ") || "—"}</div>
              <div className="text-xs text-slate-400">Last flown: {dstr(r.last)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
