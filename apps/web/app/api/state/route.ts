import { getApp } from "@crispr/chat-agent/app";
import { buildState } from "@crispr/chat-agent/state";

export const runtime = "nodejs";

/** First-view panels and prompt bubbles for /chat; no model call. */
export async function GET(request: Request): Promise<Response> {
  const patient = new URL(request.url).searchParams.get("patient") ?? undefined;
  return Response.json(await buildState(getApp(), patient));
}
