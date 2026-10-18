import type { UIMessageStreamWriter } from "ai";
import type { LinkedEntity } from "../lib/graph/linker";
import { buildMetrics } from "../lib/metrics/cards";
import { entityTerms, questionToQuery } from "../lib/papers/query";
import { bm25Rank, evidenceTimeline } from "../lib/papers/rank";
import { searchEuropePmc } from "../lib/papers/europepmc";
import { PaperStore, type StoredPaper } from "../lib/papers/store";
import { resolveFocus } from "../lib/retrieval/focus";
import { TurnRegistry } from "../lib/retrieval/registry";
import { retrieve, type Retrieval } from "../lib/retrieval/retrieve";
import type {
  CrisprUIMessage,
  EvidencePayload,
  Intent,
  PaperRef,
  StatusPayload,
} from "../lib/ui/payload";
import type { AppContext } from "./app";

export type Writer = UIMessageStreamWriter<CrisprUIMessage>;

export interface PaperSearchResult {
  query: string;
  source: EvidencePayload["source"];
  note?: string;
  papers: PaperRef[];
}

/**
 * One user turn. Owns the citation ledger and the (optional) stream writer, and is the
 * only place that turns retrieval results into typed UI data parts. Both the pre-model
 * retrieval in the handler and the model's tools go through here, so the panels always
 * update the same way no matter who triggered the retrieval.
 *
 * With writer === null (the /api/state endpoint, tests) it does the same work silently.
 */
export class Turn {
  readonly registry = new TurnRegistry();
  readonly linked = new Map<string, LinkedEntity>();
  intent: Intent;
  last: Retrieval | null = null;
  /** Fact ids the model has already been given, so tool results only carry what is new. */
  readonly delivered = new Set<string>();

  constructor(
    readonly app: AppContext,
    readonly writer: Writer | null,
    init: { intent: Intent; linked?: LinkedEntity[] },
  ) {
    this.intent = init.intent;
    for (const e of init.linked ?? []) this.linked.set(e.id, e);
  }

  get entityIds(): string[] {
    return [...this.linked.keys()];
  }

  status(phase: StatusPayload["phase"], detail?: string): void {
    this.writer?.write({
      type: "data-status",
      data: { phase, detail },
      transient: true,
    });
  }

  /** Register entity ids the model supplied that the linker did not see. */
  addEntities(ids: string[]): void {
    for (const id of ids) {
      const n = this.app.graph.node(id);
      if (n && !this.linked.has(id)) {
        this.linked.set(id, {
          id,
          type: n.type,
          label: n.label,
          matched: n.label,
          start: -1,
          end: -1,
          method: "exact",
          score: 1,
        });
      }
    }
  }

  async retrieve(intent: Intent, entityIds: string[]): Promise<Retrieval> {
    this.status("retrieving", intent);
    const r = await retrieve(
      {
        graph: this.app.graph,
        sequences: this.app.sequences,
        papers: this.app.papers,
        registry: this.registry,
        windowCache: this.app.windowCache,
      },
      { intent, entityIds },
    );
    this.intent = r.intent;
    this.last = r;
    this.emit(r);
    return r;
  }

  private emit(r: Retrieval): void {
    const w = this.writer;
    if (!w) return;
    w.write({
      type: "data-focus",
      id: "focus",
      data: {
        entities: [...this.linked.values()].map((e) => ({
          id: e.id,
          type: e.type,
          label: e.label,
          method: e.method,
        })),
        primary: r.focus.primary,
        intent: r.intent,
        dataNotice: r.dataNotice,
      },
    });
    w.write({ type: "data-helix", id: "helix", data: r.helix });
    if (r.viz) w.write({ type: "data-viz", id: "viz", data: r.viz });
    if (r.viz2) w.write({ type: "data-viz2", id: "viz2", data: r.viz2 });
    w.write({ type: "data-metrics", id: "metrics", data: r.metrics });
    if (r.evidence)
      w.write({ type: "data-evidence", id: "evidence", data: r.evidence });
  }

  /**
   * Literature search: graph cache first, Europe PMC second, never throws.
   * A failed live search degrades to cached papers and says so in `note`, which the
   * model is instructed to relay.
   */
  async searchPapers(args: {
    question: string;
    entityIds: string[];
    limit: number;
  }): Promise<PaperSearchResult> {
    const { app } = this;
    const g = app.graph;
    const ids = args.entityIds.filter((id) => g.node(id));
    const useIds = ids.length ? ids : this.entityIds;
    this.status("searching_papers");

    const { query, entities, topics } = questionToQuery(
      g,
      args.question,
      useIds,
    );
    if (!query) {
      return {
        query: "",
        source: "none",
        papers: [],
        note: "No searchable terms: name a gene, disease or variant.",
      };
    }

    const key = PaperStore.queryKey(useIds, query);
    const cachedBefore = app.papers.cachedFor(useIds);
    let pool: StoredPaper[];
    let source: EvidencePayload["source"];
    let note: string | undefined;

    const fresh = app.papers.fresh(key);
    if (fresh) {
      pool = fresh;
      source = "graph-cache";
    } else {
      try {
        const records = await searchEuropePmc(query, {
          fetch: app.fetch,
          limit: 10,
          timeoutMs: app.paperTimeoutMs,
        });
        const stored = app.papers.upsert(records, useIds);
        app.papers.remember(key, stored);
        const seen = new Set(stored.map((p) => p.nodeId));
        pool = [...stored, ...cachedBefore.filter((p) => !seen.has(p.nodeId))];
        source = cachedBefore.length > 0 ? "both" : "europepmc";
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        pool = cachedBefore;
        source = pool.length ? "graph-cache" : "none";
        note = `Live literature search was unavailable (${reason}). ${pool.length ? "Showing papers cached from earlier searches only." : "No cached papers exist for these entities either."}`;
      }
    }

    const ranked = bm25Rank(
      pool.map((p) => ({
        item: p,
        text: `${p.props.title} ${p.props.abstract}`,
      })),
      `${args.question} ${entities.join(" ")} ${topics.join(" ")}`,
    );
    const top = ranked.slice(0, args.limit).map((r) => r.item);
    const refs = top.map((p) => this.registry.addPaper(p));
    const timeline = evidenceTimeline(top.map((p) => p.props));
    const evidence: EvidencePayload = { papers: refs, timeline, source, note };

    if (this.writer) {
      this.writer.write({
        type: "data-evidence",
        id: "evidence",
        data: evidence,
      });
      if (this.intent === "evidence") {
        this.writer.write({
          type: "data-viz",
          id: "viz",
          data: {
            type: "evidence_timeline",
            title: "Evidence by year and study type",
            provenance: "europepmc",
            data: { byYear: timeline },
          },
        });
      }
      const focus = this.last?.focus ?? resolveFocus(g, useIds);
      this.writer.write({
        type: "data-metrics",
        id: "metrics",
        data: buildMetrics(g, {
          focus,
          guides: this.last?.edit?.guides,
          sequenceSource: this.last?.edit?.sequenceSource,
          paperStats: {
            count: refs.length,
            preprints: refs.filter((p) => !p.peerReviewed).length,
          },
        }),
      });
    }
    return { query, source, note, papers: refs };
  }

  /** Entity terms used in search, exposed for tests and the tool description. */
  searchTermsFor(ids: string[]): string[] {
    return entityTerms(this.app.graph, ids);
  }
}
