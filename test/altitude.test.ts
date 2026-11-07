import { describe, expect, it } from "vitest";
import { formatLevel, parseQnh, qnhAltitude, transitionContext, transitionLevel, type TransitionContext } from "../src/shared/altitude";
import { DEFAULT_CONFIG } from "../src/shared/config";
import type { AirportInfo } from "../src/shared/plugin";

const ctx = (over: Partial<TransitionContext> = {}): TransitionContext => ({ airfield: null, qnh: 1013, taFt: 5000, tl: 70, ...over });
const ac = (flightLevel: number, verticalSpeed = 0, altitude = flightLevel) => ({ flightLevel, altitude, verticalSpeed });

describe("parseQnh", () => {
  it("reads hPa and inHg", () => {
    expect(parseQnh("EKCH 071820Z 24012KT 9999 FEW030 08/04 Q1012 NOSIG")).toBe(1012);
    expect(parseQnh("EKCH 071820Z 24012KT 9999 FEW030 08/04 Q0998 NOSIG")).toBe(998);
    expect(parseQnh("KJFK 071851Z 31012KT 10SM FEW250 12/M03 A2992")).toBe(1013);
    expect(parseQnh("EKCH 071820Z 24012KT 9999")).toBeNull();
  });
});

describe("transitionLevel", () => {
  it("auto: lowest FL at least layerFt above the TA", () => {
    const rule = { mode: "auto" as const, layerFt: 1000, stepFl: 10 };
    expect(transitionLevel(rule, 5000, 1013.25)).toBe(60);
    expect(transitionLevel(rule, 5000, 1013)).toBe(70); // FL60 is only 993 ft above TA
    expect(transitionLevel(rule, 5000, 1030)).toBe(60);
    expect(transitionLevel(rule, 5000, 980)).toBe(70);
    expect(transitionLevel(rule, 5000, 975)).toBe(80);
    expect(transitionLevel({ ...rule, stepFl: 5 }, 5000, 1013)).toBe(65);
  });
  it("table: highest qnhMin that the QNH reaches", () => {
    const rule = { mode: "table" as const, table: [{ qnhMin: 0, fl: 80 }, { qnhMin: 1013, fl: 60 }, { qnhMin: 978, fl: 70 }] };
    expect(transitionLevel(rule, 5000, 1020)).toBe(60);
    expect(transitionLevel(rule, 5000, 1000)).toBe(70);
    expect(transitionLevel(rule, 5000, 960)).toBe(80);
  });
  it("fixed", () => expect(transitionLevel({ mode: "fixed", fl: 75 }, 5000, 990)).toBe(75));
});

describe("formatLevel", () => {
  it("corrects for QNH below the TA", () => {
    expect(qnhAltitude(3000, 1030)).toBeCloseTo(3452, 0);
    expect(formatLevel(ac(3000), ctx({ qnh: 1030 })).text).toBe("A035");
    expect(formatLevel(ac(3000), ctx({ qnh: 990 })).text).toBe("A024");
  });
  it("shows A at the TA and FL at the TL", () => {
    expect(formatLevel(ac(5000), ctx({ qnh: 1013.25 })).text).toBe("A050");
    expect(formatLevel(ac(7000), ctx()).text).toBe("FL070");
    expect(formatLevel(ac(35000), ctx()).text).toBe("FL350");
  });
  it("uses direction in the transition layer", () => {
    expect(formatLevel(ac(6000, 1500), ctx()).text).toBe("FL060");
    expect(formatLevel(ac(6000, -1500), ctx()).text).toBe("A060");
    expect(formatLevel(ac(6000, 0), ctx(), "A").text).toBe("A060");
    expect(formatLevel(ac(6000, 0), ctx(), "FL").text).toBe("FL060");
  });
  it("falls back to EuroScope's altitude without a QNH", () => {
    expect(formatLevel(ac(3000, 0, 3400), ctx({ qnh: null })).text).toBe("A034");
  });
  it("never shows negative values", () => {
    expect(formatLevel(ac(-200), ctx({ qnh: 1000 })).text).toBe("A000");
  });
});

describe("transitionContext", () => {
  const airports = new Map<string, AirportInfo>([
    ["EKCH", { icao: "EKCH", metar: "EKCH 071820Z 24012KT 9999 Q1002", departureRunways: [], arrivalRunways: [] }],
    ["ENGM", { icao: "ENGM", metar: "ENGM 071820Z 24012KT 9999 Q0990", departureRunways: [], arrivalRunways: [] }],
  ]);
  it("uses the governing airfield's QNH and TA", () => {
    const c = transitionContext(DEFAULT_CONFIG, airports, 60.3, 11.2);
    expect(c.airfield?.icao).toBe("ENGM");
    expect(c.qnh).toBe(990);
    expect(c.taFt).toBe(7000);
  });
  it("outside every airfield uses the defaults and the nearest METAR", () => {
    const c = transitionContext(DEFAULT_CONFIG, airports, 55.0, 14.5); // Baltic, ~70 nm from EKCH
    expect(c.airfield).toBeNull();
    expect(c.qnh).toBe(1002);
    expect(c.taFt).toBe(DEFAULT_CONFIG.defaultTransition.transitionAltitudeFt);
  });
});
