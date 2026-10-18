import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
} as const;

export type ScriptedStep =
  | { text: string }
  | { toolCall: { name: string; input: unknown } };

let callSeq = 0;

function streamOf(parts: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
}

function textParts(text: string): LanguageModelV4StreamPart[] {
  const id = `t${++callSeq}`;
  const words = text.match(/\S+\s*|\s+/g) ?? [text];
  return [
    { type: 'text-start', id },
    ...words.map((w) => ({ type: 'text-delta' as const, id, delta: w })),
    { type: 'text-end', id },
    { type: 'finish', usage: USAGE, finishReason: { unified: 'stop', raw: 'stop' } },
  ];
}

function toolParts(name: string, input: unknown): LanguageModelV4StreamPart[] {
  return [
    { type: 'tool-call', toolCallId: `call_${++callSeq}`, toolName: name, input: JSON.stringify(input) },
    { type: 'finish', usage: USAGE, finishReason: { unified: 'tool-calls', raw: 'tool-calls' } },
  ];
}

/**
 * Deterministic model for tests: each model call consumes one scripted step.
 * Once the script is exhausted it answers with a fixed closing sentence.
 */
export function createScriptedModel(steps: ScriptedStep[]) {
  let i = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const step = steps[i++];
      const parts: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];
      if (!step) parts.push(...textParts('Done.'));
      else if ('text' in step) parts.push(...textParts(step.text));
      else parts.push(...toolParts(step.toolCall.name, step.toolCall.input));
      return { stream: streamOf(parts) };
    },
  });
}

/** Pull the text of the system message out of a model call's prompt. */
function systemText(prompt: ReadonlyArray<{ role: string; content: unknown }>): string {
  return prompt
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
}

/**
 * No-LLM fallback so `npm run dev` works without credentials. It does not reason: it
 * restates the numbered facts and papers that retrieval already placed in the system
 * prompt, keeping their [F#]/[P#] handles, and says plainly that it is a demo.
 */
export function createDemoModel() {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const sys = systemText(options.prompt as ReadonlyArray<{ role: string; content: unknown }>);
      const facts = [...sys.matchAll(/^\[(F\d+)\] (.+)$/gm)].map((m) => `- ${m[2]} [${m[1]}]`);
      const papers = [...sys.matchAll(/^\[(P\d+)\] (.+)$/gm)].map((m) => `- ${m[2]} [${m[1]}]`);
      const note = sys.match(/^SEARCH NOTE: (.+)$/m)?.[1];
      const lines = [
        'Demo mode: no language model is connected, so this is a direct restatement of the retrieved graph facts rather than a written explanation.',
        '',
        ...(facts.length ? facts.slice(0, 12) : ['- Nothing in the graph matched that question. Try naming a gene, disease, variant or simulated patient.']),
      ];
      if (papers.length) lines.push('', 'Papers (untrusted text, preprints are not peer reviewed):', ...papers.slice(0, 5));
      if (note) lines.push('', `Note: ${note}`);
      return {
        stream: streamOf([{ type: 'stream-start', warnings: [] }, ...textParts(lines.join('\n'))]),
      };
    },
  });
}
