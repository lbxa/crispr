import { KnowledgeGraph } from "../graph/graph";
import {
  makeEdge,
  makeNode,
  type Significance,
  type VariantLocus,
} from "../graph/types";
import type { ClinVarDataset, ClinVarRecord } from "./variant-summary";

const AA: Record<string, string> = {
  Ala: "A",
  Arg: "R",
  Asn: "N",
  Asp: "D",
  Cys: "C",
  Gln: "Q",
  Glu: "E",
  Gly: "G",
  His: "H",
  Ile: "I",
  Leu: "L",
  Lys: "K",
  Met: "M",
  Phe: "F",
  Pro: "P",
  Ser: "S",
  Thr: "T",
  Trp: "W",
  Tyr: "Y",
  Val: "V",
  Ter: "X",
};

/** "NM_000492.4(CFTR):c.1521_1523del (p.Phe508del)" -> its c. and p. parts. */
export function splitName(name: string): { hgvsc: string; hgvsp: string } {
  return {
    hgvsc: name.match(/:(c\.[^\s(]+)/)?.[1] ?? name,
    hgvsp: name.match(/\((p\.[^)]+)\)\s*$/)?.[1] ?? "",
  };
}

/** p.Phe508del -> F508del, for linking legacy names; empty when not convertible. */
export function oneLetter(hgvsp: string): string {
  const m = hgvsp.match(/^p\.([A-Z][a-z]{2})(\d+)(.*)$/);
  if (!m || !AA[m[1]!]) return "";
  const tail = m[3]!.replace(/^([A-Z][a-z]{2})(?=$|fs)/, (x) => AA[x] ?? x);
  return /[A-Z][a-z]{2}/.test(tail) ? "" : `${AA[m[1]!]}${m[2]}${tail}`;
}

/** The scorer's five classes. A combined P/LP call is weighted as Likely pathogenic. */
const SCORER_CLASS: Record<string, Significance> = {
  Pathogenic: "Pathogenic",
  "Likely pathogenic": "Likely pathogenic",
  "Pathogenic/Likely pathogenic": "Likely pathogenic",
};

/** VCF alleles share an anchor base for indels; the graph stores them without it. */
function locusOf(r: ClinVarRecord): VariantLocus | null {
  if (r.pos === null || r.ref === null || r.alt === null) return null;
  let { pos, ref, alt } = r;
  if (ref.length !== alt.length && ref[0] === alt[0]) {
    pos += 1;
    ref = ref.slice(1);
    alt = alt.slice(1);
  }
  return { chrom: r.chrom, pos, ref, alt, assembly: "GRCh38", verified: false };
}

export const variantId = (variationId: number) => `var:vcv${variationId}`;
export const diseaseId = (omimId: string) =>
  `dis:omim-${omimId.replace("OMIM:", "")}`;

/**
 * Graph from an imported ClinVar dataset: panel diseases (from the backend config),
 * their genes, and each kept ClinVar record as a Variant quoting ClinVar verbatim.
 * Nothing ClinVar does not provide is filled in: no phenotypes, organs, gene names,
 * strands, consequences, protein lengths or allele frequencies.
 */
export function buildClinVarGraph(ds: ClinVarDataset): KnowledgeGraph {
  const g = new KnowledgeGraph();
  for (const d of ds.panel) {
    g.addNode(
      makeNode(
        "Disease",
        diseaseId(d.omimId),
        d.name,
        {
          name: d.name,
          inheritance: d.inheritance,
          mechanism: d.mechanism,
          omim: d.omimId,
        },
        { prov: "pipeline", aliases: [d.omimId] },
      ),
    );
  }
  for (const gene of new Set(ds.panel.map((d) => d.gene))) {
    const chrom = ds.records.find((r) => r.gene === gene)?.chrom ?? "";
    g.addNode(
      makeNode(
        "Gene",
        `gene:${gene}`,
        gene,
        { symbol: gene, name: null, chrom, strand: null, assembly: "GRCh38" },
        { prov: "clinvar" },
      ),
    );
  }
  for (const r of ds.records) {
    const id = variantId(r.variationId);
    const { hgvsc, hgvsp } = splitName(r.name);
    const short = oneLetter(hgvsp);
    const label = `${r.gene} ${hgvsp || hgvsc}`;
    g.addNode(
      makeNode(
        "Variant",
        id,
        label,
        {
          hgvsc,
          hgvsp,
          rsid: r.rsid ?? undefined,
          proteinPos:
            Number(hgvsp.match(/^p\.[A-Za-z]{3}(\d+)/)?.[1]) || undefined,
          consequence: null,
          clinvarSignificance:
            SCORER_CLASS[r.significance] ?? "Likely pathogenic",
          reviewStars: r.stars,
          gnomadAf: null,
          locus: locusOf(r),
          clinvar: {
            variationId: r.variationId,
            accession: r.accession,
            rcv: r.rcv,
            name: r.name,
            significance: r.significance,
            reviewStatus: r.reviewStatus,
            stars: r.stars,
            submitters: r.submitters,
            lastEvaluated: r.lastEvaluated,
            conditions: r.conditions,
            release: ds.release,
          },
        },
        {
          prov: "clinvar",
          aliases: [
            r.accession,
            `VCV${r.variationId}`,
            hgvsc,
            `${r.gene} ${hgvsc}`,
            ...(hgvsp ? [hgvsp] : []),
            ...(short ? [`p.${short}`, short, `${r.gene} ${short}`] : []),
            ...(r.rsid ? [r.rsid] : []),
          ],
        },
      ),
    );
    g.addEdge(makeEdge("IN_GENE", id, `gene:${r.gene}`, {}, "clinvar"));
    for (const omim of r.panelDiseases)
      g.addEdge(makeEdge("CAUSES", id, diseaseId(omim), {}, "clinvar"));
  }
  return g;
}
