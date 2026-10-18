import { KnowledgeGraph } from "../graph/graph";
import {
  diseasePhenotypes,
  matchPatientToDisease,
  patientPhenotypeIds,
  phenotypeDifferential,
} from "../graph/scoring";
import type { AnyNode, Inheritance, Provenance } from "../graph/types";
import { SEED_NOTICE } from "../graph/seed";
import { buildMetrics } from "../metrics/cards";
import { planEdits, type EditOption } from "../metrics/editplan";
import { designGuides, type Guide } from "../metrics/guides";
import { round2 } from "../metrics/phenotype";
import { evidenceTimeline } from "../papers/rank";
import type { PaperStore } from "../papers/store";
import type { SequenceProvider, SequenceWindow } from "../sequence/provider";
import type {
  EvidencePayload,
  HelixPayload,
  HeatmapData,
  Intent,
  MetricsPayload,
  OrganMapData,
  VizPayload,
} from "../ui/payload";
import { resolveFocus, type Focus } from "./focus";
import { getWindow, makeHelix } from "./helix";
import type { Fact, TurnRegistry } from "./registry";

export interface RetrievalDeps {
  graph: KnowledgeGraph;
  sequences: SequenceProvider;
  papers: PaperStore;
  registry: TurnRegistry;
  windowCache: Map<string, SequenceWindow>;
}

export interface Retrieval {
  intent: Intent;
  focus: Focus;
  facts: Fact[];
  viz: VizPayload | null;
  viz2: VizPayload | null;
  metrics: MetricsPayload;
  helix: HelixPayload | null;
  evidence: EvidencePayload | null;
  /** Set whenever any data in play is not from the production pipeline. */
  dataNotice: string | null;
  edit: {
    guides: Guide[];
    options: EditOption[];
    sequenceSource: string;
  } | null;
}

const INHERITANCE_TEXT: Record<Inheritance, string> = {
  AR: "autosomal recessive: both copies of the gene must carry a pathogenic variant for a person to be affected; one copy makes a carrier",
  AD: "autosomal dominant: one pathogenic copy is enough to be affected",
  XLR: "X-linked recessive: males are affected with one copy, females need two",
  XLD: "X-linked dominant: one pathogenic copy is enough to be affected",
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");

export async function retrieve(
  deps: RetrievalDeps,
  req: { intent: Intent; entityIds: string[] },
): Promise<Retrieval> {
  const { graph: g, registry } = deps;
  const focus = resolveFocus(g, req.entityIds);
  const touched = new Set<string>();
  const facts = new Map<string, Fact>();
  const add = (text: string, nodeIds: string[], prov: Provenance) => {
    const tagged =
      prov === "illustrative-seed" ? `${text} [illustrative data]` : text;
    const f = registry.addFact(tagged, nodeIds, prov);
    facts.set(f.id, f);
    for (const id of nodeIds) touched.add(id);
  };
  const label = (id: string) => g.node(id)?.label ?? id;
  const provOf = (id: string): Provenance => g.node(id)?.prov ?? "derived";

  // ---- fact producers -------------------------------------------------------

  const variantFacts = (vid: string) => {
    const v = g.mustTyped(vid, "Variant");
    const rs = v.props.rsid ? `, ${v.props.rsid}` : "";
    add(
      `${v.label} (${v.props.hgvsc}${rs}) has significance "${v.props.clinvarSignificance}" (${v.props.reviewStars === null ? "review status n/a" : `${v.props.reviewStars}-star review`}); consequence ${v.props.consequence.replace(/_/g, " ")}; gnomAD allele frequency ${v.props.gnomadAf ?? "not loaded"}.`,
      [vid],
      v.prov,
    );
    const l = v.props.locus;
    if (l) {
      add(
        `${v.label} sits at chr${l.chrom}:${l.pos} (${l.assembly}), forward-strand ${l.ref || "-"}>${l.alt || "-"}; the locus is ${l.verified ? "verified" : "NOT verified against a reference"}.`,
        [vid],
        v.prov,
      );
    } else {
      add(
        `${v.label} has no genomic locus loaded, so no sequence window or guides can be built for it.`,
        [vid],
        v.prov,
      );
    }
  };

  const geneFacts = (gid: string) => {
    const gene = g.mustTyped(gid, "Gene");
    const expr = g
      .outEdges(gid, "EXPRESSED_IN")
      .map((e) => `${label(e.to).toLowerCase()} (${e.props.level})`);
    const nVariants = g
      .sources(gid, "IN_GENE")
      .filter((n) => n.type === "Variant").length;
    add(
      `${gene.props.symbol} (${gene.props.name}) is on chromosome ${gene.props.chrom}, ${gene.props.strand} strand${gene.props.proteinLength ? `, protein length ${gene.props.proteinLength} aa` : ""}; ${nVariants} variant(s) loaded; expressed in: ${list(expr)}.`,
      [gid],
      gene.prov,
    );
  };

  const diseaseFacts = (did: string) => {
    const d = g.mustTyped(did, "Disease");
    const organs = g
      .outEdges(did, "AFFECTS")
      .map((e) => `${label(e.to).toLowerCase()}${e.props.primary ? "*" : ""}`);
    const top = diseasePhenotypes(g, did)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 4)
      .map((p) => `${p.label} (${pct(p.frequency)})`);
    add(
      `${d.label} is ${INHERITANCE_TEXT[d.props.inheritance]}; mechanism: ${d.props.mechanism.replace(/_/g, " ")}${d.props.note ? `. ${d.props.note}` : ""}.`,
      [did],
      d.prov,
    );
    add(
      `${d.label} affects: ${list(organs)} (* = primary). Most frequent features: ${list(top)}.`,
      [did],
      d.prov,
    );
  };

  const organFacts = (oid: string) => {
    const genes = g.sources(oid, "EXPRESSED_IN").map((n) => {
      const e = g.outEdges(n.id, "EXPRESSED_IN").find((x) => x.to === oid)!;
      return `${n.label} (${e.props.level})`;
    });
    const diseases = g.sources(oid, "AFFECTS").map((n) => {
      const e = g.outEdges(n.id, "AFFECTS").find((x) => x.to === oid)!;
      return `${n.label}${e.props.primary ? " (primary)" : ""}`;
    });
    add(
      `Genes expressed in the ${label(oid).toLowerCase()}: ${list(genes)}.`,
      [oid],
      provOf(oid),
    );
    add(
      `Diseases affecting the ${label(oid).toLowerCase()}: ${list(diseases)}.`,
      [oid],
      provOf(oid),
    );
  };

  const patientFacts = (pid: string) => {
    const p = g.mustTyped(pid, "Patient");
    const vs = g
      .outEdges(pid, "HAS_VARIANT")
      .map((e) => `${label(e.to)} (${e.props.zygosity})`);
    const ph = patientPhenotypeIds(g, pid).map(label);
    add(
      `${p.label} (${p.props.sex}, simulated) carries: ${list(vs)}. Reported symptoms: ${list(ph)}.`,
      [pid],
      p.prov,
    );
    for (const f of g.outEdges(pid, "HAS_FINDING")) {
      const m = matchPatientToDisease(g, pid, f.to);
      add(
        `Finding for ${p.label}: ${label(f.to)}, status ${f.props.status}${f.props.tier ? `, tier ${f.props.tier}` : ""} (combined ${round2(f.props.combinedScore)}: genetic ${round2(f.props.geneticScore)}, phenotype ${round2(f.props.phenotypeScore)}; scorer ${f.props.scoring}). Symptom coverage ${pct(m.coverage)}, key-feature recall ${pct(m.recall)}${m.unexplained.length ? `; not explained by this disease: ${list(m.unexplained.map(label))}` : ""}.`,
        [pid, f.to],
        f.prov,
      );
    }
  };

  // ---- viz producers --------------------------------------------------------

  const organMap = (
    organIds: string[],
    highlight: string | null,
  ): OrganMapData => ({
    highlight,
    organs: organIds.map((oid) => ({
      id: oid,
      label: label(oid),
      genes: g.sources(oid, "EXPRESSED_IN").map((n) => n.label),
      diseases: g.sources(oid, "AFFECTS").map((n) => ({
        id: n.id,
        label: n.label,
        primary:
          g.outEdges(n.id, "AFFECTS").find((e) => e.to === oid)?.props
            .primary ?? false,
      })),
    })),
  });

  const lollipop = (gid: string, highlight?: string): VizPayload => {
    const gene = g.mustTyped(gid, "Gene");
    const variants = g
      .sources(gid, "IN_GENE")
      .filter(
        (n): n is Extract<AnyNode, { type: "Variant" }> => n.type === "Variant",
      )
      .map((v) => ({
        id: v.id,
        label: v.props.hgvsp,
        position: v.props.proteinPos ?? null,
        significance: v.props.clinvarSignificance,
        consequence: v.props.consequence,
        highlight: v.id === highlight,
      }));
    return {
      type: "lollipop",
      title: `${gene.props.symbol} variants along the protein`,
      provenance: gene.prov,
      data: {
        gene: gene.props.symbol,
        proteinLength: gene.props.proteinLength ?? null,
        variants,
      },
    };
  };

  const heatmap = (
    termIds: string[],
    diseaseIds: Array<{ id: string; support: boolean }>,
    title: string,
  ): VizPayload => {
    const freq = new Map(
      diseaseIds.map((d) => [
        d.id,
        new Map(diseasePhenotypes(g, d.id).map((p) => [p.id, p.frequency])),
      ]),
    );
    const data: HeatmapData = {
      terms: termIds.map((id) => ({ id, label: label(id) })),
      diseases: diseaseIds.map((d) => ({
        id: d.id,
        label: label(d.id),
        geneticSupport: d.support,
      })),
      cells: termIds.map((t) =>
        diseaseIds.map((d) => freq.get(d.id)?.get(t) ?? 0),
      ),
    };
    return { type: "phenotype_heatmap", title, provenance: "derived", data };
  };

  const scoreBreakdown = (pid: string): VizPayload => ({
    type: "score_breakdown",
    title: "How the diagnosis score is built",
    provenance: "derived",
    data: {
      scoring:
        g.outEdges(pid, "HAS_FINDING")[0]?.props.scoring ??
        "graph-reference-v0",
      rows: g.outEdges(pid, "HAS_FINDING").map((e) => ({
        diseaseId: e.to,
        label: label(e.to),
        status: e.props.status,
        tier: e.props.tier,
        genetic: round2(e.props.geneticScore),
        phenotype: round2(e.props.phenotypeScore),
        combined: round2(e.props.combinedScore),
      })),
    },
  });

  const subgraph = (seeds: string[]): VizPayload => {
    const sg = g.neighborhood(seeds, {
      hops: 1,
      maxNodes: 40,
      excludeTypes: ["Paper"],
    });
    return {
      type: "subgraph",
      title: "Neighbourhood in the knowledge graph",
      provenance: "derived",
      data: {
        nodes: sg.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          label: n.label,
        })),
        edges: sg.edges.map((e) => ({ from: e.from, to: e.to, type: e.type })),
      },
    };
  };

  // ---- per-intent assembly --------------------------------------------------

  let viz: VizPayload | null = null;
  let viz2: VizPayload | null = null;
  let evidence: EvidencePayload | null = null;
  let edit: Retrieval["edit"] = null;
  let intent = req.intent;

  const describeFocusEntities = () => {
    if (focus.patientId) patientFacts(focus.patientId);
    if (focus.variantId) variantFacts(focus.variantId);
    if (focus.geneId) geneFacts(focus.geneId);
    if (focus.diseaseId) diseaseFacts(focus.diseaseId);
    if (focus.organId) organFacts(focus.organId);
  };

  // Inheritance without a patient has nothing to reason about; treat it as a disease overview.
  if (intent === "inheritance" && !focus.patientId) intent = "gene_overview";
  if (intent === "explain_diagnosis" && !focus.patientId)
    intent = focus.phenotypeIds.length ? "general" : "gene_overview";

  switch (intent) {
    case "explain_diagnosis": {
      const pid = focus.patientId!;
      patientFacts(pid);
      if (focus.variantId) variantFacts(focus.variantId);
      const findings = g.outEdges(pid, "HAS_FINDING");
      const columns = findings.map((f) => ({ id: f.to, support: true }));
      for (const d of phenotypeDifferential(g, pid)) {
        if (columns.length >= 5) break;
        if (!columns.some((c) => c.id === d.diseaseId))
          columns.push({ id: d.diseaseId, support: false });
      }
      viz = heatmap(
        patientPhenotypeIds(g, pid),
        columns,
        "Symptoms vs candidate diseases",
      );
      viz2 = scoreBreakdown(pid);
      break;
    }
    case "inheritance": {
      const pid = focus.patientId!;
      patientFacts(pid);
      const did = focus.diseaseId;
      if (did) {
        diseaseFacts(did);
        const d = g.mustTyped(did, "Disease");
        const finding = g
          .outEdges(pid, "HAS_FINDING")
          .find((e) => e.to === did);
        const alleles = g
          .outEdges(pid, "HAS_VARIANT")
          .filter((e) => g.outEdges(e.to, "CAUSES").some((c) => c.to === did))
          .map((e) => ({ variant: label(e.to), zygosity: e.props.zygosity }));
        const conclusion =
          finding?.props.status === "affected" ? "affected" : "carrier";
        const reasoning = [
          `${d.label} is ${INHERITANCE_TEXT[d.props.inheritance]}.`,
          `${label(pid)} carries: ${list(alleles.map((a) => `${a.variant} (${a.zygosity})`))}.`,
          conclusion === "affected"
            ? "That meets the inheritance rule, so the patient is classed as affected."
            : "That does not meet the inheritance rule, so the patient is classed as a carrier, not as affected.",
        ];
        add(reasoning.join(" "), [pid, did], provOf(did));
        viz = {
          type: "inheritance_card",
          title: "Why affected or carrier",
          provenance: "derived",
          data: {
            patient: label(pid),
            disease: d.label,
            mode: d.props.inheritance,
            conclusion,
            alleles,
            reasoning,
          },
        };
      }
      if (focus.variantId) variantFacts(focus.variantId);
      break;
    }
    case "edit_design": {
      describeFocusEntities();
      const vid = focus.variantId;
      const variant = vid ? g.typed(vid, "Variant") : undefined;
      if (variant && vid) {
        const disease = focus.diseaseId
          ? g.typed(focus.diseaseId, "Disease")
          : undefined;
        const w = await getWindow(
          deps.sequences,
          deps.windowCache,
          vid,
          variant.props,
        );
        const locus = variant.props.locus;
        const guides =
          w && locus
            ? designGuides(w.sequence, {
                start: w.variantStart,
                end: w.variantEnd,
                ref: locus.ref,
                alt: locus.alt,
              })
            : [];
        const sequenceSource = w?.source ?? "none";
        const options = planEdits({
          variant: variant.props,
          disease: disease?.props,
          guides,
          sequenceSource,
        });
        edit = { guides, options, sequenceSource };

        if (w?.source === "synthetic") {
          add(
            "The sequence window is a SYNTHETIC placeholder, so guide positions and cut distances show how the method works but are not real genome positions.",
            [vid],
            "derived",
          );
        }
        if (w?.refCheck === "mismatch") {
          add(
            "The stored reference allele does NOT match the real reference sequence, so this locus is probably wrong.",
            [vid],
            "derived",
          );
        }
        const best = guides[0];
        if (best) {
          add(
            `Best guide by geometry: ${best.strand} strand, protospacer ${best.protospacer}, PAM ${best.pam}, cut ${best.cutDistance} bp from the variant, GC ${best.gc}%${best.polyT ? ", contains TTTT" : ""}. Ranked by cut distance and sequence flags, not predicted efficiency.`,
            [vid],
            "derived",
          );
        } else if (locus) {
          add(
            "No SpCas9 PAM was found within 30 bp of the variant in this window.",
            [vid],
            "derived",
          );
        }
        for (const o of options) {
          const crit = o.criteria
            .filter((c) => c.label !== "Sequence source")
            .map((c) => `${c.label}: ${c.value}`)
            .join("; ");
          add(
            `${o.label}: ${o.feasible ? "feasible" : "not feasible"} on screening heuristics (${crit}). ${o.caveat ?? ""}`.trim(),
            [vid],
            "derived",
          );
        }
        add(
          "Off-target risk has NOT been assessed for any option, and on-target efficiency is not predicted.",
          [vid],
          "derived",
        );

        viz = {
          type: "edit_comparison",
          title: "Edit strategies compared",
          provenance: "derived",
          data: { options },
        };
        viz2 = {
          type: "guide_scatter",
          title: "Candidate guides: cut distance vs GC",
          provenance: "derived",
          data: { guides, sequenceSource },
        };
      } else {
        add(
          "No variant is in focus, so no edit can be designed. Name a variant or a gene with a loaded variant.",
          [],
          "derived",
        );
      }
      break;
    }
    case "evidence": {
      describeFocusEntities();
      const ids = [focus.geneId, focus.diseaseId, focus.variantId].filter(
        (x): x is string => !!x,
      );
      const cached = deps.papers
        .cachedFor(ids)
        .sort((a, b) => b.props.citedBy - a.props.citedBy)
        .slice(0, 8);
      if (cached.length) {
        evidence = {
          papers: cached.map((p) => registry.addPaper(p)),
          timeline: evidenceTimeline(cached.map((p) => p.props)),
          source: "graph-cache",
        };
        viz = {
          type: "evidence_timeline",
          title: "Evidence by year and study type",
          provenance: "europepmc",
          data: { byYear: evidence.timeline },
        };
      }
      break;
    }
    case "organ_overview": {
      describeFocusEntities();
      viz = {
        type: "organ_map",
        title: `${label(focus.organId!)}: genes and diseases`,
        provenance: provOf(focus.organId!),
        data: organMap([focus.organId!], focus.organId!),
      };
      viz2 = subgraph([focus.organId!]);
      break;
    }
    case "gene_overview": {
      describeFocusEntities();
      if (focus.geneId) {
        viz = lollipop(focus.geneId, focus.variantId);
        const organs = g
          .outEdges(focus.geneId, "EXPRESSED_IN")
          .map((e) => e.to);
        if (organs.length)
          viz2 = {
            type: "organ_map",
            title: "Where the gene is expressed",
            provenance: provOf(focus.geneId),
            data: organMap(organs, null),
          };
      } else if (focus.diseaseId) {
        viz = subgraph([focus.diseaseId]);
      }
      break;
    }
    case "general": {
      if (focus.phenotypeIds.length) {
        const ranked = g
          .ofType("Disease")
          .map((d) => ({
            id: d.id,
            m: matchPatientToTerms(g, focus.phenotypeIds, d.id),
          }))
          .filter((r) => r.m > 0)
          .sort((a, b) => b.m - a.m)
          .slice(0, 5);
        add(
          `Symptoms ${list(focus.phenotypeIds.map(label))} fit these diseases best on phenotype alone (no genetic evidence): ${list(ranked.map((r) => `${label(r.id)} (${round2(r.m)})`))}.`,
          [...focus.phenotypeIds, ...ranked.map((r) => r.id)],
          "derived",
        );
        viz = heatmap(
          focus.phenotypeIds,
          ranked.map((r) => ({ id: r.id, support: false })),
          "Symptoms vs diseases (phenotype only)",
        );
      } else if (req.entityIds.length) {
        describeFocusEntities();
        viz = subgraph(req.entityIds);
      }
      break;
    }
  }

  // Helix follows the focused variant on every turn; guide marks only for edit design.
  let helix: HelixPayload | null = null;
  if (focus.variantId) {
    const variant = g.typed(focus.variantId, "Variant");
    if (variant?.props.locus) {
      const w = await getWindow(
        deps.sequences,
        deps.windowCache,
        focus.variantId,
        variant.props,
      );
      if (w)
        helix = makeHelix(variant.label, variant.props, w, edit?.guides[0]);
    }
  }

  const paperStats = evidence
    ? {
        count: evidence.papers.length,
        preprints: evidence.papers.filter((p) => !p.peerReviewed).length,
      }
    : undefined;
  const metrics = buildMetrics(g, {
    focus,
    guides: edit?.guides,
    sequenceSource: edit?.sequenceSource,
    paperStats,
  });

  const notices: string[] = [];
  if ([...touched].some((id) => g.node(id)?.prov === "illustrative-seed"))
    notices.push(SEED_NOTICE);
  if (helix?.sequenceSource === "synthetic")
    notices.push("Sequence shown is synthetic, not the real genome.");

  return {
    intent,
    focus,
    facts: [...facts.values()],
    viz,
    viz2,
    metrics,
    helix,
    evidence,
    dataNotice: notices.length ? notices.join(" ") : null,
    edit,
  };
}

/** Frequency-weighted overlap of a bare set of symptom terms with one disease. */
function matchPatientToTerms(
  g: KnowledgeGraph,
  termIds: string[],
  diseaseId: string,
): number {
  const dp = diseasePhenotypes(g, diseaseId);
  const total = dp.reduce((s, p) => s + p.frequency, 0);
  const hit = dp
    .filter((p) => termIds.includes(p.id))
    .reduce((s, p) => s + p.frequency, 0);
  return total === 0 ? 0 : hit / total;
}
