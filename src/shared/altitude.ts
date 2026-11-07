// Altitude/level shown in aircraft tags: "A045" on QNH, "FL240" on standard pressure.
//
// Rules (as a controller reads them):
// - At or below the transition altitude (TA) aircraft fly on QNH: show Axxx (hundreds of feet).
// - At or above the transition level (TL) aircraft fly on 1013.25: show FLxxx.
// - In between (the transition layer) it depends on direction: a climbing aircraft switched to
//   1013 when it passed the TA, so it shows FL; a descending one switched to QNH at the TL, so it
//   shows A. A level aircraft keeps whatever it showed before.

import type { AirportInfo } from "./plugin";
import type { Airfield, AppConfig, TransitionLevelRule } from "./config";
import { distanceNm, nearestWithin } from "./geo";

export const STANDARD_HPA = 1013.25;
/** Feet per hPa near the surface (ICAO standard atmosphere, ~27 ft). */
export const FT_PER_HPA = 27;
/** Vertical speed (ft/min) beyond which an aircraft in the transition layer counts as climbing/descending. */
export const VS_THRESHOLD = 300;
/** How far to look for a METAR when the governing airfield has none. */
export const QNH_SEARCH_NM = 150;

export type LevelMode = "A" | "FL";

/** QNH in hPa from a METAR (Q1013, or A2992 in inHg), or null. */
export function parseQnh(metar: string): number | null {
  const q = /\bQ(\d{3,4})\b/.exec(metar);
  if (q) return Number(q[1]);
  const a = /\bA(\d{4})\b/.exec(metar);
  if (a) return Math.round((Number(a[1]) / 100) * 33.8639);
  return null;
}

/** Altitude above mean sea level on the given QNH, from a standard-pressure altitude. */
export function qnhAltitude(flightLevelFt: number, qnh: number): number {
  return flightLevelFt + (qnh - STANDARD_HPA) * FT_PER_HPA;
}

/** Transition level as a flight level number (70 = FL070). */
export function transitionLevel(rule: TransitionLevelRule, taFt: number, qnh: number): number {
  switch (rule.mode) {
    case "fixed":
      return rule.fl;
    case "table": {
      const rows = [...rule.table].sort((a, b) => b.qnhMin - a.qnhMin);
      const row = rows.find((r) => qnh >= r.qnhMin) ?? rows[rows.length - 1];
      return row ? row.fl : Math.ceil(taFt / 1000) * 10 + 10;
    }
    case "auto": {
      const step = rule.stepFl > 0 ? rule.stepFl : 10;
      // FL x sits at x*100 + (QNH-1013.25)*FT_PER_HPA feet on QNH; find the lowest that clears TA + layer.
      const needed = (taFt + rule.layerFt - (qnh - STANDARD_HPA) * FT_PER_HPA) / 100;
      return Math.ceil(needed / step - 1e-9) * step;
    }
  }
}

export interface TransitionContext {
  /** Governing airfield, or null when outside every airfield's altitude radius. */
  airfield: Airfield | null;
  /** QNH in hPa, or null when no METAR is near. */
  qnh: number | null;
  taFt: number;
  /** Flight level number. */
  tl: number;
}

/** Which QNH, TA and TL apply at a position. */
export function transitionContext(
  config: AppConfig, airports: Map<string, AirportInfo>, lat: number, lon: number,
): TransitionContext {
  const airfield = nearestWithin(config.airfields, lat, lon, (a) => a.altitudeRadiusNm);
  let qnh: number | null = null;
  if (airfield) qnh = qnhOf(airports.get(airfield.icao));
  if (qnh == null) {
    // Nearest configured airfield with a METAR, else any METAR'd airport we have a position for.
    let best = Infinity;
    for (const a of config.airfields) {
      const q = qnhOf(airports.get(a.icao));
      const d = distanceNm(lat, lon, a.lat, a.lon);
      if (q != null && d < best && d <= QNH_SEARCH_NM) { best = d; qnh = q; }
    }
  }
  const taFt = airfield ? airfield.transitionAltitudeFt : config.defaultTransition.transitionAltitudeFt;
  const rule = airfield ? airfield.transitionLevel : config.defaultTransition.transitionLevel;
  return { airfield, qnh, taFt, tl: transitionLevel(rule, taFt, qnh ?? STANDARD_HPA) };
}

function qnhOf(info: AirportInfo | undefined): number | null {
  return info?.metar ? parseQnh(info.metar) : null;
}

export interface LevelInput {
  /** Standard-pressure altitude, ft (plugin `flightLevel`). */
  flightLevel: number;
  /** EuroScope's own QNH altitude, ft (plugin `altitude`); used when we have no QNH. */
  altitude: number;
  verticalSpeed: number;
}

export interface LevelResult {
  mode: LevelMode;
  /** "A045" or "FL240". */
  text: string;
  /** Altitude on QNH, ft. */
  altitudeFt: number;
}

export function formatLevel(input: LevelInput, ctx: TransitionContext, previous?: LevelMode): LevelResult {
  const altitudeFt = ctx.qnh != null ? qnhAltitude(input.flightLevel, ctx.qnh) : input.altitude;
  let mode: LevelMode;
  if (altitudeFt <= ctx.taFt) mode = "A";
  else if (input.flightLevel >= ctx.tl * 100) mode = "FL";
  else if (input.verticalSpeed > VS_THRESHOLD) mode = "FL";
  else if (input.verticalSpeed < -VS_THRESHOLD) mode = "A";
  else mode = previous ?? "FL";

  const hundreds = (ft: number) => String(Math.max(0, Math.round(ft / 100))).padStart(3, "0");
  const text = mode === "A" ? "A" + hundreds(altitudeFt) : "FL" + hundreds(input.flightLevel);
  return { mode, text, altitudeFt };
}
