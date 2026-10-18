import { z } from "zod";

/**
 * NCBI ClinVar `variant_summary.txt.gz` (tab_delimited) parsing for the disease panel.
 *
 * Values are kept as ClinVar reports them. Columns are looked up by header name, and
 * the germline column names ClinVar introduced in 2024 are accepted alongside the older
 * ones, so a file from either era parses. A missing required column fails the import.
 */

export const VARIANT_SUMMARY_URL =
  "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz";

/** Classifications kept. Conflicting, uncertain and benign records are never kept. */
export const KEPT_SIGNIFICANCE = new Set([
  "Pathogenic",
  "Likely pathogenic",
  "Pathogenic/Likely pathogenic",
]);

/**
 * ClinVar's review-status-to-star mapping
 * (https://www.ncbi.nlm.nih.gov/clinvar/docs/review_status/). Unlisted statuses map to
 * null rather than a guessed number.
 */
const STARS: Record<string, number> = {
  "practice guideline": 4,
  "reviewed by expert panel": 3,
  "criteria provided, multiple submitters, no conflicts": 2,
  "criteria provided, conflicting classifications": 1,
  "criteria provided, conflicting interpretations": 1,
  "criteria provided, single submitter": 1,
  "no assertion criteria provided": 0,
  "no assertion provided": 0,
  "no classification provided": 0,
  "no classification for the individual variant": 0,
  "no interpretation for the single variant": 0,
};

export function reviewStars(status: string): number | null {
  return STARS[status.trim().toLowerCase()] ?? null;
}

export const PanelDiseaseSchema = z.object({
  omimId: z.string().regex(/^OMIM:\d{6}$/),
  name: z.string().min(1),
  gene: z.string().min(1),
  inheritance: z.enum(["AD", "AR", "XLR", "XLD"]),
  mechanism: z.enum([
    "loss_of_function",
    "gain_of_function",
    "dominant_negative",
  ]),
});
export type PanelDisease = z.infer<typeof PanelDiseaseSchema>;

export const ClinVarRecordSchema = z.object({
  variationId: z.number().int().positive(),
  /** VCV accession without version, e.g. VCV000007105. */
  accession: z.string().regex(/^VCV\d{9}$/),
  rcv: z.array(z.string().regex(/^RCV\d{9}(\.\d+)?$/)),
  gene: z.string().min(1),
  /** ClinVar's preferred name, e.g. NM_000492.4(CFTR):c.1521_1523del (p.Phe508del). */
  name: z.string().min(1),
  type: z.string(),
  significance: z.string(),
  reviewStatus: z.string(),
  stars: z.number().int().min(0).max(4).nullable(),
  submitters: z.number().int().nonnegative().nullable(),
  /** As ClinVar writes it (e.g. "Jun 10, 2024"); null when ClinVar gives none. */
  lastEvaluated: z.string().nullable(),
  rsid: z.string().nullable(),
  conditions: z.array(z.string()),
  conditionIds: z.array(z.string()),
  /** Panel diseases (OMIM ids) that ClinVar links this record to. */
  panelDiseases: z.array(z.string()),
  chrom: z.string(),
  /** VCF-style GRCh38 position and alleles (PositionVCF, Reference/AlternateAlleleVCF). */
  pos: z.number().int().positive().nullable(),
  ref: z.string().nullable(),
  alt: z.string().nullable(),
});
export type ClinVarRecord = z.infer<typeof ClinVarRecordSchema>;

export const ClinVarDatasetSchema = z.object({
  source: z.literal("NCBI ClinVar variant_summary.txt.gz"),
  sourceUrl: z.string(),
  /** ClinVar release date, YYYY-MM-DD. */
  release: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  importedAt: z.string(),
  assembly: z.literal("GRCh38"),
  panel: z.array(PanelDiseaseSchema).min(1),
  records: z.array(ClinVarRecordSchema),
});
export type ClinVarDataset = z.infer<typeof ClinVarDatasetSchema>;

const COLUMNS = {
  variationId: ["VariationID"],
  type: ["Type"],
  name: ["Name"],
  gene: ["GeneSymbol"],
  significance: ["ClinicalSignificance", "GermlineClassification"],
  lastEvaluated: ["LastEvaluated", "GermlineDateLastEvaluated"],
  rsid: ["RS# (dbSNP)"],
  rcv: ["RCVaccession"],
  conditionIds: ["PhenotypeIDS"],
  conditions: ["PhenotypeList"],
  assembly: ["Assembly"],
  chrom: ["Chromosome"],
  reviewStatus: ["ReviewStatus", "GermlineReviewStatus"],
  submitters: ["NumberSubmitters"],
  pos: ["PositionVCF"],
  ref: ["ReferenceAlleleVCF"],
  alt: ["AlternateAlleleVCF"],
} as const;
type Column = keyof typeof COLUMNS;

export type ColumnIndex = Record<Column, number>;

/** Maps the header line to column positions; throws if a required column is missing. */
export function indexHeader(line: string): ColumnIndex {
  const names = line.replace(/^#/, "").split("\t");
  const index = {} as ColumnIndex;
  for (const [key, options] of Object.entries(COLUMNS) as [
    Column,
    readonly string[],
  ][]) {
    const i = names.findIndex((n) => options.includes(n));
    if (i < 0)
      throw new Error(`variant_summary has no column ${options.join(" / ")}`);
    index[key] = i;
  }
  return index;
}

/** ClinVar writes "-", "na" or "-1" for missing values. */
const present = (v: string | undefined) =>
  v && v !== "-" && v.toLowerCase() !== "na" && v !== "-1" ? v : null;

export type SkipReason =
  "not_grch38" | "gene_not_in_panel" | "not_pathogenic" | "no_panel_condition";

/**
 * One data row to a record, or the reason it is skipped. Multi-gene rows
 * ("CFTR;OTHER") are kept only when a panel gene is listed. Records must link to a
 * panel disease through an OMIM id in PhenotypeIDS, as the backend ETL requires.
 */
export function parseRow(
  line: string,
  col: ColumnIndex,
  panel: readonly PanelDisease[],
): ClinVarRecord | SkipReason {
  const c = line.split("\t");
  const get = (k: Column) => c[col[k]] ?? "";
  if (get("assembly") !== "GRCh38") return "not_grch38";
  const genes = get("gene").split(/[;,]/);
  const diseases = panel.filter((d) => genes.includes(d.gene));
  if (!diseases.length) return "gene_not_in_panel";
  const significance = get("significance");
  if (!KEPT_SIGNIFICANCE.has(significance)) return "not_pathogenic";
  const conditionIds = get("conditionIds")
    .split(/[|;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const panelDiseases = diseases
    .filter((d) => conditionIds.includes(d.omimId))
    .map((d) => d.omimId);
  if (!panelDiseases.length) return "no_panel_condition";
  const variationId = Number(get("variationId"));
  const reviewStatus = get("reviewStatus");
  const rs = present(get("rsid"));
  const pos = Number(present(get("pos")));
  const submitters = Number(present(get("submitters")));
  return {
    variationId,
    accession: `VCV${String(variationId).padStart(9, "0")}`,
    rcv: get("rcv").split("|").filter(Boolean),
    gene: diseases[0]!.gene,
    name: get("name"),
    type: get("type"),
    significance,
    reviewStatus,
    stars: reviewStars(reviewStatus),
    submitters:
      Number.isFinite(submitters) && present(get("submitters"))
        ? submitters
        : null,
    lastEvaluated: present(get("lastEvaluated")),
    rsid: rs ? `rs${rs}` : null,
    conditions: get("conditions")
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s && s !== "not provided" && s !== "not specified"),
    conditionIds,
    panelDiseases,
    chrom: get("chrom"),
    pos: Number.isFinite(pos) && pos > 0 ? pos : null,
    ref: present(get("ref")),
    alt: present(get("alt")),
  };
}

/** Panel diseases from the backend's own config, backend/crispr_backend/panel.py. */
export function parsePanelPy(source: string): PanelDisease[] {
  const aliases: Record<string, string> = {};
  for (const m of source.matchAll(/^(\w+(?:, \w+)*) = Inheritance\s*$/gm))
    m[1]!.split(", ").forEach((a, i) => {
      aliases[a] = ["AD", "AR", "XLR", "XLD"][i]!;
    });
  const mech: Record<string, string> = {
    GOF: "gain_of_function",
    DN: "dominant_negative",
  };
  const out: PanelDisease[] = [];
  for (const m of source.matchAll(
    /PanelDisease\(\s*"(OMIM:\d+)",\s*"([^"]+)",\s*"([^"]+)",\s*(\w+)(?:,\s*(\w+))?\s*\)/g,
  )) {
    out.push(
      PanelDiseaseSchema.parse({
        omimId: m[1],
        name: m[2],
        gene: m[3],
        inheritance: aliases[m[4]!] ?? m[4],
        mechanism: m[5] ? mech[m[5]] : "loss_of_function",
      }),
    );
  }
  return out;
}
