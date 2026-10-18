import { SEED_NOTICE } from '../lib/graph/seed';
import { suggestPrompts } from '../lib/retrieval/suggestions';
import { resolveFocus } from '../lib/retrieval/focus';
import type { AppContext } from './app';
import { Turn } from './turn';

/** First-view state (no question yet): overview chart, metric cards, helix, prompt bubbles. No model call. */
export async function buildState(app: AppContext, patientId = 'sim-001') {
  const g = app.graph;
  const id = g.node(patientId) ? patientId : g.ofType('Patient')[0]?.id;
  const turn = new Turn(app, null, { intent: 'explain_diagnosis' });
  if (!id) return { model: app.modelLabel, demoModel: app.demoModel, notice: SEED_NOTICE, suggestions: [] as string[] };
  const r = await turn.retrieve('explain_diagnosis', [id]);
  return {
    model: app.modelLabel,
    demoModel: app.demoModel,
    notice: SEED_NOTICE,
    focus: r.focus.primary,
    viz: r.viz,
    viz2: r.viz2,
    metrics: r.metrics,
    helix: r.helix,
    suggestions: suggestPrompts(g, resolveFocus(g, [id]), 'explain_diagnosis'),
    patients: g.ofType('Patient').map((p) => ({ id: p.id, label: p.label })),
  };
}
