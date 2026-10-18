import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  indexHeader,
  parsePanelPy,
  parseRow,
  reviewStars,
} from "../lib/clinvar/variant-summary";
import {
  DEFAULT_FIXTURE,
  DEFAULT_PANEL,
  importVariantSummary,
} from "./import-clinvar";
import { HEADER, row } from "./fixtures/synthetic-variant-summary";

const panel = parsePanelPy(await readFile(DEFAULT_PANEL, "utf8"));

test("panel is read from backend/crispr_backend/panel.py", () => {
  assert.equal(panel.length, 24);
  const by = (gene: string) => panel.find((d) => d.gene === gene)!;
  assert.deepEqual(by("CFTR"), {
    omimId: "OMIM:219700",
    name: "Cystic fibrosis",
    gene: "CFTR",
    inheritance: "AR",
    mechanism: "loss_of_function",
  });
  assert.equal(by("FBN1").mechanism, "dominant_negative");
  assert.equal(by("TTR").mechanism, "gain_of_function");
  assert.equal(by("F9").inheritance, "XLR");
  assert.equal(by("MECP2").inheritance, "XLD");
});

test("review status maps to ClinVar's star scale; unknown is null", () => {
  assert.equal(reviewStars("practice guideline"), 4);
  assert.equal(reviewStars("reviewed by expert panel"), 3);
  assert.equal(
    reviewStars("criteria provided, multiple submitters, no conflicts"),
    2,
  );
  assert.equal(reviewStars("criteria provided, single submitter"), 1);
  assert.equal(
    reviewStars("criteria provided, conflicting classifications"),
    1,
  );
  assert.equal(reviewStars("no assertion criteria provided"), 0);
  assert.equal(reviewStars("no assertion provided"), 0);
  assert.equal(reviewStars("something ClinVar adds next year"), null);
});

const col = indexHeader(HEADER);

test("keeps a GRCh38 pathogenic panel record with ClinVar's own wording", () => {
  const r = parseRow(row({}), col, panel);
  assert.ok(typeof r === "object");
  assert.equal(r.accession, "VCV900000001");
  assert.equal(r.significance, "Pathogenic");
  assert.equal(
    r.reviewStatus,
    "criteria provided, multiple submitters, no conflicts",
  );
  assert.equal(r.stars, 2);
  assert.equal(r.submitters, 3);
  assert.equal(r.lastEvaluated, "Jan 01, 2024");
  assert.equal(r.rsid, null, "-1 means no dbSNP id");
  assert.deepEqual(r.panelDiseases, ["OMIM:219700"]);
  assert.deepEqual(r.rcv, ["RCV900000001"]);
});

test("skips non-GRCh38, out-of-panel, conflicting, benign and unlinked rows", () => {
  assert.equal(parseRow(row({ Assembly: "GRCh37" }), col, panel), "not_grch38");
  assert.equal(
    parseRow(row({ GeneSymbol: "BRCA1" }), col, panel),
    "gene_not_in_panel",
  );
  for (const sig of [
    "Conflicting classifications of pathogenicity",
    "Conflicting interpretations of pathogenicity",
    "Uncertain significance",
    "Benign",
    "Pathogenic; risk factor",
  ])
    assert.equal(
      parseRow(row({ ClinicalSignificance: sig }), col, panel),
      "not_pathogenic",
      sig,
    );
  assert.equal(
    parseRow(row({ PhenotypeIDS: "MedGen:C0000000" }), col, panel),
    "no_panel_condition",
  );
});

test("accepts the 2024 germline column names", () => {
  const header = HEADER.replace(
    "ClinicalSignificance",
    "GermlineClassification",
  )
    .replace("LastEvaluated", "GermlineDateLastEvaluated")
    .replace("ReviewStatus", "GermlineReviewStatus");
  const c = indexHeader(header);
  assert.equal(c.significance, col.significance);
  assert.throws(() => indexHeader("#Type\tName"), /no column/);
});

test("import streams gzip, hashes the file and keeps one record per VariationID", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clinvar-"));
  const file = join(dir, "variant_summary.txt.gz");
  const body = [
    HEADER,
    row({}),
    row({ Assembly: "GRCh37" }),
    row({ RCVaccession: "RCV900000002" }),
    row({ VariationID: "900000002", GeneSymbol: "BRCA1" }),
    "",
  ].join("\n");
  const gz = gzipSync(body);
  await writeFile(file, gz);
  const r = await importVariantSummary(file, panel);
  assert.equal(r.records.length, 1);
  assert.equal(r.skipped.not_grch38, 1);
  assert.equal(r.skipped.duplicate, 1);
  assert.equal(r.skipped.gene_not_in_panel, 1);
  const { createHash } = await import("node:crypto");
  assert.equal(r.sha256, createHash("sha256").update(gz).digest("hex"));
});

test(
  "recorded rows from the real ClinVar file parse as ClinVar reports them",
  {
    skip: existsSync(DEFAULT_FIXTURE)
      ? false
      : "no recorded fixture yet: run `bun run clinvar:download && bun run clinvar:record-fixture`",
  },
  async () => {
    const r = await importVariantSummary(DEFAULT_FIXTURE, panel);
    const f508 = r.records.find((x) => x.variationId === 7105);
    assert.ok(f508, "CFTR p.Phe508del (VariationID 7105) is kept");
    assert.equal(f508.accession, "VCV000007105");
    assert.equal(f508.gene, "CFTR");
    assert.match(f508.name, /p\.Phe508del/);
    assert.ok(f508.panelDiseases.includes("OMIM:219700"));
    assert.ok(r.skipped.not_grch38 >= 1, "the GRCh37 row is skipped");
    assert.ok(
      r.skipped.not_pathogenic >= 1,
      "conflicting/benign rows are skipped",
    );
    assert.ok(r.skipped.gene_not_in_panel >= 1);
    for (const rec of r.records)
      assert.ok(
        [
          "Pathogenic",
          "Likely pathogenic",
          "Pathogenic/Likely pathogenic",
        ].includes(rec.significance),
      );
  },
);
