import { describe, expect, test } from "bun:test";
import {
  ANATOMY_REGIONS,
  calculateRegionInfluence,
  findHealthResultMapping,
  HEALTH_RESULT_MAPPINGS,
} from "../src/anatomy";

describe("anatomy region schema", () => {
  test("provides a substantial shared region set with unique identifiers", () => {
    const ids = ANATOMY_REGIONS.map(({ id }) => id);

    expect(ids.length).toBeGreaterThanOrEqual(12);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("keeps normalized anchors finite and physically usable", () => {
    for (const region of ANATOMY_REGIONS) {
      expect(region.anchors.length).toBeGreaterThan(0);
      expect(region.surfaceCue.length).toBeGreaterThan(20);

      for (const { center, radius } of region.anchors) {
        expect(center[0]).toBeWithin(-1, 1);
        expect(center[1]).toBeWithin(0, 1);
        expect(center[2]).toBeWithin(-1, 1);
        for (const component of [...center, ...radius]) {
          expect(Number.isFinite(component)).toBe(true);
        }
        for (const component of radius) {
          expect(component).toBeGreaterThan(0);
        }
      }
    }
  });

  test("uses soft ellipsoid anchors as highlight masks", () => {
    const liver = ANATOMY_REGIONS.find(({ id }) => id === "liver");
    expect(liver).toBeDefined();

    const center = liver?.anchors[0]?.center;
    expect(center).toBeDefined();
    expect(calculateRegionInfluence("liver", center ?? [0, 0, 0])).toBe(1);
    expect(calculateRegionInfluence("liver", [1, 1, -1])).toBe(0);
  });
});

describe("health result mappings", () => {
  test("references only defined regions and always identifies a primary cue", () => {
    const regionIds = new Set(ANATOMY_REGIONS.map(({ id }) => id));

    for (const mapping of HEALTH_RESULT_MAPPINGS) {
      expect(mapping.regions.some(({ strength }) => strength === "primary")).toBe(
        true,
      );
      expect(mapping.association.length).toBeGreaterThan(20);
      for (const { regionId } of mapping.regions) {
        expect(regionIds.has(regionId)).toBe(true);
      }
    }
  });

  test("resolves common display names and aliases without punctuation", () => {
    expect(findHealthResultMapping("HbA1c")?.key).toBe("hba1c");
    expect(findHealthResultMapping("hs-CRP")?.key).toBe("hs_crp");
    expect(findHealthResultMapping("VO2 max")?.key).toBe("vo2_max");
    expect(findHealthResultMapping("unknown result")).toBeUndefined();
  });

  test("maps kidney and fitness results to their expected surface cues", () => {
    expect(findHealthResultMapping("creatinine")?.regions[0]?.regionId).toBe(
      "kidneys_urinary",
    );
    expect(
      findHealthResultMapping("cardiorespiratory fitness")?.regions.map(
        ({ regionId }) => regionId,
      ),
    ).toEqual(["lungs_breathing", "heart_circulation", "lower_limbs"]);
  });
});
