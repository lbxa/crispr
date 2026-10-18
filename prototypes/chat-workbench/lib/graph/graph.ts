import type { AnyEdge, AnyNode, EdgeType, GEdge, GNode, NodeType } from './types';
import { asType } from './types';

/** Lowercase, strip diacritics, hyphens to spaces, keep . > : _ for HGVS/HPO tokens. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9.>:_ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Subgraph {
  nodes: AnyNode[];
  edges: AnyEdge[];
}

export interface NeighborhoodOptions {
  hops: number;
  maxNodes?: number;
  edgeTypes?: EdgeType[];
  excludeTypes?: NodeType[];
}

type Adj = Map<string, Map<EdgeType, AnyEdge[]>>;

/**
 * In-memory property graph with per-edge-type adjacency lists in both directions.
 *
 * Retrieval cost is proportional to the size of the neighbourhood touched, not the
 * size of the graph: every lookup is a Map hit followed by an array walk. That is
 * the whole performance story, and scripts/bench.ts measures it.
 *
 * The interface is deliberately small (follow / neighborhood / aliases) so it can be
 * re-implemented on Neo4j or similar later without touching the retrieval layer.
 */
export class KnowledgeGraph {
  private nodes = new Map<string, AnyNode>();
  private edges = new Map<string, AnyEdge>();
  private out: Adj = new Map();
  private inn: Adj = new Map();
  private aliasIndex = new Map<string, string[]>();
  private byType = new Map<NodeType, Set<string>>();

  get nodeCount(): number {
    return this.nodes.size;
  }
  get edgeCount(): number {
    return this.edges.size;
  }

  // ---------------------------------------------------------------- writes

  /** Upsert. Existing nodes keep their identity; props and aliases are merged. */
  addNode<T extends NodeType>(n: GNode<T>): GNode<T> {
    const existing = this.nodes.get(n.id);
    if (existing) {
      if (existing.type !== n.type) {
        throw new Error(`Node ${n.id} already exists with type ${existing.type}, got ${n.type}`);
      }
      Object.assign(existing.props as object, n.props as object);
      this.indexAliases(existing, n.aliases);
      return existing as unknown as GNode<T>;
    }
    const node = n as unknown as AnyNode;
    this.nodes.set(node.id, node);
    let set = this.byType.get(node.type);
    if (!set) this.byType.set(node.type, (set = new Set()));
    set.add(node.id);
    this.indexAliases(node, node.aliases);
    return n;
  }

  /** Upsert by edge id. Both endpoints must already exist. */
  addEdge(e: AnyEdge): AnyEdge {
    if (!this.nodes.has(e.from)) throw new Error(`Edge ${e.id}: unknown source node ${e.from}`);
    if (!this.nodes.has(e.to)) throw new Error(`Edge ${e.id}: unknown target node ${e.to}`);
    const existing = this.edges.get(e.id);
    if (existing) {
      Object.assign(existing.props as object, e.props as object);
      return existing;
    }
    this.edges.set(e.id, e);
    this.link(this.out, e.from, e);
    this.link(this.inn, e.to, e);
    return e;
  }

  private link(adj: Adj, nodeId: string, e: AnyEdge): void {
    let byType = adj.get(nodeId);
    if (!byType) adj.set(nodeId, (byType = new Map()));
    const list = byType.get(e.type);
    if (list) list.push(e);
    else byType.set(e.type, [e]);
  }

  private indexAliases(node: AnyNode, extra: string[]): void {
    for (const a of [node.label, ...extra]) {
      const key = normalize(a);
      if (!key) continue;
      const ids = this.aliasIndex.get(key);
      if (!ids) this.aliasIndex.set(key, [node.id]);
      else if (!ids.includes(node.id)) ids.push(node.id);
    }
  }

  // ----------------------------------------------------------------- reads

  node(id: string): AnyNode | undefined {
    return this.nodes.get(id);
  }

  typed<T extends NodeType>(id: string, type: T): GNode<T> | undefined {
    return asType(this.nodes.get(id), type);
  }

  mustTyped<T extends NodeType>(id: string, type: T): GNode<T> {
    const n = this.typed(id, type);
    if (!n) throw new Error(`Expected ${type} node ${id}`);
    return n;
  }

  ofType<T extends NodeType>(type: T): GNode<T>[] {
    const ids = this.byType.get(type);
    if (!ids) return [];
    return [...ids].map((id) => this.nodes.get(id) as unknown as GNode<T>);
  }

  outEdges<T extends EdgeType>(id: string, type: T): GEdge<T>[] {
    return (this.out.get(id)?.get(type) ?? []) as unknown as GEdge<T>[];
  }

  inEdges<T extends EdgeType>(id: string, type: T): GEdge<T>[] {
    return (this.inn.get(id)?.get(type) ?? []) as unknown as GEdge<T>[];
  }

  /** Nodes reached by following `type` edges out of `id`. */
  targets(id: string, type: EdgeType): AnyNode[] {
    return this.outEdges(id, type).map((e) => this.nodes.get(e.to)!);
  }

  /** Nodes that have a `type` edge pointing at `id`. */
  sources(id: string, type: EdgeType): AnyNode[] {
    return this.inEdges(id, type).map((e) => this.nodes.get(e.from)!);
  }

  /** Exact alias lookup on already-normalised text. */
  lookupAlias(normalised: string): readonly string[] {
    return this.aliasIndex.get(normalised) ?? [];
  }

  /** All alias keys with their node ids (used to build the fuzzy index). */
  aliasEntries(): IterableIterator<[string, string[]]> {
    return this.aliasIndex.entries();
  }

  /**
   * Breadth-first neighbourhood over both edge directions.
   * Stops growing once `maxNodes` is reached so a hub node cannot blow up a response.
   */
  neighborhood(seedIds: string[], opts: NeighborhoodOptions): Subgraph {
    const maxNodes = opts.maxNodes ?? 60;
    const allowEdge = opts.edgeTypes ? new Set(opts.edgeTypes) : null;
    const skipType = opts.excludeTypes ? new Set(opts.excludeTypes) : null;

    const seen = new Set<string>();
    for (const id of seedIds) if (this.nodes.has(id)) seen.add(id);
    let frontier = [...seen];
    const keptEdges = new Map<string, AnyEdge>();

    for (let hop = 0; hop < opts.hops && frontier.length > 0; hop++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const adj of [this.out, this.inn]) {
          const byType = adj.get(id);
          if (!byType) continue;
          for (const [type, list] of byType) {
            if (allowEdge && !allowEdge.has(type)) continue;
            for (const e of list) {
              const other = e.from === id ? e.to : e.from;
              const otherNode = this.nodes.get(other)!;
              if (skipType?.has(otherNode.type)) continue;
              if (!seen.has(other)) {
                if (seen.size >= maxNodes) continue;
                seen.add(other);
                next.push(other);
              }
              keptEdges.set(e.id, e);
            }
          }
        }
      }
      frontier = next;
    }

    const edges = [...keptEdges.values()].filter((e) => seen.has(e.from) && seen.has(e.to));
    return { nodes: [...seen].map((id) => this.nodes.get(id)!), edges };
  }

  /** Structural self-check. Returns a list of problems; empty means healthy. */
  validate(): string[] {
    const problems: string[] = [];
    for (const e of this.edges.values()) {
      if (!this.nodes.has(e.from)) problems.push(`dangling source on ${e.id}`);
      if (!this.nodes.has(e.to)) problems.push(`dangling target on ${e.id}`);
      if (!this.outEdges(e.from, e.type).includes(e as never)) problems.push(`out-index missing ${e.id}`);
      if (!this.inEdges(e.to, e.type).includes(e as never)) problems.push(`in-index missing ${e.id}`);
    }
    for (const [alias, ids] of this.aliasIndex) {
      for (const id of ids) if (!this.nodes.has(id)) problems.push(`alias "${alias}" -> missing ${id}`);
    }
    return problems;
  }
}
