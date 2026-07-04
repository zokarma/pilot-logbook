"use client";

import { sortedAirportCodes, airportLabel } from "@/lib/airports";

// Shared <datalist> of ICAO codes (Canadian first) for the From/To inputs.
export default function AirportDatalist({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {sortedAirportCodes().map((c) => (
        <option key={c} value={c}>
          {airportLabel(c)}
        </option>
      ))}
    </datalist>
  );
}
