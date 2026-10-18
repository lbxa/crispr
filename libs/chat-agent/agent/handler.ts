import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { z } from "zod";
import { linkEntities } from "../lib/graph/linker";
import { routeIntent } from "../lib/retrieval/router";
import { suggestPrompts } from "../lib/retrieval/suggestions";
import type { CrisprUIMessage } from "../lib/ui/payload";
import { createCrisprAgent } from "./agent";
import { getApp, type AppContext } from "./app";
import { checkGrounding } from "./grounding";
import { buildSystemPrompt } from "./prompt";
import { clientIp, RateLimiter } from "./rate-limit";
import { Turn } from "./turn";

const MAX_MESSAGES = 30;
const MAX_TEXT = 2000;
/** The page sends only text and the last data-focus part, so real requests stay far below this. */
export const MAX_BODY_BYTES = 256_000;
/** Graph ids look like "gene:CFTR" or "var:vcv7105"; anything else is not one of ours. */
const ENTITY_ID = /^[a-z]+:[A-Za-z0-9._:-]{1,80}$/;

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().max(100).optional(),
        // Only user/assistant: a client-supplied system message would be a prompt-injection channel.
        role: z.enum(["user", "assistant"]),
        parts: z.array(z.record(z.string(), z.unknown())).max(50),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES),
});

function json(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textOf(parts: Array<Record<string, unknown>>): string {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => (p.text as string).slice(0, MAX_TEXT))
    .join("\n");
}

/** Entity ids from the most recent assistant data-focus part, validated against the graph. */
function priorFocusIds(
  app: AppContext,
  messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>,
): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const part = m.parts.find((p) => p.type === "data-focus");
    const entities = (part?.data as { entities?: unknown } | undefined)
      ?.entities;
    if (!Array.isArray(entities)) continue;
    const ids = entities
      .map((e) =>
        e && typeof e === "object" ? (e as { id?: unknown }).id : undefined,
      )
      .filter(
        (id): id is string =>
          typeof id === "string" &&
          ENTITY_ID.test(id) &&
          app.graph.node(id) !== undefined,
      );
    if (ids.length) return ids.slice(0, 8);
  }
  return [];
}

export function createChatHandler(
  app: AppContext,
  opts: { timeoutMs?: number } = {},
) {
  return async function POST(req: Request): Promise<Response> {
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES)
      return json(413, "Request body is too large.");
    let raw: unknown;
    try {
      const body = await req.text();
      if (new TextEncoder().encode(body).length > MAX_BODY_BYTES)
        return json(413, "Request body is too large.");
      raw = JSON.parse(body);
    } catch {
      return json(400, "Body must be JSON.");
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return json(400, "Invalid request body.");
    const input = parsed.data.messages;

    const last = input[input.length - 1]!;
    if (last.role !== "user")
      return json(400, "The last message must come from the user.");
    const asked = last.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("\n");
    if (asked.length > MAX_TEXT)
      return json(400, `Questions are limited to ${MAX_TEXT} characters.`);
    const question = textOf(last.parts).trim();
    if (!question) return json(400, "The last message has no text.");
    const abortSignal = opts.timeoutMs
      ? AbortSignal.any([req.signal, AbortSignal.timeout(opts.timeoutMs)])
      : req.signal;

    const carried = priorFocusIds(app, input);
    // Strip everything but text: tool parts or data parts from the client must never reach the model.
    const clean: CrisprUIMessage[] = input
      .map((m, i) => ({
        id: m.id ?? `m${i}`,
        role: m.role,
        parts: [{ type: "text" as const, text: textOf(m.parts) }],
      }))
      .filter((m) => m.parts[0]!.text.length > 0);

    const stream = createUIMessageStream<CrisprUIMessage>({
      originalMessages: clean,
      onError: (err) =>
        err instanceof Error && err.name === "AbortError"
          ? "Cancelled."
          : "Something went wrong while answering.",
      execute: async ({ writer }) => {
        // createUIMessageStream emits neither start nor finish by itself (verified), so frame the message here.
        writer.write({ type: "start" });
        writer.write({
          type: "data-status",
          data: { phase: "linking" },
          transient: true,
        });
        let linked = linkEntities(app.graph, question);
        if (linked.length === 0 && carried.length) {
          // Follow-up with no new entity ("what about its guides?"): keep the earlier focus.
          linked = carried.flatMap((id) => {
            const n = app.graph.node(id);
            return n
              ? [
                  {
                    id,
                    type: n.type,
                    label: n.label,
                    matched: n.label,
                    start: -1,
                    end: -1,
                    method: "exact" as const,
                    score: 1,
                  },
                ]
              : [];
          });
        }
        const route = routeIntent(question, linked);
        const turn = new Turn(app, writer, { intent: route.intent, linked });

        const retrieval = await turn.retrieve(
          route.intent,
          linked.map((e) => e.id),
        );
        for (const f of retrieval.facts) turn.delivered.add(f.id);

        let searchNote: string | undefined;
        if (route.needsPapers) {
          const res = await turn.searchPapers({
            question,
            entityIds: linked.map((e) => e.id),
            limit: 5,
          });
          searchNote = res.note;
        }

        turn.status("answering");
        const agent = createCrisprAgent(
          app,
          turn,
          buildSystemPrompt({
            linked: [...turn.linked.values()],
            retrieval,
            registry: turn.registry,
            searchNote,
            demo: app.demoModel,
          }),
        );
        const result = await agent.stream({
          messages: await convertToModelMessages(clean),
          abortSignal,
        });

        let answer = "";
        const reader = result
          .toUIMessageStream<CrisprUIMessage>({
            sendStart: false,
            sendFinish: false,
          })
          .getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "text-delta") answer += value.delta;
          writer.write(value);
        }

        writer.write({
          type: "data-grounding",
          id: "grounding",
          data: checkGrounding(answer, turn.registry),
        });
        const focus = turn.last?.focus;
        if (focus) {
          writer.write({
            type: "data-suggestions",
            id: "suggestions",
            data: { prompts: suggestPrompts(app.graph, focus, turn.intent) },
          });
        }
        writer.write({ type: "finish", finishReason: "stop" });
      },
    });
    return createUIMessageStreamResponse({ stream });
  };
}

/**
 * The /api/chat route: per-IP rate limit in front of the chat handler. Tests pass
 * their own app and limiter; the default uses the process-wide app.
 */
export function createRouteHandler(deps: {
  app: () => AppContext;
  limiter: RateLimiter;
  timeoutMs: number;
}) {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  return async function POST(req: Request): Promise<Response> {
    const verdict = deps.limiter.hit(clientIp(req));
    if (!verdict.ok) {
      return new Response(
        JSON.stringify({ error: "Too many questions. Try again shortly." }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(verdict.retryAfterSeconds),
          },
        },
      );
    }
    handler ??= createChatHandler(deps.app(), { timeoutMs: deps.timeoutMs });
    return handler(req);
  };
}

/** 20 questions a minute per IP; a turn may take up to 55 s before it is aborted. */
export const handleChat = createRouteHandler({
  app: getApp,
  limiter: new RateLimiter(20, 60_000),
  timeoutMs: 55_000,
});
