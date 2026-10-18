import "server-only";

import { z } from "zod";
import { DEFAULT_BACKEND_URL } from "../genome-analysis/backend";
import { MAX_LIBRARY_GENOME_BYTES, type LibraryGenome } from "./catalog";

const catalogSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    sample_id: z.string().min(1),
  }),
);

export type LibraryDownload =
  | { ok: true; content: ArrayBuffer }
  | {
      ok: false;
      code: "unavailable" | "invalid_response" | "timeout" | "canceled";
    };

/** Resolve the public sample identity rather than assuming database row ids stay fixed. */
export async function downloadLibraryGenome(
  genome: LibraryGenome,
  signal: AbortSignal,
  requestId: string,
): Promise<LibraryDownload> {
  const timeout = AbortSignal.timeout(30_000);
  const options: RequestInit = {
    signal: AbortSignal.any([signal, timeout]),
    headers: { "X-Request-Id": requestId },
    cache: "no-store",
    redirect: "manual",
  };
  try {
    signal.throwIfAborted();
    const origin = process.env.CRISPR_API_URL ?? DEFAULT_BACKEND_URL;
    const catalogResponse = await fetch(new URL("/genomes", origin), options);
    if (!catalogResponse.ok) return { ok: false, code: "unavailable" };
    const catalog = catalogSchema.safeParse(await catalogResponse.json());
    if (!catalog.success) return { ok: false, code: "invalid_response" };
    const matches = catalog.data.filter(
      ({ sample_id }) => sample_id === genome.sampleId,
    );
    if (matches.length !== 1) return { ok: false, code: "unavailable" };
    const response = await fetch(
      new URL(`/genomes/${matches[0]!.id}/genome.vcf`, origin),
      options,
    );
    if (!response.ok) return { ok: false, code: "unavailable" };
    if (
      Number(response.headers.get("Content-Length")) > MAX_LIBRARY_GENOME_BYTES
    )
      return { ok: false, code: "invalid_response" };
    const content = await response.arrayBuffer();
    signal.throwIfAborted();
    if (
      content.byteLength === 0 ||
      content.byteLength > MAX_LIBRARY_GENOME_BYTES ||
      !new TextDecoder()
        .decode(content.slice(0, 32))
        .startsWith("##fileformat=VCF")
    )
      return { ok: false, code: "invalid_response" };
    return { ok: true, content };
  } catch {
    return {
      ok: false,
      code: signal.aborted
        ? "canceled"
        : timeout.aborted
          ? "timeout"
          : "unavailable",
    };
  }
}
