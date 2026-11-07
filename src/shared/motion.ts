// Dead reckoning between radar updates, ported from the plugin's viewer. EuroScope only gets a new
// position every few seconds; between reports each aircraft moves along its track at its ground
// speed, and when a new report arrives the difference is blended out instead of jumping.

import { angleDiff, bearing, distanceNm, toRad } from "./geo";

export const BLEND_MS = 1500;
export const MAX_EXTRAPOLATE_MS = 15000;
export const SNAP_NM = 3;

interface MotionState {
  lat: number; lon: number; t: number; gs: number; track: number;
  offLat: number; offLon: number; hdgFrom: number;
}

export interface Shown { lat: number; lon: number; hdg: number }

export class MotionTracker {
  private states = new Map<string, MotionState>();

  update(cs: string, lat: number, lon: number, gs: number, heading: number, now: number): void {
    const m = this.states.get(cs);
    if (m && m.lat === lat && m.lon === lon) { m.gs = gs; return; } // same report repeated
    const shown = m ? predict(m, now) : null;
    let track = heading;
    if (m && distanceNm(m.lat, m.lon, lat, lon) > 0.02) track = bearing(m.lat, m.lon, lat, lon);
    const n: MotionState = { lat, lon, t: now, gs, track, offLat: 0, offLon: 0, hdgFrom: track };
    if (shown && distanceNm(shown.lat, shown.lon, lat, lon) < SNAP_NM) {
      n.offLat = shown.lat - lat;
      n.offLon = shown.lon - lon;
      n.hdgFrom = shown.hdg;
    }
    this.states.set(cs, n);
  }

  shown(cs: string, now: number): Shown | null {
    const m = this.states.get(cs);
    return m ? predict(m, now) : null;
  }

  retain(alive: Set<string>): void {
    for (const k of this.states.keys()) if (!alive.has(k)) this.states.delete(k);
  }
}

function predict(m: MotionState, now: number): Shown {
  const age = now - m.t;
  const dt = Math.min(age, MAX_EXTRAPOLATE_MS) / 1000;
  const k = Math.max(0, 1 - age / BLEND_MS);
  const e = k * k * (3 - 2 * k);
  const degPerSec = m.gs >= 5 ? m.gs / 3600 / 60 : 0;
  const lat = m.lat + degPerSec * Math.cos(toRad(m.track)) * dt + m.offLat * e;
  const lon = m.lon + (degPerSec * Math.sin(toRad(m.track)) * dt) / Math.cos(toRad(m.lat)) + m.offLon * e;
  const hdg = (m.track - angleDiff(m.hdgFrom, m.track) * e + 360) % 360;
  return { lat, lon, hdg };
}
