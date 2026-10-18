import { KnowledgeGraph } from '../graph/graph';
import { matchPatientToDisease } from '../graph/scoring';
import type { Focus } from '../retrieval/focus';
import { OFF_TARGET_NOTICE, type MetricCard, type MetricsPayload } from '../ui/payload';
import { round2 } from './phenotype';
import type { Guide } from './guides';

/**
 * General context on delivery, not a recommendation. Delivery decides whether an edit
 * is practical at all, so it is shown next to the edit metrics.
 */
export const DELIVERY_CONTEXT: Record<string, string> = {
  'org:liver': 'Lipid nanoparticles are the most widely used route to hepatocytes.',
  'org:blood': 'Typically ex vivo: edit hematopoietic stem cells outside the body, then transplant.',
  'org:lung': 'No established in vivo route; delivery to airway cells is an open challenge.',
  'org:pancreas': 'No established in vivo route; delivery is an open challenge.',
  'org:brain': 'Crossing the blood-brain barrier is an open delivery challenge.',
};

export interface CardInput {
  focus: Focus;
  guides?: Guide[];
  sequenceSource?: string;
  paperStats?: { count: number; preprints: number };
}

const stars = (n: number | null) => (n === null ? 'review status n/a' : `${n}-star review`);

export function buildMetrics(g: KnowledgeGraph, { focus, guides, sequenceSource, paperStats }: CardInput): MetricsPayload {
  const cards: MetricCard[] = [];

  if (focus.patientId && focus.diseaseId) {
    const edge = g.outEdges(focus.patientId, 'HAS_FINDING').find((e) => e.to === focus.diseaseId);
    const disease = g.node(focus.diseaseId);
    if (edge && disease) {
      const p = edge.props;
      cards.push({
        id: 'diagnosis',
        label: `Diagnosis: ${disease.label}`,
        value: p.status === 'affected' ? (p.tier ?? 'affected') : p.status,
        status: p.tier === 'likely' ? 'ok' : 'warn',
        detail: `combined ${round2(p.combinedScore)} (genetic ${round2(p.geneticScore)}, phenotype ${round2(p.phenotypeScore)}); scorer: ${p.scoring}`,
        provenance: edge.prov,
      });
    }
    const m = matchPatientToDisease(g, focus.patientId, focus.diseaseId);
    if (g.outEdges(focus.patientId, 'REPORTS').length > 0) {
      const unexplained = m.unexplained.map((id) => g.node(id)?.label ?? id);
      cards.push({
        id: 'phenotype_match',
        label: 'Phenotype match',
        value: `${Math.round(m.coverage * 100)}% of symptoms explained`,
        status: m.coverage >= 0.5 ? 'ok' : 'warn',
        detail: `key-feature recall ${round2(m.recall)}, frequency-weighted ${round2(m.freqWeighted)}${unexplained.length ? `; unexplained: ${unexplained.join(', ')}` : ''}`,
        provenance: 'derived',
      });
    }
  }

  if (focus.variantId) {
    const v = g.typed(focus.variantId, 'Variant');
    if (v) {
      const zyg = focus.patientId
        ? g.outEdges(focus.patientId, 'HAS_VARIANT').find((e) => e.to === v.id)?.props.zygosity
        : undefined;
      cards.push({
        id: 'variant',
        label: `Variant: ${v.label}`,
        value: v.props.clinvarSignificance,
        status: v.props.clinvarSignificance === 'Pathogenic' || v.props.clinvarSignificance === 'Likely pathogenic' ? 'ok' : 'warn',
        detail: `${stars(v.props.reviewStars)}; gnomAD AF ${v.props.gnomadAf ?? 'not loaded'}${zyg ? `; zygosity ${zyg}` : ''}`,
        provenance: v.prov,
      });
    }
  }

  if (guides && guides.length > 0) {
    const best = guides[0]!;
    cards.push(
      {
        id: 'guide',
        label: 'Best guide (by geometry)',
        value: `cut ${best.cutDistance} bp from variant`,
        status: best.cutDistance <= 10 ? 'ok' : 'warn',
        detail: `${best.strand} strand, GC ${best.gc}%${best.polyT ? ', contains TTTT (U6 terminator)' : ''}; ranked by cut distance and sequence flags, not predicted efficiency; sequence: ${sequenceSource ?? 'unknown'}`,
        provenance: 'derived',
      },
      {
        id: 'on_target',
        label: 'On-target efficiency',
        value: null,
        status: 'not_computed',
        detail: 'No efficiency predictor is wired in.',
        provenance: 'derived',
      },
    );
  }

  if (focus.diseaseId) {
    const primary = g
      .outEdges(focus.diseaseId, 'AFFECTS')
      .filter((e) => e.props.primary)
      .map((e) => e.to)[0];
    const note = primary ? DELIVERY_CONTEXT[primary] : undefined;
    if (primary && note) {
      cards.push({
        id: 'delivery',
        label: 'Delivery context',
        value: g.node(primary)?.label ?? primary,
        status: 'info',
        detail: note,
        provenance: 'derived',
      });
    }
  }

  if (paperStats) {
    cards.push({
      id: 'evidence',
      label: 'Literature found',
      value: `${paperStats.count} papers`,
      status: paperStats.count > 0 ? 'info' : 'warn',
      detail: paperStats.preprints > 0 ? `${paperStats.preprints} are preprints (not peer reviewed)` : 'all peer reviewed',
      provenance: 'europepmc',
    });
  }

  // Safety invariant: any context with a variant or a guide carries an explicit off-target card.
  if (focus.variantId || (guides && guides.length > 0)) {
    cards.push({
      id: 'off_target',
      label: 'Off-target risk',
      value: 'Not assessed',
      status: 'not_assessed',
      detail: OFF_TARGET_NOTICE,
      provenance: 'derived',
    });
  }

  return { cards, offTarget: 'not_assessed', notice: OFF_TARGET_NOTICE };
}
