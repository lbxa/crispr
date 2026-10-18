import {
  DefaultChatTransport,
  readUIMessageStream,
  type UIMessageChunk,
} from "ai";
import type {
  CrisprDataParts,
  CrisprUIMessage,
  StatusPayload,
} from "../lib/ui/payload";

/**
 * Browser client for POST /api/chat. Streams AI SDK UI message chunks and drives the
 * same panels the in-page demo drives: panels first (data-* parts), then answer text.
 */

const MAX_SENT = 20;
const history: CrisprUIMessage[] = [];

// The server reads only text and the last data-focus part; nothing else is sent.
const transport = new DefaultChatTransport<CrisprUIMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages }) => ({
    body: {
      messages: messages.slice(-MAX_SENT).map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts.filter(
          (p) => p.type === "text" || p.type === "data-focus",
        ),
      })),
    },
  }),
});

type Part<K extends keyof CrisprDataParts> = CrisprDataParts[K] | undefined;

function dataOf<K extends keyof CrisprDataParts>(
  m: CrisprUIMessage | undefined,
  key: K,
): Part<K> {
  const part = m?.parts.find((p) => p.type === `data-${key}`);
  return part
    ? (part as unknown as { data: CrisprDataParts[K] }).data
    : undefined;
}

const textOf = (m: CrisprUIMessage | undefined) =>
  (m?.parts ?? [])
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n\n");

/** Same shape as the in-page engine's answer, so the page renders both alike. */
function toResult(m: CrisprUIMessage | undefined) {
  const focus = dataOf(m, "focus");
  const grounding = dataOf(m, "grounding");
  return {
    linked: (focus?.entities ?? []).map(({ id, type, label }) => ({
      id,
      type,
      label,
    })),
    intent: focus?.intent ?? "general",
    viz: dataOf(m, "viz"),
    viz2: dataOf(m, "viz2"),
    metrics: dataOf(m, "metrics") ?? null,
    helix: dataOf(m, "helix") ?? null,
    evidence: dataOf(m, "evidence") ?? null,
    dataNotice: focus?.dataNotice ?? null,
    answer: textOf(m),
    facts: grounding?.facts ?? {},
    papers:
      grounding?.papers ??
      Object.fromEntries(
        (dataOf(m, "evidence")?.papers ?? []).map((p) => [p.ref, p.title]),
      ),
    grounding: grounding ?? null,
    suggestions: dataOf(m, "suggestions")?.prompts ?? [],
    primary: focus?.primary ?? null,
    hasPanels: Boolean(focus),
  };
}
export type ServerResult = ReturnType<typeof toResult>;

export class ChatRequestError extends Error {
  constructor(
    message: string,
    /** True when the server answered and refused (429, 400); no demo fallback then. */
    readonly refused: boolean,
  ) {
    super(message);
  }
}

export async function ask(
  text: string,
  cb: {
    onStatus: (phase: StatusPayload["phase"]) => void;
    onUpdate: (partial: ServerResult) => void;
  },
): Promise<ServerResult> {
  const user: CrisprUIMessage = {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  };
  let stream: ReadableStream<UIMessageChunk>;
  try {
    stream = await transport.sendMessages({
      chatId: "workbench",
      messages: [...history, user],
      abortSignal: undefined,
      trigger: "submit-message",
      messageId: undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The transport throws the response body for non-2xx answers.
    const refusal = message.match(/"error"\s*:\s*"([^"]+)"/)?.[1];
    throw new ChatRequestError(refusal ?? message, Boolean(refusal));
  }
  const [forMessage, forStatus] = stream.tee();
  void (async () => {
    for await (const c of forStatus as unknown as AsyncIterable<UIMessageChunk>) {
      if (c.type === "data-status")
        cb.onStatus((c.data as StatusPayload).phase);
    }
  })();
  let last: CrisprUIMessage | undefined;
  for await (const m of readUIMessageStream<CrisprUIMessage>({
    stream: forMessage,
    terminateOnError: true,
  })) {
    last = m;
    cb.onUpdate(toResult(m));
  }
  if (!last) throw new ChatRequestError("The server sent no answer.", false);
  history.push(user, {
    id: last.id,
    role: "assistant",
    parts: last.parts.filter(
      (p) => p.type === "text" || p.type === "data-focus",
    ),
  });
  return toResult(last);
}

/** First-view state from GET /api/state. */
export async function initial() {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

(globalThis as unknown as { CrisprServer: unknown }).CrisprServer = {
  ask,
  initial,
  ChatRequestError,
};
