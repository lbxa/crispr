import type { GenomeView } from "./genome-view";

/** Synthetic contract fixture with real-shaped coordinates; no patient data. */
export const genomeView: GenomeView = {
  version: 1,
  assembly: "GRCh38",
  coordinate_system: "zero-based-half-open",
  chromosomes: [
    { id: "7", length: 159345973 },
    { id: "16", length: 90338345 },
  ],
  regions: [
    {
      id: "fixture-cftr",
      chromosome: "7",
      start: 117559589,
      end: 117559593,
      reference: "ATCT",
      alternate: "A",
      clinical_significance: "Pathogenic",
      zygosity: "heterozygous",
      annotations: [
        { gene: "CFTR", disease: "Cystic fibrosis", tier: "carrier" },
      ],
      reference_context: {
        start: 117559585,
        end: 117559597,
        bases: "ACGTATCTGGCA",
      },
    },
    {
      id: "fixture-mefv",
      chromosome: "16",
      start: 3293405,
      end: 3293406,
      reference: "G",
      alternate: "A",
      clinical_significance: "Pathogenic",
      zygosity: "homozygous",
      annotations: [
        {
          gene: "MEFV",
          disease: "Familial Mediterranean fever",
          tier: "possible",
        },
      ],
      reference_context: { start: 3293401, end: 3293410, bases: "ACGTGTCGA" },
    },
  ],
};
