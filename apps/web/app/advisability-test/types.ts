export type Band = "high" | "moderate" | "low" | "unavailable";

export type Guide = {
  spacer: string;
  pam: string;
  strand: "+" | "-";
  cut_position: number;
  cut_distance: number;
  gc_content: number;
  allele_specific: boolean;
  score: number;
  notes: string[];
  context: string | null;
  efficiency: number | null;
  /** Each CRISPRon ensemble member's own prediction, keyed by model name. */
  model_scores: Record<string, number> | null;
  /** CRISPRoff energy terms; `crisproff_score` is the model's ΔG input. */
  energy: Energy | null;
};

export type Energy = {
  rna_dna: number;
  rna_dna_weighted: number;
  dna_opening: number;
  spacer_self_fold: number;
  crisproff_score: number;
};

export type Advisability = {
  score: number | null;
  band: Band;
  label: string;
  best_guide: string | null;
  guides_scored: number;
  guides_skipped: number;
  basis: string;
  threshold: number;
  recommended: boolean | null;
};

export type Verdict =
  "recommended" | "not_recommended" | "unavailable" | "no_edit";

/** One call across all proposed edits: the best score against the threshold. */
export type Overview = {
  verdict: Verdict;
  score: number | null;
  band: Band | null;
  threshold: number;
  gene: string | null;
  target: string | null;
  headline: string;
  edits_considered: number;
  basis: string;
};

export type Edit = {
  variation_id: number;
  variant: string;
  strategy: string;
  rationale: string;
  guides: Guide[];
  alternative: string;
  off_target: string;
  advisability: Advisability | null;
  /** Gene-by-name plans only. */
  disease?: string;
  stars?: number;
};

export type Finding = {
  tier: "likely" | "possible" | "carrier";
  disease: string;
  gene: string;
  genotype: { status: string; explanation: string };
  crispr: Edit[];
};

export type Report = {
  conclusion: { label: string };
  overview: Overview;
  summary: { text: string };
  findings: Finding[];
  disclaimer: string;
};

export type GenomeInfo = { id: number; sample_id: string; sex: string };

export type GeneInfo = {
  gene: string;
  disease: string;
  omim_id: string;
  inheritance: string;
  mechanism: string;
  variants: number;
};

export type GenePlan = {
  gene: string;
  overview: Overview;
  edits: Edit[];
  disclaimer: string;
};
