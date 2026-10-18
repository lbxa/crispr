import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { buildClinVarGraph } from "../lib/clinvar/graph";
import {
  ingestSimulatedPatient,
  SimulatedPatientSchema,
} from "../lib/clinvar/patients";
import { ClinVarDatasetSchema } from "../lib/clinvar/variant-summary";
import type { KnowledgeGraph } from "../lib/graph/graph";
import { buildSeedGraph } from "../lib/graph/seed";

/** Which data the graph holds. Shown on screen so seed data is never taken for real. */
export type DataStatus =
  | {
      source: "clinvar";
      release: string;
      sha256: string;
      records: number;
      patients: number;
      /** Patient variants or symptoms that did not resolve to a graph node. */
      unresolved: number;
    }
  | { source: "seed"; reason: string };

const DATASET = "libs/chat-agent/data/clinvar-panel.json";
const PATIENTS = "libs/chat-agent/data/simulated-patients.json";

/** The repo root from either the root or apps/web, where Next.js runs. */
function candidates(file: string): string[] {
  return [resolve(process.cwd(), file), resolve(process.cwd(), "../..", file)];
}

function readJson(paths: string[]): { path: string; json: unknown } | null {
  for (const path of paths) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    return { path, json: JSON.parse(text) };
  }
  return null;
}

/**
 * Builds the graph from the imported ClinVar dataset and the simulated patients, or
 * falls back to the illustrative seed graph with the reason. Never mixes the two.
 */
export function loadGraph(
  env: Record<string, string | undefined> = process.env,
): { graph: KnowledgeGraph; data: DataStatus } {
  const seed = (reason: string) => ({
    graph: buildSeedGraph(),
    data: { source: "seed" as const, reason },
  });
  let dataset;
  try {
    const found = readJson(
      env.CRISPR_CLINVAR_DATA ? [env.CRISPR_CLINVAR_DATA] : candidates(DATASET),
    );
    if (!found)
      return seed(
        "No ClinVar import found. Run `bun run --cwd libs/chat-agent clinvar:download && bun run --cwd libs/chat-agent clinvar:import`.",
      );
    dataset = ClinVarDatasetSchema.parse(found.json);
  } catch (e) {
    return seed(
      `The ClinVar import could not be read (${e instanceof Error ? e.name : "error"}).`,
    );
  }
  const graph = buildClinVarGraph(dataset);
  let patients = 0;
  let unresolved = 0;
  try {
    const found = readJson(
      env.CRISPR_PATIENTS_DATA
        ? [env.CRISPR_PATIENTS_DATA]
        : candidates(PATIENTS),
    );
    for (const p of found
      ? z.array(SimulatedPatientSchema).parse(found.json)
      : []) {
      const r = ingestSimulatedPatient(graph, p);
      patients++;
      unresolved += r.unresolved.variants.length + r.unresolved.diseases.length;
    }
  } catch (e) {
    return seed(
      `The simulated patients could not be loaded (${e instanceof Error ? e.name : "error"}).`,
    );
  }
  const problems = graph.validate();
  if (problems.length)
    return seed(`The ClinVar graph failed validation: ${problems[0]}.`);
  return {
    graph,
    data: {
      source: "clinvar",
      release: dataset.release,
      sha256: dataset.sha256,
      records: dataset.records.length,
      patients,
      unresolved,
    },
  };
}
