import type { GenomeReport } from "./contract";

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
