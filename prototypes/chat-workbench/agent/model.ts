import type { LanguageModel } from 'ai';
import { createDemoModel } from './demo-model';

export interface ResolvedModel {
  model: LanguageModel;
  label: string;
  /** True when no real language model is connected. Surfaced in logs and /api/state. */
  demo: boolean;
}

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5';

/**
 * Pick the language model.
 *  - CRISPR_MODEL=demo            -> template model (no LLM, no network)
 *  - CRISPR_MODEL=<gateway id>    -> that model through the AI Gateway
 *  - unset, gateway credentials   -> DEFAULT_MODEL
 *  - unset, no credentials        -> demo model, so `npm run dev` works out of the box
 */
export function resolveModel(env: Record<string, string | undefined> = process.env): ResolvedModel {
  const requested = env.CRISPR_MODEL?.trim();
  if (requested === 'demo') return { model: createDemoModel(), label: 'demo (no LLM)', demo: true };
  if (requested) return { model: requested, label: requested, demo: false };
  if (env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN) {
    return { model: DEFAULT_MODEL, label: DEFAULT_MODEL, demo: false };
  }
  return { model: createDemoModel(), label: 'demo (no LLM; set AI_GATEWAY_API_KEY to use a real model)', demo: true };
}
