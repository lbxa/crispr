import type { GenePlan } from "./contract";

const spacer = "GCTGCTAGACTCCTTCATAT";

/** Shaped like GET /genes/MEFV/crispr after projection. */
export const plan: GenePlan = {
  gene: "MEFV",
  overview: {
    verdict: "recommended",
    score: 55.8,
    band: "moderate",
    threshold: 50,
    gene: "MEFV",
    target: "MEFV variant 2",
    headline:
      "CRISPR is advisable: predicted efficiency 56/100 meets the 50 threshold.",
    edits_considered: 1,
    basis:
      "Highest CRISPRon-predicted SpCas9 indel frequency among the proposed guides.",
  },
  edits: [
    {
      variation_id: 2,
      variant: "MEFV variant 2",
      disease: "Familial Mediterranean fever",
      strategy: "Homology-directed repair (correction)",
      rationale: "The disease comes from losing working protein.",
      guides: [
        {
          spacer,
          pam: "AGG",
          strand: "-",
          cut_position: 1100,
          cut_distance: 0,
          gc_content: 0.45,
          allele_specific: true,
          score: 112,
          notes: ["Variant is in the seed/PAM: cuts the mutant allele only"],
          context: `TCGC${spacer}AGGAGT`,
          efficiency: 55.8,
          model_scores: { "1.model.best": 54.2, "2.model.best": 57.4 },
          energy: {
            rna_dna: -23.65,
            rna_dna_weighted: -42.17,
            dna_opening: 24.23,
            spacer_self_fold: 0,
            crisproff_score: 17.94,
          },
        },
      ],
      alternative: "Adenine base editor (ABE) could revert A>G.",
      off_target:
        "Not assessed. Run a genome-wide off-target search before any lab use.",
      advisability: {
        score: 55.8,
        band: "moderate",
        label: "CRISPR editing is feasible but less efficient",
        best_guide: spacer,
        guides_scored: 1,
        guides_skipped: 0,
        basis: "Highest CRISPRon-predicted SpCas9 indel frequency.",
        threshold: 50,
        recommended: true,
      },
    },
  ],
  disclaimer: "Research prototype. Not a medical diagnosis.",
};

export const notAdvisablePlan: GenePlan = {
  ...plan,
  gene: "FGFR3",
  overview: {
    ...plan.overview,
    verdict: "not_recommended",
    score: 47.6,
    gene: "FGFR3",
    target: "FGFR3 G380R",
    headline:
      "CRISPR is not advisable: predicted efficiency 48/100 is below the 50 threshold.",
  },
};
