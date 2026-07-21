"use client";

import { useData } from "@/context/DataContext";
import { sortedAirportCodes, airportLabel } from "@/lib/airports";

// Shared <datalist> of ICAO codes (Canadian first) for the From/To inputs.
// Includes the pilot's own placed airports alongside the built-in DB.
export default function AirportDatalist({ id }: { id: string }) {
  const { data } = useData();
  return (
    <datalist id={id}>
      {sortedAirportCodes(data.customAirports).map((c) => (
        <option key={c} value={c}>
          {airportLabel(c, data.customAirports)}
        </option>
      ))}
    </datalist>
  );
}
