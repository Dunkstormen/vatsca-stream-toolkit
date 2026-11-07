import { describe, expect, it } from "vitest";
import { importProcedures, parseSctCoordinate } from "../src/shared/sectorfile";

const SCT = `[INFO]
Test
[VOR]
KAS 112.500 N055.35.24.000 E012.36.48.000
[NDB]
CH 365.000 N055.40.00.000 E012.30.00.000
[FIXES]
SIMEG N055.58.07.000 E013.29.01.000
DUPE N055.50.00.000 E013.00.00.000
DUPE N040.00.00.000 W010.00.00.000 ; same name far away
[AIRPORT]
EKCH 118.105 N055.37.04.000 E012.39.21.000 C
[RUNWAY]
04L 22R 044 224 N055.35.11.000 E012.37.46.000 N055.37.29.000 E012.40.56.000 EKCH Kastrup
`;
const ESE = `[POSITIONS]
EKCH_TWR:Kastrup Tower:118.105:CT:T:EKCH:TWR:-:-:0000:0000
[SIDSSTARS]
SID:EKCH:22R:SIMEG1A:KAS DUPE SIMEG
STAR:EKCH:22L:ABBET2A:SIMEG NOPE CH ; NOPE is unknown
SID:EKCH:04L:BAD1A:NOPE
`;

describe("sector file import", () => {
  it("parses coordinates", () => {
    expect(parseSctCoordinate("N055.37.04.000")).toBeCloseTo(55.61778, 4);
    expect(parseSctCoordinate("W010.30.00.000")).toBeCloseTo(-10.5, 6);
    expect(parseSctCoordinate("garbage")).toBeNull();
  });
  it("builds SID and STAR lines", () => {
    const r = importProcedures(SCT, ESE);
    expect(r.procedures.features).toHaveLength(2);
    const sid = r.procedures.features[0];
    expect(sid.properties).toMatchObject({ kind: "SID", airport: "EKCH", runway: "22R", name: "SIMEG1A" });
    // two runway ends, then the fixes; the nearby DUPE is chosen
    expect(sid.properties.fixes).toEqual(["", "", "KAS", "DUPE", "SIMEG"]);
    expect(sid.geometry.coordinates[0][1]).toBeCloseTo(55.6247, 3); // 22R threshold
    expect(sid.geometry.coordinates[3][1]).toBeCloseTo(55.8333, 3);
    const star = r.procedures.features[1];
    expect(star.properties.fixes).toEqual(["SIMEG", "CH"]);
    expect(r.missingFixes).toEqual({ NOPE: 2 });
    expect(r.skipped).toBe(1);
  });
});
