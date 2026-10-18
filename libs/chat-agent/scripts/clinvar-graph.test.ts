import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../agent/app";
import { loadGraph } from "../agent/data";
import { createScriptedModel } from "../agent/demo-model";
import { createChatHandler } from "../agent/handler";
import { buildState } from "../agent/state";
import {
  buildClinVarGraph,
  oneLetter,
  splitName,
  variantId,
} from "../lib/clinvar/graph";
import { ingestSimulatedPatient } from "../lib/clinvar/patients";
import {
  ClinVarDatasetSchema,
  parsePanelPy,
  type ClinVarDataset,
} from "../lib/clinvar/variant-summary";
import {
  DEFAULT_FIXTURE,
  DEFAULT_PANEL,
  importVariantSummary,
} from "./import-clinvar";
import { HEADER, row } from "./fixtures/synthetic-variant-summary";

const panel = parsePanelPy(await readFile(DEFAULT_PANEL, "utf8"));

/** A dataset built through the real import path, from a file of the given rows. */
async function datasetFrom(file: string): Promise<ClinVarDataset> {
  const r = await importVariantSummary(file, panel);
  return ClinVarDatasetSchema.parse({
    source: "NCBI ClinVar variant_summary.txt.gz",
    sourceUrl: "test",
    release: "2026-10-01",
    sha256: r.sha256,
    importedAt: "2026-10-18T00:00:00.000Z",
    assembly: "GRCh38",
    panel,
    records: r.records,
  });
}

// Synthetic rows: an SNV and a deletion in CFTR (format only; not ClinVar records).
async function syntheticDataset() {
  const dir = await mkdtemp(join(tmpdir(), "clinvar-graph-"));
  const file = join(dir, "variant_summary.txt");
  await writeFile(
    file,
    [
      HEADER,
      row({}),
      row({
        VariationID: "900000002",
        Type: "Deletion",
        Name: "SYNTHETIC(CFTR):c.10_12del (p.Phe4del)",
        ClinicalSignificance: "Pathogenic/Likely pathogenic",
        ReviewStatus: "reviewed by expert panel",
        PositionVCF: "200",
        ReferenceAlleleVCF: "ATCT",
        AlternateAlleleVCF: "A",
      }),
    ].join("\n") + "\n",
  );
  return { dir, dataset: await datasetFrom(file) };
}

test("ClinVar names split into HGVS parts and a 1-letter alias for linking", () => {
  assert.deepEqual(
    splitName("NM_000492.4(CFTR):c.1521_1523del (p.Phe508del)"),
    {
      hgvsc: "c.1521_1523del",
      hgvsp: "p.Phe508del",
    },
  );
  assert.equal(oneLetter("p.Phe508del"), "F508del");
  assert.equal(oneLetter("p.Gly542Ter"), "G542X");
  assert.equal(oneLetter("p.Glu7fs"), "E7fs");
  assert.equal(splitName("NM_0(CFTR):c.1-2A>G").hgvsp, "");
});

test("the ClinVar graph quotes ClinVar and fills in nothing ClinVar lacks", async () => {
  const { dataset } = await syntheticDataset();
  const g = buildClinVarGraph(dataset);
  assert.deepEqual(g.validate(), []);
  const v = g.typed(variantId(900000002), "Variant")!;
  assert.equal(v.prov, "clinvar");
  assert.equal(v.label, "CFTR p.Phe4del");
  assert.equal(v.props.clinvar?.significance, "Pathogenic/Likely pathogenic");
  assert.equal(v.props.clinvar?.reviewStatus, "reviewed by expert panel");
  assert.equal(v.props.clinvar?.stars, 3);
  assert.equal(v.props.clinvar?.release, "2026-10-01");
  assert.equal(v.props.consequence, null);
  assert.equal(v.props.gnomadAf, null);
  assert.deepEqual(v.props.locus, {
    chrom: "7",
    pos: 201,
    ref: "TCT",
    alt: "",
    assembly: "GRCh38",
    verified: false,
  });
  assert.ok(v.aliases.includes("VCV900000002"));
  assert.ok(v.aliases.includes("F4del"));
  assert.ok(g.outEdges(v.id, "CAUSES").some((e) => e.to === "dis:omim-219700"));
  const gene = g.typed("gene:CFTR", "Gene")!;
  assert.equal(gene.props.name, null);
  assert.equal(gene.props.strand, null);
  assert.equal(g.ofType("Phenotype").length, 0, "no symptoms invented");
  assert.equal(g.ofType("Organ").length, 0, "no organs invented");
});

test("simulated patients enter through ingestPatient with backend tiers and no scores", async () => {
  const { dataset } = await syntheticDataset();
  const g = buildClinVarGraph(dataset);
  const r = ingestSimulatedPatient(g, {
    patientId: "sim-001",
    sex: "F",
    report: {
      findings: [
        {
          tier: "likely",
          omim_id: "OMIM:219700",
          disease: "Cystic fibrosis",
          gene: "CFTR",
          genotype: { status: "affected" },
          variants: [
            { variation_id: 900000002, zygosity: "homozygous" },
            { variation_id: 999999999, zygosity: "heterozygous" },
          ],
        },
      ],
      symptoms: { terms: [{ id: "HP:0000000", name: "Synthetic symptom" }] },
    },
  });
  assert.deepEqual(r.unresolved.variants, [variantId(999999999)]);
  assert.deepEqual(r.unresolved.phenotypes, ["Synthetic symptom"]);
  const f = g.outEdges("pt:sim-001", "HAS_FINDING")[0]!;
  assert.equal(f.props.tier, "likely");
  assert.equal(f.props.combinedScore, null);
  assert.equal(f.props.scoring, "pipeline");
  const hv = g.outEdges("pt:sim-001", "HAS_VARIANT")[0]!;
  assert.equal(hv.props.zygosity, "hom");
  assert.throws(() =>
    ingestSimulatedPatient(g, {
      patientId: "HG00096",
      sex: "M",
      report: { findings: [] },
    }),
  );
});

test("loadGraph uses the ClinVar import, else says why it fell back to seed data", async () => {
  const { dir, dataset } = await syntheticDataset();
  const file = join(dir, "clinvar-panel.json");
  await writeFile(file, JSON.stringify(dataset));
  const real = loadGraph({
    CRISPR_CLINVAR_DATA: file,
    CRISPR_PATIENTS_DATA: join(dir, "none.json"),
  });
  assert.equal(real.data.source, "clinvar");
  assert.ok(real.graph.node(variantId(900000001)));

  const missing = loadGraph({ CRISPR_CLINVAR_DATA: join(dir, "nope.json") });
  assert.equal(missing.data.source, "seed");
  assert.match(
    missing.data.source === "seed" ? missing.data.reason : "",
    /clinvar:import/,
  );

  await writeFile(join(dir, "bad.json"), '{"records": "nope"}');
  const bad = loadGraph({ CRISPR_CLINVAR_DATA: join(dir, "bad.json") });
  assert.equal(bad.data.source, "seed");
});

async function editAnswer(dataset: ClinVarDataset, question: string) {
  const app = createApp({
    graph: buildClinVarGraph(dataset),
    data: {
      source: "clinvar",
      release: dataset.release,
      sha256: dataset.sha256,
      records: dataset.records.length,
      patients: 0,
      unresolved: 0,
    },
    model: createScriptedModel([
      { text: "Off-target risk is not assessed [F1]." },
    ]),
  });
  const res = await createChatHandler(app)(
    new Request("http://x/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", parts: [{ type: "text", text: question }] }],
      }),
    }),
  );
  const chunks = (await res.text())
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => JSON.parse(l) as { type: string; data?: never });
  const last = <T>(type: string) =>
    chunks.filter((c) => c.type === type).at(-1)?.data as T | undefined;
  return { app, chunks, last };
}

function assertNotAssessed(r: Awaited<ReturnType<typeof editAnswer>>) {
  const metrics = r.last<{
    offTarget: string;
    cards: Array<{ id: string; status: string; value: unknown }>;
  }>("data-metrics")!;
  assert.equal(metrics.offTarget, "not_assessed");
  const off = metrics.cards.find((c) => c.id === "off_target");
  assert.equal(off?.status, "not_assessed");
  const on = metrics.cards.find((c) => c.id === "on_target");
  if (on) assert.equal(on.status, "not_computed");
  const grounding = r.last<{
    offTarget: string;
    facts: Record<string, string>;
  }>("data-grounding")!;
  assert.equal(grounding.offTarget, "not_assessed");
  const facts = Object.values(grounding.facts).join("\n");
  assert.match(facts, /Off-target risk has NOT been assessed/);
  assert.doesNotMatch(facts, /\b(safe|recommended|ready to use)\b/i);
  return { facts, metrics };
}

test("ClinVar-backed edit answers: off-target not assessed, ClinVar quoted with release", async () => {
  const { dataset } = await syntheticDataset();
  const r = await editAnswer(dataset, "What edit options fit CFTR p.Phe4del?");
  const focus = r.last<{ intent: string; dataNotice: string }>("data-focus")!;
  assert.equal(focus.intent, "edit_design");
  assert.match(focus.dataNotice, /NCBI ClinVar, release 2026-10-01/);
  const { facts, metrics } = assertNotAssessed(r);
  assert.match(
    facts,
    /ClinVar \(release 2026-10-01\) lists VCV900000002 .* as "Pathogenic\/Likely pathogenic"/,
  );
  assert.match(
    facts,
    /review status "reviewed by expert panel" \(3 of 4 stars\)/,
  );
  assert.match(facts, /SYNTHETIC placeholder/);
  const variantCard = metrics.cards.find((c) => c.id === "variant");
  assert.equal(variantCard?.value, "Pathogenic/Likely pathogenic");
  const helix = r.last<{ sequenceSource: string }>("data-helix");
  assert.equal(helix?.sequenceSource, "synthetic");
});

test("first view on a ClinVar graph without patients opens on a gene and labels the release", async () => {
  const { dataset } = await syntheticDataset();
  const { app } = await editAnswer(dataset, "hello");
  const s = await buildState(app);
  assert.equal(s.data.source, "clinvar");
  assert.match(s.notice, /NCBI ClinVar, release 2026-10-01/);
  assert.equal(s.focus?.id, "gene:CFTR");
});

test(
  "recorded ClinVar rows: F508del edit answer keeps the not-assessed invariant",
  {
    skip: existsSync(DEFAULT_FIXTURE)
      ? false
      : "no recorded fixture yet: run `bun run clinvar:download && bun run clinvar:record-fixture`",
  },
  async () => {
    const r = await editAnswer(
      await datasetFrom(DEFAULT_FIXTURE),
      "What edit options fit CFTR p.Phe508del?",
    );
    const { facts } = assertNotAssessed(r);
    assert.match(facts, /VCV000007105/);
  },
);
