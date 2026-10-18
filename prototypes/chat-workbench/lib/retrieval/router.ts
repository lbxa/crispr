import type { LinkedEntity } from '../graph/linker';
import type { Intent } from '../ui/payload';

const EVIDENCE = /\b(papers?|research|literature|studies|study|evidence|trials?|published|pubmed|citations?|cite|latest|recent|preprints?|reviews?)\b/i;
const EDIT = /\b(guides?|g?rna|sgrna|crispr|cas9|pam|edit(?:s|ing|or|ors)?|hdr|prime|base[- ]edit\w*|knock\s?out|off[- ]?target|template)\b/i;
const INHERIT = /\b(carrier|carriers|inherit\w*|recessive|dominant|x[- ]linked|zygos\w*|homozyg\w*|heterozyg\w*)\b/i;
const DIAGNOSE = /\b(why|explain|diagnos\w*|score|scores|match|likely|possible|symptom\w*)\b/i;

export interface Route {
  intent: Intent;
  /** True when the question is explicitly about literature, so searchPapers should run first. */
  needsPapers: boolean;
  reason: string;
}

/**
 * Rule-based intent router. Runs in code, costs microseconds, and decides which graph
 * traversal and which chart to prepare before the model is even called. The model can
 * still override it by calling queryGraph with a different intent.
 */
export function routeIntent(text: string, entities: LinkedEntity[]): Route {
  const types = new Set(entities.map((e) => e.type));
  if (EVIDENCE.test(text)) return { intent: 'evidence', needsPapers: true, reason: 'asks about research or evidence' };
  if (EDIT.test(text)) return { intent: 'edit_design', needsPapers: false, reason: 'asks about editing or guides' };
  if (INHERIT.test(text)) return { intent: 'inheritance', needsPapers: false, reason: 'asks about inheritance or carrier status' };
  if (types.has('Patient')) {
    return { intent: 'explain_diagnosis', needsPapers: false, reason: DIAGNOSE.test(text) ? 'asks to explain a diagnosis' : 'patient in focus' };
  }
  if (types.has('Organ') && !types.has('Gene') && !types.has('Variant') && !types.has('Disease')) {
    return { intent: 'organ_overview', needsPapers: false, reason: 'organ named without a gene or disease' };
  }
  if (types.has('Gene') || types.has('Variant') || types.has('Disease')) {
    return { intent: 'gene_overview', needsPapers: false, reason: 'gene, variant or disease named' };
  }
  return { intent: 'general', needsPapers: false, reason: 'no specific intent detected' };
}
