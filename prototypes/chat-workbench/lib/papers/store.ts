import { KnowledgeGraph } from '../graph/graph';
import { makeEdge, makeNode, type GNode, type PaperProps } from '../graph/types';
import { classifyStudy, type EpmcRecord } from './europepmc';

export interface StoredPaper {
  nodeId: string;
  props: PaperProps;
  /** False once the cap is reached: the paper is returned for this turn but not kept. */
  stored: boolean;
}

export interface PaperStoreOptions {
  now?: () => number;
  /** How long a repeated query is answered from the graph without touching the network. */
  ttlMs?: number;
  /** Upper bound on Paper nodes kept in the graph (memory guard for long-running servers). */
  maxPapers?: number;
}

/**
 * Write-through paper cache living inside the knowledge graph.
 *
 * Search results become `Paper` nodes with MENTIONS edges to the entities the query was
 * about. The next question about the same entities is then a graph lookup (in-edges of
 * the entity) instead of a network round trip, which is where most of the latency saving
 * for literature questions comes from.
 *
 * MENTIONS edges here mean "this paper matched a search for that entity", not that the
 * paper was curated as relevant. The edge carries via: 'search-match' to say so.
 */
export class PaperStore {
  private now: () => number;
  private ttlMs: number;
  private maxPapers: number;
  private queryLog = new Map<string, { at: number; nodeIds: string[] }>();
  private count = 0;

  constructor(
    private g: KnowledgeGraph,
    opts: PaperStoreOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? 24 * 3600 * 1000;
    this.maxPapers = opts.maxPapers ?? 5000;
    this.count = g.ofType('Paper').length;
  }

  static queryKey(entityIds: string[], query: string): string {
    return `${[...entityIds].sort().join('|')}::${query}`;
  }

  /** Node ids from a still-fresh identical query, or null. */
  fresh(key: string): StoredPaper[] | null {
    const hit = this.queryLog.get(key);
    if (!hit || this.now() - hit.at > this.ttlMs) return null;
    return hit.nodeIds.map((id) => this.toStored(id)).filter((p): p is StoredPaper => p !== null);
  }

  remember(key: string, papers: StoredPaper[]): void {
    this.queryLog.set(key, { at: this.now(), nodeIds: papers.filter((p) => p.stored).map((p) => p.nodeId) });
  }

  /** Papers already linked to any of these entities. Pure graph lookup. */
  cachedFor(entityIds: string[]): StoredPaper[] {
    const seen = new Set<string>();
    const out: StoredPaper[] = [];
    for (const id of entityIds) {
      for (const e of this.g.inEdges(id, 'MENTIONS')) {
        if (seen.has(e.from)) continue;
        seen.add(e.from);
        const p = this.toStored(e.from);
        if (p) out.push(p);
      }
    }
    return out;
  }

  upsert(records: EpmcRecord[], entityIds: string[]): StoredPaper[] {
    const out: StoredPaper[] = [];
    for (const r of records) {
      const nodeId = `paper:${r.source}:${r.id}`;
      const existing = this.g.typed(nodeId, 'Paper');
      const { studyType, peerReviewed } = classifyStudy(r.pubTypes, r.source);
      const props: PaperProps = {
        pmid: r.pmid,
        doi: r.doi,
        title: r.title,
        abstract: r.abstract,
        year: r.year,
        journal: r.journal,
        studyType,
        peerReviewed,
        citedBy: r.citedBy,
        source: r.source,
        fetchedAt: this.now(),
      };
      if (!existing && this.count >= this.maxPapers) {
        out.push({ nodeId, props, stored: false });
        continue;
      }
      const node: GNode<'Paper'> = this.g.addNode(
        makeNode('Paper', nodeId, r.title, props, { prov: 'europepmc' }),
      );
      if (!existing) this.count++;
      for (const eid of entityIds) {
        if (this.g.node(eid)) this.g.addEdge(makeEdge('MENTIONS', node.id, eid, { via: 'search-match' }, 'europepmc'));
      }
      out.push({ nodeId, props: node.props, stored: true });
    }
    return out;
  }

  private toStored(nodeId: string): StoredPaper | null {
    const n = this.g.typed(nodeId, 'Paper');
    return n ? { nodeId, props: n.props, stored: true } : null;
  }
}
