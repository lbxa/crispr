import { SEED_NOTICE } from "../lib/graph/seed";
import { suggestPrompts } from "../lib/retrieval/suggestions";
import { resolveFocus } from "../lib/retrieval/focus";
import type { AppContext } from "./app";
import { Turn } from "./turn";

/** First-view state (no question yet): overview chart, metric cards, helix, prompt bubbles. No model call. */
export async function buildState(app: AppContext, patientId = "sim-001") {
  const g = app.graph;
  const patient =
    [patientId, `pt:${patientId}`].find((id) => g.node(id)) ??
    g.ofType("Patient")[0]?.id;
  // Without simulated patients, open on the gene with the most loaded variants.
  const gene = patient
    ? undefined
    : g
        .ofType("Gene")
        .map((n) => ({ id: n.id, n: g.sources(n.id, "IN_GENE").length }))
        .sort((a, b) => b.n - a.n)[0]?.id;
  const id = patient ?? gene;
  const intent = patient ? "explain_diagnosis" : "gene_overview";
  const notice =
    app.data.source === "clinvar"
      ? `Variant data: NCBI ClinVar, release ${app.data.release}. Simulated patients only. Not medical advice.`
      : SEED_NOTICE;
  const turn = new Turn(app, null, { intent });
  if (!id)
    return {
      model: app.modelLabel,
      demoModel: app.demoModel,
      data: app.data,
      notice,
      suggestions: [] as string[],
    };
  const r = await turn.retrieve(intent, [id]);
  return {
    model: app.modelLabel,
    demoModel: app.demoModel,
    data: app.data,
    notice,
    focus: r.focus.primary,
    viz: r.viz,
    viz2: r.viz2,
    metrics: r.metrics,
    helix: r.helix,
    suggestions: suggestPrompts(g, resolveFocus(g, [id]), intent),
    patients: g.ofType("Patient").map((p) => ({ id: p.id, label: p.label })),
  };
}
