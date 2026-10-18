import type { GenomeReport } from "./contract";
import { plan } from "../crispr/plan.fixture";

// Fields returned by Analyzer.analyze in backend/crispr_backend/analysis/pipeline.py.
export const report: GenomeReport = {
  conclusion: {
    status: "no_finding",
    label: "No genetic cause found in the screened genes",
  },
  summary: { text: "No genetic cause found in the screened genes." },
  genome: { variants_checked: 12, panel_genes: ["MEFV", "FGFR3"] },
  findings: [],
  disclaimer:
    "Research prototype using simulated genomes. Not a medical diagnosis or treatment recommendation; findings must be confirmed by clinical testing and a genetic counselor.",
};

export const carrierReport: GenomeReport = {
  ...report,
  conclusion: {
    status: "carrier_only",
    label: "No genetic cause found; carrier of a recessive condition",
  },
  findings: [
    { tier: "carrier", gene: "MEFV", disease: "Familial Mediterranean fever" },
  ],
  summary: {
    text: "No genetic cause found; carrier of a recessive condition. You carry one copy of a variant linked to Familial Mediterranean fever (MEFV); carriers usually have no symptoms.",
  },
};

export const mappedReport: GenomeReport = {
  ...report,
  conclusion: {
    status: "genetic_finding",
    label: "Disease-causing variants found",
  },
  findings: [
    { tier: "possible", gene: "MEFV", disease: "Familial Mediterranean fever" },
    { tier: "carrier", gene: "CFTR", disease: "Cystic fibrosis" },
    { tier: "likely", gene: "FGFR3", disease: "Achondroplasia" },
  ],
  body_map: {
    version: 1,
    status: "mapped",
    source: "gemini",
    mappings: [
      { finding_index: 0, region_ids: ["digestive_tract", "major_joints"] },
      { finding_index: 2, region_ids: ["major_joints"] },
    ],
  },
};

export const detailedReport: GenomeReport = {
  ...mappedReport,
  overview: plan.overview,
  findings: [
    {
      tier: "likely",
      gene: "MEFV",
      disease: "Familial Mediterranean fever",
      omim_id: "OMIM:249100",
      inheritance: "AR",
      genotype: {
        status: "affected",
        explanation: "Synthetic variants are on opposite copies of the gene.",
      },
      variants: [
        {
          variation_id: 1,
          name: "Synthetic MEFV variant",
          rsid: null,
          chrom: "16",
          pos: 3293406,
          ref: "G",
          alt: "A",
          significance: "Pathogenic",
          stars: 2,
          zygosity: "heterozygous",
          haplotypes: [1],
        },
      ],
      phenotype: {
        score: 2.5,
        rank: 1,
        matched_terms: [
          {
            patient_term: "Fever",
            disease_term: "Recurrent fever",
            hpo_id: "HP:0001954",
          },
        ],
      },
      crispr: plan.edits.map((edit) => ({
        ...edit,
        repair_template: "ACGTACGT",
        repair_template_notes: "Synthetic repair template",
      })),
    },
  ],
  body_map: undefined,
  symptoms: {
    text: "Fever",
    extraction: "keyword",
    terms: [{ id: "HP:0001945", name: "Fever", matched_text: "Fever" }],
    closest_panel_diseases: [
      {
        omim_id: "OMIM:249100",
        disease: "Familial Mediterranean fever",
        score: 2.5,
      },
    ],
  },
};
