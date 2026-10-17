import { DEFAULT_BACKEND_URL } from "../../../genome-analysis/backend";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
} from "../../../genome-analysis/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only public connection metadata crosses Next.js; genome bytes go to IBM. */
export function GET(): Response {
  const headers = { "Cache-Control": "private, no-store" };
  let api: URL;
  try {
    api = new URL(process.env.CRISPR_API_URL ?? DEFAULT_BACKEND_URL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname);
    if (
      (api.protocol !== "https:" && !(api.protocol === "http:" && loopback)) ||
      api.username ||
      api.password ||
      api.pathname !== "/" ||
      api.search ||
      api.hash
    ) {
      throw new Error("Invalid public backend origin");
    }
  } catch {
    return Response.json(
      { error: "Genome uploads are not configured." },
      { status: 503, headers },
    );
  }
  return Response.json(
    {
      api_url: api.origin,
      max_upload_bytes: MAX_UPLOAD_BYTES,
      chunk_size: UPLOAD_CHUNK_BYTES,
    },
    { headers },
  );
}
