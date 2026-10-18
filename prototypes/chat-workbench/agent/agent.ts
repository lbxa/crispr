import { ToolLoopAgent, isStepCount } from 'ai';
import type { AppContext } from './app';
import { createTools } from './tools';
import type { Turn } from './turn';

export const MAX_STEPS = 5;

/**
 * The loop. Retrieval has already run in code, so a graph-answerable question needs one
 * model call. The model may loop through tools (queryGraph / searchPapers / resolveEntities)
 * for up to MAX_STEPS calls, and the final step is forced to be text so a turn always ends
 * with an answer rather than a dangling tool call.
 */
export function createCrisprAgent(app: AppContext, turn: Turn, instructions: string) {
  return new ToolLoopAgent({
    model: app.model,
    instructions,
    tools: createTools(turn),
    stopWhen: isStepCount(MAX_STEPS),
    prepareStep: ({ stepNumber }) => (stepNumber >= MAX_STEPS - 1 ? { toolChoice: 'none' as const } : {}),
    temperature: 0.2,
  });
}
