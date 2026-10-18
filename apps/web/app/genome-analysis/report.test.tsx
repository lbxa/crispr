import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GenomeSummaryCard } from "./summary-card";
import { detailedReport, report } from "./report.fixture";
import { genomeReportSchema } from "./contract";

afterEach(cleanup);

it("retains complete report evidence, rejects malformed edit results and accepts older summaries", () => {
  const parsed = genomeReportSchema.parse(detailedReport);
  expect(parsed.findings[0]?.genotype?.explanation).toContain(
    "opposite copies",
  );
  expect(parsed.findings[0]?.phenotype?.matched_terms[0]?.hpo_id).toBe(
    "HP:0001954",
  );
  expect(parsed.findings[0]?.crispr?.[0]?.repair_template).toBe("ACGTACGT");
  expect(genomeReportSchema.safeParse(report).success).toBe(true);
  expect(
    genomeReportSchema.safeParse({
      ...detailedReport,
      findings: [{ ...detailedReport.findings[0], crispr: ["malformed"] }],
    }).success,
  ).toBe(false);
});

it("moves the completed analysis, genotype and full CRISPR results into its report drawer", async () => {
  render(
    <GenomeSummaryCard
      analysis={{
        status: "complete",
        file: new File(["synthetic"], "synthetic.vcf"),
        report: detailedReport,
        progress: {
          records_scanned: 12,
          variants_checked: 12,
          retained_variants: 1,
          uncompressed_bytes: 100,
        },
      }}
      onRetry={() => {}}
      onPause={() => {}}
      onResume={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(screen.queryByText(detailedReport.summary.text)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View full report" }));
  const drawer = await screen.findByRole("dialog", { name: "Genome report" });
  expect(within(drawer).getByText(detailedReport.summary.text)).toBeTruthy();
  expect(
    within(drawer).getByText(
      "Synthetic variants are on opposite copies of the gene.",
    ),
  ).toBeTruthy();
  expect(within(drawer).getByText("ACGTACGT")).toBeTruthy();
  expect(within(drawer).getByText(detailedReport.disclaimer)).toBeTruthy();
});
