import { getLogger, withContext } from "@crispr/observability";
import { DEFAULT_BACKEND_URL } from "../../../genome-analysis/backend";
import {
  CHROMOSOME_PATTERN,
  MAX_REFERENCE_BASES,
  referenceRangeSchema,
} from "../../../genome-analysis/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_TIMEOUT_MS = 10_000;

function failure(code: string, status: number, requestId: string) {
  return Response.json(
    { error: code },
    {
      status,
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    },
  );
}

/** GRCh38 reference bases for the DNA viewer, proxied from the Python API's /reference. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ chromosome: string }> },
): Promise<Response> {
  const { chromosome } = await params;
  const requestId = crypto.randomUUID();
  return withContext(
    { request_id: requestId, workflow: "reference_sequence" },
    async () => {
      const logger = getLogger("reference-sequence");
      const query = new URL(request.url).searchParams;
      const start = Number(query.get("start"));
      const end = Number(query.get("end"));
      if (
        !CHROMOSOME_PATTERN.test(chromosome) ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end <= start ||
        end - start > MAX_REFERENCE_BASES
      )
        return failure("invalid_range", 400, requestId);

      const timeout = AbortSignal.timeout(BACKEND_TIMEOUT_MS);
      const url = new URL(
        `/reference/${chromosome}`,
        process.env.CRISPR_API_URL ?? DEFAULT_BACKEND_URL,
      );
      url.search = new URLSearchParams({
        start: String(start),
        end: String(end),
      }).toString();
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { "X-Request-Id": requestId },
          redirect: "manual",
          signal: AbortSignal.any([request.signal, timeout]),
        });
      } catch {
        logger.warn({ chromosome, start, end }, "reference_unavailable");
        return failure(
          timeout.aborted ? "backend_timeout" : "backend_unavailable",
          timeout.aborted ? 504 : 503,
          requestId,
        );
      }
      if (!response.ok) {
        // 404/422 are this request's fault; anything else means the service can't help now.
        const status = [404, 422].includes(response.status) ? 400 : 503;
        return failure("reference_unavailable", status, requestId);
      }
      const parsed = referenceRangeSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (
        !parsed.success ||
        parsed.data.chromosome !== chromosome ||
        parsed.data.start !== start ||
        parsed.data.end !== end
      )
        return failure("invalid_response", 502, requestId);
      // GRCh38 never changes, so browsers and CDNs may keep it indefinitely.
      return Response.json(parsed.data, {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Request-Id": requestId,
        },
      });
    },
  );
}
