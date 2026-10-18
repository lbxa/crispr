import { handleChat } from "@crispr/chat-agent/handler";
import { getLogger, withContext } from "@crispr/observability";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Streams the chat answer. Logs status and latency only: questions may describe symptoms. */
export async function POST(request: Request): Promise<Response> {
  return withContext(
    { request_id: crypto.randomUUID(), workflow: "chat" },
    async () => {
      const logger = getLogger("chat");
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      try {
        const response = await handleChat(request);
        logger.info(
          { status: response.status, duration_ms: elapsed() },
          "chat_response_started",
        );
        return response;
      } catch (error) {
        logger.error(
          {
            error_class: error instanceof Error ? error.name : typeof error,
            duration_ms: elapsed(),
          },
          "chat_failed",
        );
        return Response.json(
          { error: "Chat is unavailable." },
          { status: 500 },
        );
      }
    },
  );
}
