import { KnowledgeGraph } from "../graph/graph";
import type { AnyNode, NodeType } from "../graph/types";

export interface Focus {
  patientId?: string;
  variantId?: string;
  geneId?: string;
  diseaseId?: string;
  organId?: string;
  phenotypeIds: string[];
  /** The entity the user actually named, by priority. Derived ids never become primary. */
  primary: { id: string; type: NodeType; label: string } | null;
}

const PRIORITY: NodeType[] = [
  "Patient",
  "Variant",
  "Gene",
  "Disease",
  "Organ",
  "Phenotype",
];

/**
 * Turn a bag of linked entity ids into one coherent focus.
 * Mentioned entities win; missing links are derived by walking the graph
 * (patient -> finding -> disease, variant -> gene, gene -> a representative variant, ...).
 */
export function resolveFocus(g: KnowledgeGraph, entityIds: string[]): Focus {
  const nodes = entityIds
    .map((id) => g.node(id))
    .filter((n): n is AnyNode => n !== undefined);
  const first = (t: NodeType) => nodes.find((n) => n.type === t)?.id;

  const focus: Focus = {
    patientId: first("Patient"),
    variantId: first("Variant"),
    geneId: first("Gene"),
    diseaseId: first("Disease"),
    organId: first("Organ"),
    phenotypeIds: nodes.filter((n) => n.type === "Phenotype").map((n) => n.id),
    primary: null,
  };

  for (const t of PRIORITY) {
    const n = nodes.find((x) => x.type === t);
    if (n) {
      focus.primary = { id: n.id, type: n.type, label: n.label };
      break;
    }
  }

  const withLocusFirst = (variants: AnyNode[]): string | undefined => {
    const vs = variants.filter((v) => v.type === "Variant");
    return (vs.find((v) => v.type === "Variant" && v.props.locus) ?? vs[0])?.id;
  };

  if (focus.patientId) {
    const findings = [...g.outEdges(focus.patientId, "HAS_FINDING")].sort(
      (a, b) =>
        Number(b.props.status === "affected") -
          Number(a.props.status === "affected") ||
        (b.props.combinedScore ?? -1) - (a.props.combinedScore ?? -1),
    );
    focus.diseaseId ??= findings[0]?.to;
    if (!focus.variantId) {
      const carried = g
        .outEdges(focus.patientId, "HAS_VARIANT")
        .map((e) => e.to);
      focus.variantId =
        carried.find(
          (v) =>
            focus.diseaseId &&
            g.outEdges(v, "CAUSES").some((c) => c.to === focus.diseaseId),
        ) ?? carried[0];
    }
  }

  if (focus.variantId) {
    focus.geneId ??= g.targets(focus.variantId, "IN_GENE")[0]?.id;
    focus.diseaseId ??= g.targets(focus.variantId, "CAUSES")[0]?.id;
  } else if (focus.geneId) {
    focus.variantId = withLocusFirst(g.sources(focus.geneId, "IN_GENE"));
    if (focus.variantId)
      focus.diseaseId ??= g.targets(focus.variantId, "CAUSES")[0]?.id;
  } else if (focus.diseaseId) {
    focus.variantId = withLocusFirst(g.sources(focus.diseaseId, "CAUSES"));
    if (focus.variantId)
      focus.geneId = g.targets(focus.variantId, "IN_GENE")[0]?.id;
  }

  return focus;
}
