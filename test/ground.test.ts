import { describe, expect, it } from "vitest";
import { isOnGround } from "../src/shared/ground";
import { DEFAULT_CONFIG } from "../src/shared/config";
import type { Aircraft } from "../src/shared/plugin";

const at = (lat: number, lon: number, gs: number, groundState = ""): Aircraft => ({
  callsign: "T", lat, lon, altitude: 0, flightLevel: 0, groundSpeed: gs, heading: 0, verticalSpeed: 0,
  squawk: "2000", modeC: true, ident: false,
  flightPlan: groundState ? ({ groundState } as Aircraft["flightPlan"]) : null,
});

describe("isOnGround", () => {
  it("low and slow at an airfield", () => expect(isOnGround(at(55.62, 12.65, 12), 30, DEFAULT_CONFIG)).toBe(true));
  it("not while taking off", () => expect(isOnGround(at(55.62, 12.65, 140), 30, DEFAULT_CONFIG)).toBe(false));
  it("not when climbing out", () => expect(isOnGround(at(55.62, 12.65, 40), 900, DEFAULT_CONFIG)).toBe(false));
  it("not away from configured airfields", () => expect(isOnGround(at(56.5, 14.0, 0), 0, DEFAULT_CONFIG)).toBe(false));
  it("EuroScope ground state counts when slow", () => {
    expect(isOnGround(at(55.62, 12.65, 20, "TAXI"), 600, DEFAULT_CONFIG)).toBe(true);
    expect(isOnGround(at(55.62, 12.65, 20, "DEPA"), 600, DEFAULT_CONFIG)).toBe(false);
    const off = { ...DEFAULT_CONFIG, groundFilter: { ...DEFAULT_CONFIG.groundFilter, useGroundState: false } };
    expect(isOnGround(at(55.62, 12.65, 20, "TAXI"), 600, off)).toBe(false);
  });
});
