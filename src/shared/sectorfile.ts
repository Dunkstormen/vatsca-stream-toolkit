// Imports SIDs and STARs from a EuroScope sector file pair: the .ese holds the procedures as
// fix lists ([SIDSSTARS]: "SID:EKCH:22R:SIMEG1A:FIX FIX ..."), the .sct holds fix, VOR, NDB,
// airport and runway coordinates.

import { distanceNm } from "./geo";

export interface ProcedureProperties {
  kind: "SID" | "STAR";
  airport: string;
  runway: string;
  name: string;
  /** One name per coordinate of the line ("" for runway ends). */
  fixes: string[];
}

export interface ProcedureFeature {
  type: "Feature";
  properties: ProcedureProperties;
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
}

export interface ProcedureCollection {
  type: "FeatureCollection";
  features: ProcedureFeature[];
}

export interface ImportResult {
  procedures: ProcedureCollection;
  /** Fix names that couldn't be found, with how many procedures used them. */
  missingFixes: Record<string, number>;
  skipped: number;
}

type LatLon = [number, number]; // [lat, lon]

/** "N055.37.04.000" / "E012.39.21.000" (or S/W) to decimal degrees. */
export function parseSctCoordinate(s: string): number | null {
  const m = /^([NSEW])(\d{1,3})\.(\d{1,2})\.(\d{1,2}(?:\.\d+)?)$/i.exec(s.trim());
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return /[SW]/i.test(m[1]) ? -v : v;
}

function coordPair(lat: string | undefined, lon: string | undefined): LatLon | null {
  if (!lat || !lon) return null;
  const a = parseSctCoordinate(lat);
  const b = parseSctCoordinate(lon);
  return a == null || b == null ? null : [a, b];
}

export interface SectorData {
  /** Name -> every position with that name (names repeat across regions). */
  points: Map<string, LatLon[]>;
  airports: Map<string, LatLon>;
  /** "EKCH:22R" -> [threshold, opposite threshold]. */
  runways: Map<string, [LatLon, LatLon]>;
}

export function parseSct(text: string): SectorData {
  const points = new Map<string, LatLon[]>();
  const airports = new Map<string, LatLon>();
  const runways = new Map<string, [LatLon, LatLon]>();
  const add = (name: string, p: LatLon) => {
    const list = points.get(name) ?? [];
    list.push(p);
    points.set(name, list);
  };
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const sec = /^\[([A-Z ]+)\]$/i.exec(line);
    if (sec) { section = sec[1].toUpperCase(); continue; }
    const t = line.split(/\s+/);
    if (section === "FIXES") {
      const p = coordPair(t[1], t[2]);
      if (p) add(t[0].toUpperCase(), p);
    } else if (section === "VOR" || section === "NDB") {
      const p = coordPair(t[2], t[3]);
      if (p) add(t[0].toUpperCase(), p);
    } else if (section === "AIRPORT") {
      const p = coordPair(t[2], t[3]);
      if (p) { airports.set(t[0].toUpperCase(), p); add(t[0].toUpperCase(), p); }
    } else if (section === "RUNWAY") {
      // 04L 22R 044 224 N.. E.. N.. E.. EKCH Kastrup  (airport is optional in older files)
      const a = coordPair(t[4], t[5]);
      const b = coordPair(t[6], t[7]);
      const icao = (t[8] ?? "").toUpperCase();
      if (a && b && icao) {
        runways.set(`${icao}:${t[0].toUpperCase()}`, [a, b]);
        runways.set(`${icao}:${t[1].toUpperCase()}`, [b, a]);
      }
    }
  }
  return { points, airports, runways };
}

/** Picks the candidate closest to `near` (the previous point, else the airport). */
function resolve(sector: SectorData, name: string, near: LatLon | null): LatLon | null {
  const list = sector.points.get(name.toUpperCase());
  if (!list?.length) return null;
  if (!near || list.length === 1) return list[0];
  let best = list[0];
  let bestD = Infinity;
  for (const p of list) {
    const d = distanceNm(near[0], near[1], p[0], p[1]);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

export function importProcedures(sctText: string, eseText: string): ImportResult {
  const sector = parseSct(sctText);
  const features: ProcedureFeature[] = [];
  const missingFixes: Record<string, number> = {};
  let skipped = 0;
  let section = "";
  for (const raw of eseText.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const sec = /^\[([A-Z ]+)\]$/i.exec(line);
    if (sec) { section = sec[1].toUpperCase(); continue; }
    if (section !== "SIDSSTARS") continue;
    const parts = line.split(":");
    const kind = parts[0]?.toUpperCase();
    if ((kind !== "SID" && kind !== "STAR") || parts.length < 5) continue;
    const airport = parts[1].trim().toUpperCase();
    const runway = parts[2].trim().toUpperCase();
    const name = parts[3].trim().toUpperCase();
    const fixNames = parts.slice(4).join(" ").trim().split(/\s+/).filter(Boolean);

    const coords: Array<[number, number]> = [];
    const names: string[] = [];
    let prev: LatLon | null = sector.airports.get(airport) ?? null;
    const rwy = sector.runways.get(`${airport}:${runway}`);
    if (kind === "SID" && rwy) {
      for (const p of rwy) { coords.push([p[1], p[0]]); names.push(""); }
      prev = rwy[1];
    }
    for (const f of fixNames) {
      const p = resolve(sector, f, prev);
      if (!p) { missingFixes[f] = (missingFixes[f] ?? 0) + 1; continue; }
      coords.push([p[1], p[0]]);
      names.push(f.toUpperCase());
      prev = p;
    }
    // STARs end at their last fix (usually the IAF); joining them to the runway would draw a path nobody flies.
    if (coords.length < 2 || !names.some(Boolean)) { skipped++; continue; }
    features.push({
      type: "Feature",
      properties: { kind, airport, runway, name, fixes: names },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  return { procedures: { type: "FeatureCollection", features }, missingFixes, skipped };
}
