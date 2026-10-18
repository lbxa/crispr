import type { UIMessage } from "ai";
import type { NodeType, StudyType } from "../graph/types";
import type { EditOption } from "../metrics/editplan";
import type { Guide } from "../metrics/guides";

/** Everything the UI renders arrives as one of these typed data parts. */

export type Intent =
  | "explain_diagnosis"
  | "gene_overview"
  | "organ_overview"
  | "edit_design"
  | "inheritance"
  | "evidence"
  | "general";

export type CardStatus =
  "ok" | "warn" | "info" | "not_assessed" | "not_computed";

export interface MetricCard {
  id: string;
  label: string;
  value: string | number | null;
  status: CardStatus;
  detail?: string;
  provenance?: string;
}

export const OFF_TARGET_NOTICE =
  "Off-target risk has NOT been assessed for any edit plan. Do not read a missing score as a clean one.";

export interface MetricsPayload {
  cards: MetricCard[];
  /** Constant. Lets the UI keep a persistent chip even when panels are collapsed. */
  offTarget: "not_assessed";
  notice: string;
}

export interface HelixMark {
  kind: "variant" | "deletion_junction" | "pam" | "cut_site" | "guide";
  start: number;
  end: number;
  label: string;
  strand?: "+" | "-";
}

export interface HelixPayload {
  locusLabel: string;
  sequence: string;
  sequenceSource: "synthetic" | "ensembl-GRCh38";
  refCheck: "match" | "mismatch" | "unchecked";
  windowStartPos: number;
  marks: HelixMark[];
  note?: string;
}

export interface LollipopData {
  gene: string;
  proteinLength: number | null;
  variants: Array<{
    id: string;
    label: string;
    position: number | null;
    significance: string;
    consequence: string | null;
    highlight: boolean;
  }>;
}

export interface HeatmapData {
  terms: Array<{ id: string; label: string }>;
  diseases: Array<{ id: string; label: string; geneticSupport: boolean }>;
  /** cells[termIndex][diseaseIndex] = frequency of that feature in that disease (0 if absent). */
  cells: number[][];
}

export interface ScoreBreakdownData {
  scoring: string;
  rows: Array<{
    diseaseId: string;
    label: string;
    status: string;
    tier: string | null;
    /** Null when the source reports a tier without a score. */
    genetic: number | null;
    phenotype: number | null;
    combined: number | null;
  }>;
}

export interface OrganMapData {
  highlight: string | null;
  organs: Array<{
    id: string;
    label: string;
    genes: string[];
    diseases: Array<{ id: string; label: string; primary: boolean }>;
  }>;
}

export interface SubgraphData {
  nodes: Array<{ id: string; type: NodeType; label: string }>;
  edges: Array<{ from: string; to: string; type: string }>;
}

export interface InheritanceData {
  patient: string;
  disease: string;
  mode: string;
  conclusion: "affected" | "carrier";
  alleles: Array<{ variant: string; zygosity: string }>;
  reasoning: string[];
}

export interface EvidenceTimelineData {
  byYear: Array<{
    year: number;
    total: number;
    byType: Partial<Record<StudyType, number>>;
  }>;
}

export type VizPayload = { title: string; provenance: string } & (
  | { type: "lollipop"; data: LollipopData }
  | { type: "phenotype_heatmap"; data: HeatmapData }
  | { type: "score_breakdown"; data: ScoreBreakdownData }
  | { type: "guide_scatter"; data: { guides: Guide[]; sequenceSource: string } }
  | { type: "edit_comparison"; data: { options: EditOption[] } }
  | { type: "organ_map"; data: OrganMapData }
  | { type: "evidence_timeline"; data: EvidenceTimelineData }
  | { type: "subgraph"; data: SubgraphData }
  | { type: "inheritance_card"; data: InheritanceData }
);

export interface PaperRef {
  /** Citation handle for this turn, e.g. "P2". */
  ref: string;
  nodeId: string;
  title: string;
  year: number | null;
  journal?: string;
  studyType: StudyType;
  peerReviewed: boolean;
  pmid?: string;
  doi?: string;
  citedBy: number;
  snippet: string;
}

export interface EvidencePayload {
  papers: PaperRef[];
  timeline: EvidenceTimelineData["byYear"];
  source: "graph-cache" | "europepmc" | "both" | "none";
  /** Set when live search failed or was skipped. The answer must disclose it. */
  note?: string;
}

export interface FocusPayload {
  entities: Array<{
    id: string;
    type: NodeType;
    label: string;
    method: "exact" | "fuzzy";
  }>;
  primary: { id: string; type: NodeType; label: string } | null;
  intent: Intent;
  /** Highest-risk provenance among the facts in play. Non-'pipeline' values must be shown. */
  dataNotice: string | null;
}

export interface StatusPayload {
  phase: "linking" | "retrieving" | "searching_papers" | "answering";
  detail?: string;
}

export interface SuggestionsPayload {
  prompts: string[];
}

export interface GroundingPayload {
  citedFacts: string[];
  citedPapers: string[];
  /** Citation handles in the answer that were never issued this turn. */
  unknown: string[];
  offTarget: "not_assessed";
  /** Text behind every handle issued this turn, so the UI can show it on hover. */
  facts: Record<string, string>;
  papers: Record<string, string>;
}

export type CrisprDataParts = {
  status: StatusPayload;
  focus: FocusPayload;
  helix: HelixPayload | null;
  viz: VizPayload;
  /** Optional second chart (e.g. score breakdown beside the heatmap). */
  viz2: VizPayload;
  metrics: MetricsPayload;
  evidence: EvidencePayload;
  suggestions: SuggestionsPayload;
  grounding: GroundingPayload;
};

export type CrisprUIMessage = UIMessage<never, CrisprDataParts>;
