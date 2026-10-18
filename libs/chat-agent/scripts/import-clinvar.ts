/**
 * Offline ClinVar import for the chat graph. Never runs at request time.
 *
 *   bun run clinvar:download   # fetches variant_summary.txt.gz and records its release date
 *   bun run clinvar:import     # streams it into data/clinvar-panel.json
 *
 * Options: --input <path> --out <path> --release YYYY-MM-DD --panel <panel.py>.
 * The release date comes from --release or from the .meta.json written by the download;
 * the import refuses to guess one.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createGunzip } from "node:zlib";
import {
  ClinVarDatasetSchema,
  indexHeader,
  parsePanelPy,
  parseRow,
  VARIANT_SUMMARY_URL,
  type ClinVarRecord,
  type PanelDisease,
  type SkipReason,
} from "../lib/clinvar/variant-summary";

const root = resolve(import.meta.dirname, "..");
export const DEFAULT_INPUT = resolve(root, "data/raw/variant_summary.txt.gz");
export const DEFAULT_OUT = resolve(root, "data/clinvar-panel.json");
export const DEFAULT_PANEL = resolve(
  root,
  "../../backend/crispr_backend/panel.py",
);

/** Lines of a gzipped or plain file, hashing the raw bytes as they are read. */
function readLines(input: string) {
  const hash = createHash("sha256");
  const raw = createReadStream(input);
  raw.on("data", (chunk) => hash.update(chunk));
  const text = input.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  if (text !== raw) raw.on("error", (e) => text.destroy(e));
  return Object.assign(createInterface({ input: text, crlfDelay: Infinity }), {
    hash,
  });
}

/** Streams a (gzipped or plain) variant_summary file; keeps one record per VariationID. */
export async function importVariantSummary(
  input: string,
  panel: readonly PanelDisease[],
) {
  const lines = readLines(input);
  const hash = lines.hash;
  const records = new Map<number, ClinVarRecord>();
  const skipped: Record<SkipReason | "duplicate", number> = {
    not_grch38: 0,
    gene_not_in_panel: 0,
    not_pathogenic: 0,
    no_panel_condition: 0,
    duplicate: 0,
  };
  let col: ReturnType<typeof indexHeader> | undefined;
  let rows = 0;
  for await (const line of lines) {
    if (!col) {
      col = indexHeader(line);
      continue;
    }
    if (!line) continue;
    rows++;
    const r = parseRow(line, col, panel);
    if (typeof r === "string") skipped[r]++;
    else if (records.has(r.variationId)) skipped.duplicate++;
    else records.set(r.variationId, r);
  }
  if (!col) throw new Error(`${input} is empty`);
  return {
    records: [...records.values()].sort(
      (a, b) => a.variationId - b.variationId,
    ),
    rows,
    skipped,
    sha256: hash.digest("hex"),
  };
}

async function releaseFor(input: string, flag?: string): Promise<string> {
  if (flag) return flag;
  try {
    const meta = JSON.parse(await readFile(`${input}.meta.json`, "utf8")) as {
      lastModified?: string;
    };
    const date = meta.lastModified ? new Date(meta.lastModified) : null;
    if (date && !Number.isNaN(date.getTime()))
      return date.toISOString().slice(0, 10);
  } catch {
    // No sidecar: fall through to the error below.
  }
  throw new Error(
    "Unknown ClinVar release date. Download with `bun run clinvar:download`, or pass --release YYYY-MM-DD.",
  );
}

export const DEFAULT_FIXTURE = resolve(
  root,
  "scripts/fixtures/variant_summary.recorded.tsv",
);

/**
 * Copies the header and a handful of rows, byte for byte, from the real file into the
 * test fixture: CFTR p.Phe508del (VariationID 7105) on both assemblies, then the first
 * row of each kind the importer must keep or skip.
 */
async function recordFixture(input: string, out: string) {
  const panelGenes = new Set(
    parsePanelPy(await readFile(DEFAULT_PANEL, "utf8")).map((d) => d.gene),
  );
  const lines = readLines(input);
  const kept: string[] = [];
  const wanted = new Map<string, (c: string[], h: string[]) => boolean>([
    ["F508del", (c, h) => c[h.indexOf("VariationID")] === "7105"],
    [
      "grch37",
      (c, h) =>
        c[h.indexOf("Assembly")] === "GRCh37" &&
        panelGenes.has(c[h.indexOf("GeneSymbol")]!),
    ],
    [
      "outside-panel",
      (c, h) =>
        c[h.indexOf("Assembly")] === "GRCh38" &&
        !panelGenes.has(c[h.indexOf("GeneSymbol")]!) &&
        /^Pathogenic$/.test(c[sigIndex(h)]!),
    ],
    [
      "conflicting",
      (c, h) =>
        c[h.indexOf("Assembly")] === "GRCh38" &&
        panelGenes.has(c[h.indexOf("GeneSymbol")]!) &&
        /onflicting/.test(c[sigIndex(h)]!),
    ],
    [
      "likely-pathogenic",
      (c, h) =>
        c[h.indexOf("Assembly")] === "GRCh38" &&
        panelGenes.has(c[h.indexOf("GeneSymbol")]!) &&
        c[sigIndex(h)] === "Likely pathogenic",
    ],
    [
      "benign",
      (c, h) =>
        c[h.indexOf("Assembly")] === "GRCh38" &&
        panelGenes.has(c[h.indexOf("GeneSymbol")]!) &&
        c[sigIndex(h)] === "Benign",
    ],
  ]);
  const found = new Map<string, number>();
  let header: string[] | undefined;
  for await (const line of lines) {
    if (!header) {
      header = line.replace(/^#/, "").split("\t");
      kept.push(line);
      continue;
    }
    const c = line.split("\t");
    for (const [kind, match] of wanted) {
      const limit = kind === "F508del" ? 2 : 1;
      if ((found.get(kind) ?? 0) < limit && match(c, header)) {
        found.set(kind, (found.get(kind) ?? 0) + 1);
        kept.push(line);
        break;
      }
    }
    if (
      [...wanted.keys()].every(
        (k) => (found.get(k) ?? 0) >= (k === "F508del" ? 2 : 1),
      )
    )
      break;
  }
  lines.close();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, kept.join("\n") + "\n");
  console.log(
    `Recorded ${kept.length - 1} rows to ${out}: ${JSON.stringify(Object.fromEntries(found))}`,
  );
}

const sigIndex = (h: string[]) =>
  h.findIndex(
    (n) => n === "ClinicalSignificance" || n === "GermlineClassification",
  );

async function download(out: string) {
  await mkdir(dirname(out), { recursive: true });
  const res = await fetch(VARIANT_SUMMARY_URL);
  if (!res.ok || !res.body)
    throw new Error(`ClinVar download failed: HTTP ${res.status}`);
  await writeFile(out, res.body as unknown as AsyncIterable<Uint8Array>);
  const lastModified = res.headers.get("last-modified");
  await writeFile(
    `${out}.meta.json`,
    JSON.stringify(
      {
        url: VARIANT_SUMMARY_URL,
        lastModified,
        downloadedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    `Downloaded ${out} (Last-Modified: ${lastModified ?? "unknown"})`,
  );
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: "string", default: DEFAULT_INPUT },
      out: { type: "string", default: DEFAULT_OUT },
      release: { type: "string" },
      panel: { type: "string", default: DEFAULT_PANEL },
    },
  });
  if (positionals[0] === "download") {
    await download(values.input!);
  } else if (positionals[0] === "record-fixture") {
    await recordFixture(values.input!, DEFAULT_FIXTURE);
  } else {
    const panel = parsePanelPy(await readFile(values.panel!, "utf8"));
    if (panel.length !== 24)
      throw new Error(`Expected 24 panel diseases, read ${panel.length}`);
    const release = await releaseFor(values.input!, values.release);
    const result = await importVariantSummary(values.input!, panel);
    const dataset = ClinVarDatasetSchema.parse({
      source: "NCBI ClinVar variant_summary.txt.gz",
      sourceUrl: VARIANT_SUMMARY_URL,
      release,
      sha256: result.sha256,
      importedAt: new Date().toISOString(),
      assembly: "GRCh38",
      panel,
      records: result.records,
    });
    await mkdir(dirname(values.out!), { recursive: true });
    await writeFile(values.out!, JSON.stringify(dataset));
    console.log(
      JSON.stringify(
        {
          out: values.out,
          release,
          sha256: result.sha256,
          rows: result.rows,
          kept: result.records.length,
          skipped: result.skipped,
        },
        null,
        2,
      ),
    );
  }
}
