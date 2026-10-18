import type { Provenance } from "../graph/types";
import type { StoredPaper } from "../papers/store";
import type { PaperRef } from "../ui/payload";

export interface Fact {
  /** Citation handle for this turn, e.g. "F3". */
  id: string;
  text: string;
  nodeIds: string[];
  prov: Provenance;
}

/**
 * Per-turn ledger of everything the model is allowed to cite.
 *
 * Facts (F1..) come from graph retrieval and papers (P1..) from literature search.
 * The model is told to cite only these handles; the grounding check afterwards flags any
 * handle in the answer that was never issued, which is the cheapest useful faithfulness test.
 */
export class TurnRegistry {
  private facts: Fact[] = [];
  private factByText = new Map<string, Fact>();
  private papers: PaperRef[] = [];
  private paperByNode = new Map<string, PaperRef>();

  addFact(text: string, nodeIds: string[], prov: Provenance): Fact {
    const existing = this.factByText.get(text);
    if (existing) return existing;
    const fact: Fact = { id: `F${this.facts.length + 1}`, text, nodeIds, prov };
    this.facts.push(fact);
    this.factByText.set(text, fact);
    return fact;
  }

  addPaper(stored: StoredPaper): PaperRef {
    const existing = this.paperByNode.get(stored.nodeId);
    if (existing) return existing;
    const p = stored.props;
    const ref: PaperRef = {
      ref: `P${this.papers.length + 1}`,
      nodeId: stored.nodeId,
      title: p.title,
      year: p.year,
      journal: p.journal,
      studyType: p.studyType,
      peerReviewed: p.peerReviewed,
      pmid: p.pmid,
      doi: p.doi,
      citedBy: p.citedBy,
      snippet:
        p.abstract.length > 260 ? `${p.abstract.slice(0, 260)}…` : p.abstract,
    };
    this.papers.push(ref);
    this.paperByNode.set(stored.nodeId, ref);
    return ref;
  }

  allFacts(): readonly Fact[] {
    return this.facts;
  }
  allPapers(): readonly PaperRef[] {
    return this.papers;
  }
  factIds(): Set<string> {
    return new Set(this.facts.map((f) => f.id));
  }
  paperIds(): Set<string> {
    return new Set(this.papers.map((p) => p.ref));
  }
}
