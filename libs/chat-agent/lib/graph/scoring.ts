import { KnowledgeGraph } from "./graph";
import type {
  FindingProps,
  Inheritance,
  Significance,
  Zygosity,
} from "./types";
import { makeEdge } from "./types";
import {
  scorePhenotypes,
  type DiseasePhenotype,
  type PhenotypeMatch,
} from "../metrics/phenotype";

/**
 * Reference scorer that reproduces the pipeline's "genetics + symptoms" ranking from
 * graph data. It exists so the graph is useful before your production scores are
 * ingested; ingest() overrides it with scoring: 'pipeline' whenever scores are supplied.
 */

const SIG_WEIGHT: Record<Significance, number> = {
  Pathogenic: 1,
  "Likely pathogenic": 0.8,
  "Uncertain significance": 0.3,
  "Likely benign": 0,
  Benign: 0,
};

const ALLELES: Record<Zygosity, number> = { hom: 2, het: 1, hemi: 2 };

export function isAffected(
  inheritance: Inheritance,
  sex: "F" | "M",
  alleles: number,
): boolean {
  switch (inheritance) {
    case "AD":
    case "XLD":
      return alleles >= 1;
    case "AR":
      return alleles >= 2;
    case "XLR":
      return sex === "M" ? alleles >= 1 : alleles >= 2;
  }
}

export interface GeneticEvidence {
  diseaseId: string;
  alleles: number;
  variants: Array<{ variantId: string; zygosity: Zygosity }>;
  bestSignificance: Significance;
  bestStars: number | null;
  affected: boolean;
}

export function diseasePhenotypes(
  g: KnowledgeGraph,
  diseaseId: string,
): DiseasePhenotype[] {
  return g.outEdges(diseaseId, "PRESENTS_WITH").map((e) => ({
    id: e.to,
    label: g.node(e.to)?.label ?? e.to,
    frequency: e.props.frequency,
  }));
}

export function patientPhenotypeIds(
  g: KnowledgeGraph,
  patientId: string,
): string[] {
  return g.outEdges(patientId, "REPORTS").map((e) => e.to);
}

export function matchPatientToDisease(
  g: KnowledgeGraph,
  patientId: string,
  diseaseId: string,
): PhenotypeMatch {
  return scorePhenotypes(
    patientPhenotypeIds(g, patientId),
    diseasePhenotypes(g, diseaseId),
  );
}

/** Group a patient's variants by the disease they cause and apply inheritance rules. */
export function geneticEvidence(
  g: KnowledgeGraph,
  patientId: string,
): GeneticEvidence[] {
  const patient = g.mustTyped(patientId, "Patient");
  const byDisease = new Map<string, GeneticEvidence>();
  for (const hv of g.outEdges(patientId, "HAS_VARIANT")) {
    const variant = g.mustTyped(hv.to, "Variant");
    for (const c of g.outEdges(variant.id, "CAUSES")) {
      let ev = byDisease.get(c.to);
      if (!ev) {
        ev = {
          diseaseId: c.to,
          alleles: 0,
          variants: [],
          bestSignificance: variant.props.clinvarSignificance,
          bestStars: variant.props.reviewStars,
          affected: false,
        };
        byDisease.set(c.to, ev);
      }
      ev.alleles += ALLELES[hv.props.zygosity];
      ev.variants.push({ variantId: variant.id, zygosity: hv.props.zygosity });
      if (
        SIG_WEIGHT[variant.props.clinvarSignificance] >
        SIG_WEIGHT[ev.bestSignificance]
      ) {
        ev.bestSignificance = variant.props.clinvarSignificance;
        ev.bestStars = variant.props.reviewStars;
      }
    }
  }
  for (const ev of byDisease.values()) {
    const disease = g.mustTyped(ev.diseaseId, "Disease");
    ev.affected = isAffected(
      disease.props.inheritance,
      patient.props.sex,
      ev.alleles,
    );
  }
  return [...byDisease.values()];
}

/** The reference scorer always produces numbers, unlike tiers reported without scores. */
export interface Finding extends Omit<
  FindingProps,
  "geneticScore" | "phenotypeScore" | "combinedScore"
> {
  geneticScore: number;
  phenotypeScore: number;
  combinedScore: number;
  diseaseId: string;
  match: PhenotypeMatch;
  evidence: GeneticEvidence;
}

export const TIER_LIKELY = 0.6;

export function rankDiagnoses(g: KnowledgeGraph, patientId: string): Finding[] {
  const out: Finding[] = [];
  for (const ev of geneticEvidence(g, patientId)) {
    const sigWeight = SIG_WEIGHT[ev.bestSignificance];
    if (sigWeight === 0) continue;
    const starFactor = 0.85 + 0.05 * Math.min(ev.bestStars ?? 1, 3);
    const geneticScore = sigWeight * starFactor * (ev.affected ? 1 : 0.35);
    const match = matchPatientToDisease(g, patientId, ev.diseaseId);
    const phenotypeScore = 0.5 * match.coverage + 0.5 * match.freqWeighted;
    const combinedScore = 0.5 * geneticScore + 0.5 * phenotypeScore;
    const status: FindingProps["status"] = ev.affected ? "affected" : "carrier";
    // Carriers are never given a diagnostic tier: one recessive copy does not cause disease.
    const tier: FindingProps["tier"] = ev.affected
      ? combinedScore >= TIER_LIKELY
        ? "likely"
        : "possible"
      : null;
    out.push({
      diseaseId: ev.diseaseId,
      status,
      tier,
      geneticScore,
      phenotypeScore,
      combinedScore,
      scoring: "graph-reference-v0",
      match,
      evidence: ev,
    });
  }
  return out.sort((a, b) => b.combinedScore - a.combinedScore);
}

/** Materialise the reference scorer's output as HAS_FINDING edges. */
export function writeFindings(g: KnowledgeGraph, patientId: string): Finding[] {
  const findings = rankDiagnoses(g, patientId);
  for (const f of findings) {
    g.addEdge(
      makeEdge(
        "HAS_FINDING",
        patientId,
        f.diseaseId,
        {
          status: f.status,
          tier: f.tier,
          geneticScore: f.geneticScore,
          phenotypeScore: f.phenotypeScore,
          combinedScore: f.combinedScore,
          scoring: f.scoring,
        },
        "derived",
      ),
    );
  }
  return findings;
}

/**
 * Phenotype-only differential: how well each disease in the graph fits the symptoms,
 * ignoring genetics. Used for the heatmap's "other candidates" columns, and always
 * labelled as having no genetic support.
 */
export function phenotypeDifferential(
  g: KnowledgeGraph,
  patientId: string,
): Array<{ diseaseId: string; match: PhenotypeMatch }> {
  return g
    .ofType("Disease")
    .map((d) => ({
      diseaseId: d.id,
      match: matchPatientToDisease(g, patientId, d.id),
    }))
    .filter((r) => r.match.matched.length > 0)
    .sort((a, b) => b.match.freqWeighted - a.match.freqWeighted);
}
