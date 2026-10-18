import type { GroundingPayload } from '../lib/ui/payload';
import type { TurnRegistry } from '../lib/retrieval/registry';


/**
 * Cheap faithfulness check: every [F#]/[P#] handle in the answer must have been issued
 * this turn. It cannot prove a sentence is supported by its fact, only that the model did
 * not cite something that does not exist. Unknown handles are surfaced to the UI.
 */
export function checkGrounding(answer: string, registry: TurnRegistry): GroundingPayload {
  const facts = registry.factIds();
  const papers = registry.paperIds();
  const citedFacts = new Set<string>();
  const citedPapers = new Set<string>();
  const unknown = new Set<string>();
  // Only bracketed handles count as citations, so ordinary text like "P2" or "F1 score" is ignored.
  for (const m of answer.matchAll(/\[([FP]\d{1,3})(?:\s*,\s*([FP]\d{1,3}))*\]|\[([FP]\d{1,3})\]/g)) {
    for (const h of m[0].matchAll(/[FP]\d{1,3}/g)) {
      const id = h[0];
      if (id.startsWith('F')) (facts.has(id) ? citedFacts : unknown).add(id);
      else (papers.has(id) ? citedPapers : unknown).add(id);
    }
  }
  return {
    citedFacts: [...citedFacts],
    citedPapers: [...citedPapers],
    unknown: [...unknown],
    offTarget: 'not_assessed',
  };
}
