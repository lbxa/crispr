import { getLogger, withContext } from "@crispr/observability";
import { downloadLibraryGenome } from "../../../genome-library/backend";
import { LIBRARY_GENOMES } from "../../../genome-library/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const genome = LIBRARY_GENOMES.find((entry) => entry.id === id);
  if (!genome)
    return Response.json(
      { error: "Genome not found." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  const requestId = crypto.randomUUID();
  return withContext(
    { request_id: requestId, workflow: "genome_library" },
    async () => {
      const logger = getLogger("genome-library");
      const started = performance.now();
      logger.info(
        { genome_library_id: genome.id },
        "genome_library_download_started",
      );
      const result = await downloadLibraryGenome(
        genome,
        request.signal,
        requestId,
      );
      const fields = {
        genome_library_id: genome.id,
        duration_ms: Math.round(performance.now() - started),
      };
      const headers = {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
        "X-Content-Type-Options": "nosniff",
      };
      if (!result.ok) {
        logger.warn(
          { ...fields, error_code: result.code },
          "genome_library_download_failed",
        );
        return Response.json(
          { error: "Couldn’t load this demo genome. Try again." },
          {
            status: {
              unavailable: 503,
              invalid_response: 502,
              timeout: 504,
              canceled: 499,
            }[result.code],
            headers,
          },
        );
      }
      logger.info(
        { ...fields, size_bytes: result.content.byteLength },
        "genome_library_download_completed",
      );
      return new Response(result.content, {
        headers: {
          ...headers,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Length": String(result.content.byteLength),
          "Content-Disposition": `attachment; filename="${genome.fileName}"`,
        },
      });
    },
  );
}
