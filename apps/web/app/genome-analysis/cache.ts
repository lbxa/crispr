import { createStore, del, get, set, type UseStore } from "idb-keyval";
import { z } from "zod";
import {
  genomeProgressSchema,
  genomeReportSchema,
  MAX_UPLOAD_BYTES,
  type GenomeAnalysisState,
} from "./contract";

type CompletedGenome = Extract<GenomeAnalysisState, { status: "complete" }>;
const cachedGenomeSchema = z.object({
  version: z.literal(1),
  file: z.object({
    name: z.string().min(1).max(1024),
    size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    type: z.string().max(255),
    lastModified: z.number().int().nonnegative(),
  }),
  report: genomeReportSchema,
  progress: genomeProgressSchema,
});

/** One atomically replaced, validated result; never raw VCF bytes or tokens. */
export class CurrentGenomeCache {
  constructor(
    private readonly store: UseStore = createStore("crispr-genomes", "genomes"),
  ) {}

  async restore(): Promise<CompletedGenome | null> {
    const cached = cachedGenomeSchema.safeParse(
      await get<unknown>("current", this.store),
    );
    if (!cached.success) return null;
    const { file, report, progress } = cached.data;
    return { status: "complete", file, report, progress };
  }

  async remember(analysis: CompletedGenome): Promise<void> {
    const { file } = analysis;
    const cached = cachedGenomeSchema.parse({
      version: 1,
      file: {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      },
      report: analysis.report,
      progress: analysis.progress,
    });
    await set("current", cached, this.store);
  }

  async forget(): Promise<void> {
    await del("current", this.store);
  }
}

export const currentGenomeCache = new CurrentGenomeCache();
