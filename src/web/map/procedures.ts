import type { MapControls } from "../../shared/config";
import type { AirportInfo } from "../../shared/plugin";
import type { ProcedureCollection } from "../../shared/sectorfile";

/** The SIDs/STARs the controls ask for: by kind, airport and (optionally) EuroScope's active runways. */
export function filterProcedures(
  all: ProcedureCollection, c: Pick<MapControls, "showSids" | "showStars" | "activeRunwaysOnly" | "procedureAirports">,
  airports: Map<string, AirportInfo>,
): ProcedureCollection {
  const wanted = new Set(c.procedureAirports.map((a) => a.toUpperCase()));
  const features = all.features.filter((f) => {
    const p = f.properties;
    if (p.kind === "SID" ? !c.showSids : !c.showStars) return false;
    if (wanted.size && !wanted.has(p.airport)) return false;
    if (c.activeRunwaysOnly) {
      const info = airports.get(p.airport);
      // Without runway info for the airport, show everything rather than nothing.
      if (info && (info.departureRunways.length || info.arrivalRunways.length)) {
        const active = p.kind === "SID" ? info.departureRunways : info.arrivalRunways;
        if (!active.includes(p.runway)) return false;
      }
    }
    return true;
  });
  return { type: "FeatureCollection", features };
}

/** One labelled point per named fix on the shown procedures. */
export function procedureFixes(shown: ProcedureCollection): GeoJSON.FeatureCollection {
  const seen = new Map<string, GeoJSON.Feature>();
  for (const f of shown.features) {
    f.geometry.coordinates.forEach((coord, i) => {
      const name = f.properties.fixes[i];
      if (!name) return;
      const key = `${name}:${coord[0].toFixed(3)}:${coord[1].toFixed(3)}`;
      if (!seen.has(key))
        seen.set(key, { type: "Feature", geometry: { type: "Point", coordinates: coord }, properties: { name, kind: f.properties.kind } });
    });
  }
  return { type: "FeatureCollection", features: [...seen.values()] };
}
