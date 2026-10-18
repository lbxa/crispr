import { KnowledgeGraph } from "../graph/graph";
import { buildQuery } from "./europepmc";
import { terms } from "./rank";

const PHRASES: Array<[RegExp, string]> = [
  [/\bbase[- ]edit\w*/i, "base editing"],
  [/\bprime[- ]edit\w*/i, "prime editing"],
  [/\bcrispr\b|\bcas9\b/i, "CRISPR"],
  [/\bgene[- ]edit\w*|\bgenome[- ]edit\w*|\bediting\b/i, "gene editing"],
  [/\boff[- ]?target\w*/i, "off-target"],
  [/\bdelivery\b|\blnp\b|\bnanoparticle\w*/i, "delivery"],
  [/\bclinical trial\w*/i, "clinical trial"],
];

const GENERIC = new Set(
  "tell about research paper papers study studies evidence latest recent published literature what does say show give find any there new more gene genes genome sequence".split(
    " ",
  ),
);

/** Topic phrases and leftover content words from a question, minus words already covered by entities. */
export function topicTerms(question: string, entityTerms: string[]): string[] {
  const out = new Set<string>();
  for (const [re, phrase] of PHRASES) if (re.test(question)) out.add(phrase);
  const covered = new Set(entityTerms.flatMap((t) => terms(t)));
  if (out.size === 0) {
    for (const w of terms(question)) {
      if (w.length >= 5 && !GENERIC.has(w) && !covered.has(w)) out.add(w);
      if (out.size >= 3) break;
    }
  }
  return [...out].slice(0, 4);
}

/** Search terms for the entities in focus: gene symbol, disease name, short variant name. */
export function entityTerms(g: KnowledgeGraph, entityIds: string[]): string[] {
  const out: string[] = [];
  for (const id of entityIds) {
    const n = g.node(id);
    if (!n) continue;
    switch (n.type) {
      case "Gene":
        out.push(n.props.symbol);
        break;
      case "Disease":
        out.push(n.props.name);
        break;
      case "Variant":
        out.push(n.aliases[0] ?? n.props.hgvsp);
        break;
      default:
        break;
    }
  }
  return [...new Set(out)];
}

export function questionToQuery(
  g: KnowledgeGraph,
  question: string,
  entityIds: string[],
): { query: string; entities: string[]; topics: string[] } {
  const entities = entityTerms(g, entityIds);
  const topics = topicTerms(question, entities);
  return { query: buildQuery({ entities, topics }), entities, topics };
}
