import type { Aircraft } from "./plugin";
import type { AppConfig } from "./config";
import { nearestWithin } from "./geo";

/** EuroScope ground states that mean the aircraft hasn't left the ground (DEPA does not count). */
export const GROUND_STATES = new Set(["NSTS", "ONFREQ", "DE-ICE", "STUP", "PUSH", "TAXI", "LINEUP", "TXIN", "PARK"]);

/**
 * True when the aircraft is on the ground at one of the configured airfields: inside its ground
 * radius and either low and slow (within marginFt of the elevation, below maxGroundSpeed), or in a
 * EuroScope ground state while still slow. Aircraft away from configured airfields are never hidden.
 */
export function isOnGround(a: Aircraft, altitudeFt: number, config: AppConfig): boolean {
  const field = nearestWithin(config.airfields, a.lat, a.lon, (f) => f.groundRadiusNm);
  if (!field) return false;
  const g = config.groundFilter;
  const slow = a.groundSpeed < g.maxGroundSpeed;
  if (slow && altitudeFt - field.elevationFt < g.marginFt) return true;
  const state = a.flightPlan?.groundState ?? "";
  return g.useGroundState && slow && GROUND_STATES.has(state);
}
