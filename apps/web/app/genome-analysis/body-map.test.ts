import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ANATOMY_REGIONS } from "@crispr/human-model/anatomy";
import { bodyHighlights } from "./body-map";
import { genomeReportSchema } from "./contract";
import { mappedReport, report } from "./report.fixture";

describe("body region report boundary", () => {
  it.each([
    undefined,
    { version: 1, status: "unavailable", source: null, mappings: [] },
  ] as const)(
    "highlights the primary PKU region when an older report has no usable mapping: %j",
    (bodyMap) => {
      const pkuReport = genomeReportSchema.parse({
        ...report,
        findings: [
          { tier: "possible", gene: "PAH", disease: "Phenylketonuria" },
        ],
        body_map: bodyMap,
      });

      const highlights = bodyHighlights(pkuReport);

      expect(highlights).toEqual([
        { regionId: "head_brain", color: "#ef4444", strength: 1 },
      ]);
    },
  );

  it("marks a PKU carrier highlight as an association rather than disease", () => {
    const pkuReport = genomeReportSchema.parse({
      ...report,
      findings: [{ tier: "carrier", gene: "PAH", disease: "Phenylketonuria" }],
    });

    const highlights = bodyHighlights(pkuReport);

    expect(highlights).toEqual([
      {
        regionId: "head_brain",
        color: "#ef4444",
        strength: 1,
        association: "carrier",
      },
    ]);
  });

  it("keeps the backend catalog aligned with the actual avatar regions", () => {
    const catalog = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "../../backend/crispr_backend/analysis/anatomy_regions.json",
        ),
        "utf8",
      ),
    );
    expect(Object.keys(catalog).sort()).toEqual(
      ANATOMY_REGIONS.map(({ id }) => id).sort(),
    );
  });

  it("preserves validated mappings and accepts historical reports", () => {
    expect(genomeReportSchema.parse(mappedReport).body_map).toEqual(
      mappedReport.body_map,
    );
    expect(genomeReportSchema.parse(report).body_map).toBeUndefined();
  });

  it.each([
    [{ finding_index: 0, region_ids: ["imaginary_organ"] }],
    [{ finding_index: 0, region_ids: ["liver", "liver"] }],
    [{ finding_index: 1, region_ids: ["liver"] }],
    [{ finding_index: 99, region_ids: ["liver"] }],
    [
      { finding_index: 0, region_ids: ["liver"] },
      { finding_index: 0, region_ids: ["liver"] },
    ],
    [],
  ])(
    "rejects unsupported, duplicate, missing, or carrier mappings: %j",
    (...mappings) => {
      expect(
        genomeReportSchema.safeParse({
          ...mappedReport,
          body_map: { ...mappedReport.body_map, mappings },
        }).success,
      ).toBe(false);
    },
  );

  it("deduplicates shared regions, uses red, and clears unavailable mappings", () => {
    expect(bodyHighlights(mappedReport)).toEqual([
      { regionId: "digestive_tract", color: "#ef4444", strength: 1 },
      { regionId: "major_joints", color: "#ef4444", strength: 1 },
    ]);
    expect(bodyHighlights(report)).toEqual([]);
    expect(
      bodyHighlights({
        ...mappedReport,
        body_map: {
          version: 1,
          status: "unavailable",
          source: null,
          mappings: [],
        },
      }),
    ).toEqual([]);
  });
});
