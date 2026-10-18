import { buildSeedGraph, SEED_NOTICE } from '../lib/graph/seed';
import { linkEntities } from '../lib/graph/linker';
import { routeIntent } from '../lib/retrieval/router';
import { suggestPrompts } from '../lib/retrieval/suggestions';
import { resolveFocus } from '../lib/retrieval/focus';
import { buildMetrics } from '../lib/metrics/cards';
import { PaperStore } from '../lib/papers/store';
import { SyntheticSequenceProvider } from '../lib/sequence/provider';
import { checkGrounding } from '../agent/grounding';
import { Turn } from '../agent/turn';
import type { Intent } from '../lib/ui/payload';

const graph = buildSeedGraph();
const app = {
  graph,
  sequences: new SyntheticSequenceProvider(),
  papers: new PaperStore(graph),
  fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
  windowCache: new Map(),
  model: null,
  modelLabel: 'in-page demo',
  demoModel: true,
  paperTimeoutMs: 6000,
} as never;

function compose(turn: Turn, note?: string): string {
  const facts = turn.registry.allFacts().slice(0, 12);
  const papers = turn.registry.allPapers().slice(0, 5);
  const out: string[] = [];
  if (facts.length) out.push(...facts.map((f) => `• ${f.text} [${f.id}]`));
  else out.push('Nothing in the graph matched that. Try naming a gene, disease, variant, organ, symptom or a simulated patient.');
  if (papers.length) {
    out.push('', 'Papers (untrusted text; preprints are not peer reviewed):');
    out.push(...papers.map((p) => `• ${p.title} (${p.year ?? 'n.d.'}${p.peerReviewed ? '' : ', preprint'}) [${p.ref}]`));
  }
  if (note) out.push('', `Note: ${note}`);
  return out.join('\n');
}

async function ask(question: string, prior: string[]) {
  let linked = linkEntities(graph, question);
  if (!linked.length && prior.length) {
    linked = prior.flatMap((id) => {
      const n = graph.node(id);
      return n ? [{ id, type: n.type, label: n.label, matched: n.label, start: -1, end: -1, method: 'exact' as const, score: 1 }] : [];
    });
  }
  const route = routeIntent(question, linked);
  const turn = new Turn(app, null, { intent: route.intent, linked });
  const r = await turn.retrieve(route.intent, linked.map((e) => e.id));
  let evidence = r.evidence;
  let metrics = r.metrics;
  let viz = r.viz;
  let note: string | undefined;
  if (route.needsPapers) {
    const res = await turn.searchPapers({ question, entityIds: linked.map((e) => e.id), limit: 5 });
    note = res.note;
    const byYear = new Map<number, { year: number; total: number; byType: Record<string, number> }>();
    for (const p of res.papers) {
      if (!p.year) continue;
      const row = byYear.get(p.year) ?? { year: p.year, total: 0, byType: {} };
      row.total++;
      row.byType[p.studyType] = (row.byType[p.studyType] ?? 0) + 1;
      byYear.set(p.year, row);
    }
    const timeline = [...byYear.values()].sort((a, b) => a.year - b.year);
    evidence = { papers: res.papers, timeline, source: res.source, note };
    if (res.papers.length) {
      viz = { type: 'evidence_timeline', title: 'Evidence by year and study type', provenance: 'europepmc', data: { byYear: timeline } } as never;
    }
    metrics = buildMetrics(graph, {
      focus: r.focus,
      guides: r.edit?.guides,
      sequenceSource: r.edit?.sequenceSource,
      paperStats: { count: res.papers.length, preprints: res.papers.filter((p) => !p.peerReviewed).length },
    });
  }
  const answer = compose(turn, note);
  return {
    linked: [...turn.linked.values()].map((e) => ({ id: e.id, type: e.type, label: e.label })),
    intent: turn.intent as Intent,
    reason: route.reason,
    viz,
    viz2: r.viz2,
    metrics,
    helix: r.helix,
    evidence,
    dataNotice: r.dataNotice,
    answer,
    facts: Object.fromEntries(turn.registry.allFacts().map((f) => [f.id, f.text])),
    papers: Object.fromEntries(turn.registry.allPapers().map((p) => [p.ref, p.title])),
    grounding: checkGrounding(answer, turn.registry),
    suggestions: r.focus ? suggestPrompts(graph, r.focus, turn.intent) : [],
    primary: r.focus.primary,
  };
}

async function initial() {
  const id = 'pt:sim-001';
  const turn = new Turn(app, null, { intent: 'explain_diagnosis' });
  const r = await turn.retrieve('explain_diagnosis', [id]);
  return {
    notice: SEED_NOTICE,
    viz: r.viz, viz2: r.viz2, metrics: r.metrics, helix: r.helix, primary: r.focus.primary,
    suggestions: suggestPrompts(graph, resolveFocus(graph, [id]), 'explain_diagnosis'),
  };
}

(globalThis as unknown as { Crispr: unknown }).Crispr = { ask, initial };
