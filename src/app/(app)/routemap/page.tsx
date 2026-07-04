"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { useData } from "@/context/DataContext";
import { AIRPORTS, airportCoord } from "@/lib/airports";
import { flightDate } from "@/lib/logbook";

interface RouteAgg { count: number; aircraft: Set<string>; last: Date | null; a: string; b: string }

export default function RouteMapPage() {
  const { data } = useData();
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const divRef = useRef<HTMLDivElement>(null);

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
      }
      const map = mapRef.current;
      const layer = layerRef.current!;
      layer.clearLayers();
      setTimeout(() => map.invalidateSize(), 50);

      if (!routesSorted.length) return;

      const maxCount = Math.max(...routesSorted.map((r) => r.count));
      const allLatLngs: [number, number][] = [];
      routesSorted.forEach((r) => {
        const c1 = airportCoord(r.a);
        const c2 = airportCoord(r.b);
        const ratio = r.count / maxCount;
        L.polyline([c1, c2], { color: "#22d3ee", weight: 1.5 + ratio * 6, opacity: 0.4 + ratio * 0.5, lineCap: "round" }).addTo(layer);
        allLatLngs.push(c1, c2);
      });
      Array.from(codes).forEach((code) => {
        const c = airportCoord(code);
        const known = !!AIRPORTS[code];
        const marker = L.circleMarker(c, { radius: 6, color: "#ffffff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 }).addTo(layer);
        marker.bindTooltip(code, { permanent: true, direction: "top", offset: [0, -8], className: "route-airport-label" });
        if (!known) marker.bindPopup(`<b>${code}</b><br><span style="color:#94a3b8">Unknown ICAO — position estimated</span>`);
      });
      if (allLatLngs.length) map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40], maxZoom: 7 });
    })();
    return () => { cancelled = true; };
  }, [routesSorted, codes]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  const dstr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 card p-5">
        {!flights.length && <p className="text-xs text-slate-400 mb-2">No routes yet — log a flight with From/To airports.</p>}
        <div ref={divRef} style={{ height: 500 }} className="border border-slate-800 rounded-lg overflow-hidden" />
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
