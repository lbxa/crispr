import { MAX_LIBRARY_GENOME_BYTES, type LibraryGenome } from "./catalog";

/** Small curated panel files enter the same resumable analysis flow as a local file. */
export async function loadLibraryGenome(
  genome: LibraryGenome,
  signal: AbortSignal,
): Promise<File> {
  const response = await fetch(
    `/api/genome-library/${encodeURIComponent(genome.id)}`,
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      cache: "no-store",
      redirect: "error",
    },
  );
  if (!response.ok) throw new Error("Genome library unavailable");
  const content = await response.arrayBuffer();
  signal.throwIfAborted();
  if (!content.byteLength || content.byteLength > MAX_LIBRARY_GENOME_BYTES)
    throw new Error("Invalid library genome");
  return new File([content], genome.fileName, { type: "application/vcf" });
}
