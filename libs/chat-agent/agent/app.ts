import type { LanguageModel } from "ai";
import { KnowledgeGraph } from "../lib/graph/graph";
import { buildSeedGraph } from "../lib/graph/seed";
import { PaperStore } from "../lib/papers/store";
import {
  EnsemblSequenceProvider,
  SyntheticSequenceProvider,
  type SequenceProvider,
  type SequenceWindow,
} from "../lib/sequence/provider";
import { loadGraph, type DataStatus } from "./data";
import { resolveModel } from "./model";

/** Everything a request needs that outlives a single turn. */
export interface AppContext {
  graph: KnowledgeGraph;
  /** Where the graph came from; the UI shows it, so seed data is never shown as real. */
  data: DataStatus;
  sequences: SequenceProvider;
  papers: PaperStore;
  fetch: typeof fetch;
  windowCache: Map<string, SequenceWindow>;
  model: LanguageModel;
  modelLabel: string;
  demoModel: boolean;
  paperTimeoutMs: number;
}

export function createApp(overrides: Partial<AppContext> = {}): AppContext {
  const graph = overrides.graph ?? buildSeedGraph();
  const resolved = overrides.model ? null : resolveModel();
  return {
    graph,
    data: overrides.data ?? {
      source: "seed",
      reason: "Test or fixture app built on the illustrative seed graph.",
    },
    sequences: overrides.sequences ?? new SyntheticSequenceProvider(),
    papers: overrides.papers ?? new PaperStore(graph),
    fetch: overrides.fetch ?? fetch,
    windowCache: overrides.windowCache ?? new Map(),
    model: overrides.model ?? resolved!.model,
    modelLabel: overrides.modelLabel ?? resolved?.label ?? "custom",
    demoModel: overrides.demoModel ?? resolved?.demo ?? false,
    paperTimeoutMs: overrides.paperTimeoutMs ?? 8000,
  };
}

let singleton: AppContext | null = null;

/**
 * Process-wide app: the graph is built once and shared, which is what makes retrieval
 * cheap. Set CRISPR_SEQUENCE=ensembl to use real GRCh38 windows (needs network).
 */
export function getApp(): AppContext {
  if (!singleton) {
    const sequences =
      process.env.CRISPR_SEQUENCE === "ensembl"
        ? new EnsemblSequenceProvider()
        : new SyntheticSequenceProvider();
    const { graph, data } = loadGraph();
    singleton = createApp({ graph, data, sequences });
  }
  return singleton;
}
