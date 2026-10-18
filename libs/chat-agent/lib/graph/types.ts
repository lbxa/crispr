/**
 * Typed property-graph model for Crispr.
 *
 * Only durable entities live in the stored graph. Things that depend on a sequence
 * window (guide RNAs, edit plans) are computed on demand and returned with a
 * retrieval, not stored.
 */

export type NodeType =
  "Patient" | "Variant" | "Gene" | "Disease" | "Phenotype" | "Organ" | "Paper";

export type EdgeType =
  | "HAS_VARIANT" // Patient -> Variant
  | "IN_GENE" // Variant -> Gene
  | "CAUSES" // Variant -> Disease
  | "PRESENTS_WITH" // Disease -> Phenotype
  | "REPORTS" // Patient -> Phenotype
  | "EXPRESSED_IN" // Gene -> Organ
  | "AFFECTS" // Disease -> Organ
  | "HAS_FINDING" // Patient -> Disease
  | "MENTIONS"; // Paper -> (Gene | Disease | Variant)

/** Where a node/edge came from. The UI must surface anything that is not 'pipeline'. */
export type Provenance =
  "illustrative-seed" | "pipeline" | "europepmc" | "derived";

export type Significance =
  | "Pathogenic"
  | "Likely pathogenic"
  | "Uncertain significance"
  | "Likely benign"
  | "Benign";

export type Inheritance = "AD" | "AR" | "XLR" | "XLD";
export type Mechanism =
  "loss_of_function" | "gain_of_function" | "dominant_negative" | "mixed";
export type Zygosity = "het" | "hom" | "hemi";
export type StudyType =
  | "Review"
  | "Systematic review / meta-analysis"
  | "Clinical trial"
  | "Case report"
  | "Preprint"
  | "Research article";

export interface GeneProps {
  symbol: string;
  name: string;
  chrom: string;
  strand: "+" | "-";
  assembly: "GRCh38";
  proteinLength?: number;
}

export interface VariantLocus {
  chrom: string;
  /** 1-based, forward strand, GRCh38. */
  pos: number;
  /** Forward-strand reference allele. For a deletion, the deleted bases. */
  ref: string;
  /** Forward-strand alternate allele. Empty string means a pure deletion. */
  alt: string;
  assembly: "GRCh38";
  /** False until checked against a reference (see EnsemblSequenceProvider.refCheck). */
  verified: boolean;
}

export interface VariantProps {
  hgvsc: string;
  hgvsp: string;
  legacyName?: string;
  rsid?: string;
  proteinPos?: number;
  consequence:
    "missense" | "nonsense" | "frameshift" | "inframe_deletion" | "splice";
  clinvarSignificance: Significance;
  reviewStars: number | null;
  gnomadAf: number | null;
  locus: VariantLocus | null;
}

export interface DiseaseProps {
  name: string;
  inheritance: Inheritance;
  mechanism: Mechanism;
  omim?: string;
  note?: string;
}

export interface PhenotypeProps {
  hpo?: string;
}

export interface OrganProps {
  uberon?: string;
}

export interface PatientProps {
  sex: "F" | "M";
  simulated: true;
}

export interface PaperProps {
  pmid?: string;
  doi?: string;
  title: string;
  abstract: string;
  year: number | null;
  journal?: string;
  studyType: StudyType;
  peerReviewed: boolean;
  citedBy: number;
  source: string;
  fetchedAt: number;
}

export interface NodePropsMap {
  Patient: PatientProps;
  Variant: VariantProps;
  Gene: GeneProps;
  Disease: DiseaseProps;
  Phenotype: PhenotypeProps;
  Organ: OrganProps;
  Paper: PaperProps;
}

export interface FindingProps {
  status: "affected" | "carrier" | "unlikely";
  /** Null for carriers and unlikely findings. */
  tier: "likely" | "possible" | null;
  geneticScore: number;
  phenotypeScore: number;
  combinedScore: number;
  /** Which scorer produced these numbers. 'pipeline' = your production scorer. */
  scoring: "graph-reference-v0" | "pipeline";
}

export interface EdgePropsMap {
  HAS_VARIANT: { zygosity: Zygosity; genotypeQuality?: number };
  IN_GENE: Record<string, never>;
  CAUSES: Record<string, never>;
  PRESENTS_WITH: { frequency: number };
  REPORTS: Record<string, never>;
  EXPRESSED_IN: { level: "high" | "medium" | "low" };
  AFFECTS: { primary: boolean };
  HAS_FINDING: FindingProps;
  MENTIONS: { via: "search-match" | "curated" };
}

export type GNode<T extends NodeType = NodeType> = {
  id: string;
  type: T;
  label: string;
  aliases: string[];
  prov: Provenance;
  props: NodePropsMap[T];
};
export type AnyNode = { [T in NodeType]: GNode<T> }[NodeType];

export type GEdge<T extends EdgeType = EdgeType> = {
  id: string;
  type: T;
  from: string;
  to: string;
  prov: Provenance;
  props: EdgePropsMap[T];
};
export type AnyEdge = { [T in EdgeType]: GEdge<T> }[EdgeType];

export function makeNode<T extends NodeType>(
  type: T,
  id: string,
  label: string,
  props: NodePropsMap[T],
  opts: { aliases?: string[]; prov?: Provenance } = {},
): GNode<T> {
  return {
    id,
    type,
    label,
    aliases: opts.aliases ?? [],
    prov: opts.prov ?? "illustrative-seed",
    props,
  };
}

export function makeEdge<T extends EdgeType>(
  type: T,
  from: string,
  to: string,
  props: EdgePropsMap[T],
  prov: Provenance = "illustrative-seed",
): GEdge<T> {
  return { id: `${type}:${from}->${to}`, type, from, to, prov, props };
}

/** Narrowing helper: returns the node typed as T, or undefined if the type differs. */
export function asType<T extends NodeType>(
  n: AnyNode | undefined,
  type: T,
): GNode<T> | undefined {
  return n && n.type === type ? (n as unknown as GNode<T>) : undefined;
}
