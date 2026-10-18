import { performance } from "node:perf_hooks";
import { KnowledgeGraph } from "../lib/graph/graph";
import { makeEdge, makeNode } from "../lib/graph/types";
import { buildSeedGraph } from "../lib/graph/seed";
import { linkEntities } from "../lib/graph/linker";
import { routeIntent } from "../lib/retrieval/router";
import { createApp } from "../agent/app";
import { Turn } from "../agent/turn";
import { createScriptedModel } from "../agent/demo-model";

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor(xs.length * p))
  ]!;
const ms = (x: number) => `${x.toFixed(3)} ms`;

// 1) Full code-side path on the seed graph: link -> route -> retrieve (no model, no network).
const app = createApp({ model: createScriptedModel([]) });
const questions = [
  "Why does patient 1 have cystic fibrosis?",
  "Is patient 2 a carrier of sickle cell?",
  "Tell me about the liver",
  "Design a guide for F508del",
  "what does HFE do",
  "cystic fibrosus symptoms",
];
const samples: number[] = [];
const linkOnly: number[] = [];
for (let i = 0; i < 1000; i++) {
  const q = questions[i % questions.length]!;
  const t0 = performance.now();
  const linked = linkEntities(app.graph, q);
  const t1 = performance.now();
  const route = routeIntent(q, linked);
  const turn = new Turn(app, null, { intent: route.intent, linked });
  await turn.retrieve(
    route.intent,
    linked.map((e) => e.id),
  );
  const t2 = performance.now();
  linkOnly.push(t1 - t0);
  samples.push(t2 - t0);
}
console.log(
  `seed graph (${app.graph.ofType("Patient").length} patients), 1000 runs, retrieval only (no LLM, no network)`,
);
console.log(
  `  link:             p50 ${ms(pct(linkOnly, 0.5))}  p95 ${ms(pct(linkOnly, 0.95))}`,
);
console.log(
  `  link+route+retr.: p50 ${ms(pct(samples, 0.5))}  p95 ${ms(pct(samples, 0.95))}`,
);

// 2) 2-hop neighbourhood on a synthetic graph. Structure is random, so this is a scaling check, not a claim about real data.
const N = 100_000;
const E = 500_000;
const big = new KnowledgeGraph();
let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const tb = performance.now();
for (let i = 0; i < N; i++)
  big.addNode(
    makeNode("Phenotype", `n${i}`, `n${i}`, { hpo: `HP:${i}` } as never),
  );
for (let i = 0; i < E; i++) {
  const a = Math.floor(rnd() * N);
  const b = Math.floor(rnd() * N);
  if (a !== b) big.addEdge(makeEdge("REPORTS", `n${a}`, `n${b}`, {} as never));
}
console.log(
  `\nsynthetic graph: ${N} nodes, ~${E} edges built in ${ms(performance.now() - tb)}`,
);
const nb: number[] = [];
const sizes: number[] = [];
for (let i = 0; i < 300; i++) {
  const t0 = performance.now();
  const sg = big.neighborhood([`n${Math.floor(rnd() * N)}`], {
    hops: 2,
    maxNodes: 200,
  });
  nb.push(performance.now() - t0);
  sizes.push(sg.nodes.length);
}
console.log(
  `  2-hop neighbourhood (maxNodes 200): p50 ${ms(pct(nb, 0.5))}  p95 ${ms(pct(nb, 0.95))}  median size ${pct(sizes, 0.5)}`,
);
