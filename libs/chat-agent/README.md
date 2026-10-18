# @crispr/chat-agent

Knowledge graph, retrieval, the AI SDK tool loop and the workbench page behind
`/chat`. The web app serves `POST /api/chat` and `GET /api/state` from it, and
copies the built page into `public/workbench/`.

**Simulated patients only. Not medical advice. Off-target risk is not assessed
anywhere in this code; on-target scores are not computed.** Variant data comes
from NCBI ClinVar (https://www.ncbi.nlm.nih.gov/clinvar/) when imported.

## Code map

| Path                        | Owns                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `lib/clinvar/`              | variant_summary parsing, ClinVar graph builder, simulated-patient adapter  |
| `lib/graph/`                | Typed property graph, seed fixture, linker, reference scorer, ingest       |
| `lib/metrics/`              | Metric cards, guide geometry, edit-option screening, phenotype match       |
| `lib/retrieval/`            | Intent router, focus, retrieval and fact text, citation registry, prompts  |
| `lib/papers/`               | Europe PMC search (untrusted text), BM25 ranking, paper cache              |
| `lib/sequence/`             | Synthetic windows (default); Ensembl GRCh38 with reference-allele check    |
| `lib/ui/payload.ts`         | Typed `data-*` parts streamed to the page (`CrisprUIMessage`)              |
| `agent/handler.ts`          | `handleChat`: rate limit, validation, retrieval, streaming loop, grounding |
| `agent/data.ts`             | `loadGraph`: ClinVar import + simulated patients, or the labelled seed     |
| `agent/state.ts`            | First-view panels, prompt bubbles and data status, no model call           |
| `agent/model.ts`            | Model from `AI_GATEWAY_API_KEY` / `CRISPR_MODEL`, else the demo model      |
| `web/`                      | Workbench page (`template.html`), `/api/chat` client, fallback engine      |
| `scripts/import-clinvar.ts` | Offline ClinVar download, import and fixture recording                     |
| `scripts/*.test.ts`         | Node test runner suites (`tsx --test`)                                     |

## Data

ClinVar is never fetched at request time. Build the dataset offline, then
restart the app:

```sh
bun run clinvar:download   # variant_summary.txt.gz + its Last-Modified as the release date
bun run clinvar:import     # -> data/clinvar-panel.json (git-ignored)
bun run clinvar:record-fixture   # optional: real rows for the recorded-fixture tests
```

The import streams the file, keeps GRCh38 records classified Pathogenic, Likely
pathogenic or Pathogenic/Likely pathogenic in the 24 panel genes
(`backend/crispr_backend/panel.py`) that ClinVar links to the panel disease's
OMIM id, and records the release date and the file's SHA-256. Conflicting,
uncertain and benign records are never kept.

Simulated patients are optional: `data/simulated-patients.json` (or
`CRISPR_PATIENTS_DATA`) holds `{ patientId: "sim-NNN", sex, report }` entries,
where `report` is the backend's analysis report. Patient ids must be `sim-NNN`;
1000 Genomes sample ids are rejected.

`/api/state` and the page header report which data is in use: "ClinVar release
YYYY-MM-DD", or "Real data unavailable" with the reason when the graph fell
back to the illustrative seed.

### Not sourced

ClinVar's summary has no consequence, protein length, gene name, strand,
organ expression, symptom frequencies or gnomAD frequency. These read "not
loaded". HPO symptom annotations exist in the backend database
(`disease_phenotypes`) but are not imported here yet.

## Environment

| Variable               | Effect                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| `AI_GATEWAY_API_KEY`   | Real model through the Vercel AI Gateway; unset runs the demo model |
| `CRISPR_MODEL`         | Gateway model id (default `anthropic/claude-sonnet-5.5`) or `demo`  |
| `CRISPR_CLINVAR_DATA`  | Path to the ClinVar import (default `data/clinvar-panel.json`)      |
| `CRISPR_PATIENTS_DATA` | Path to simulated patients (default `data/simulated-patients.json`) |
| `CRISPR_SEQUENCE`      | `ensembl` for real GRCh38 windows; otherwise synthetic              |

## Commands

```sh
bun run build         # dist/workbench/index.html
bun run check-types
bun run test
bun run lint
bun run bench         # retrieval latency on the seed graph
```

## Changelog

### 2026-10-18

- Moved from `prototypes/chat-workbench` into a workspace so the web app imports
  it as `@crispr/chat-agent`; the prototype was removed once the move was
  verified. Dependencies are pinned to the versions already in `bun.lock`.
- ClinVar is imported offline from `variant_summary.txt.gz`, not the VCF the
  backend ETL uses: only the summary has submitter counts, last-evaluated dates
  and RCV accessions. Columns are read by header name and both the pre-2024
  and germline column names are accepted.
- ClinVar classifications are quoted verbatim with review status, submitters,
  last-evaluated date, accession and release. The reference scorer needs one of
  five classes, so "Pathogenic/Likely pathogenic" is weighted as Likely
  pathogenic there; display text always uses ClinVar's wording.
- The release date comes from the download's Last-Modified header or
  `--release`; the importer refuses to guess one.
- Backend reports carry a tier and genotype status but no numeric score, so
  ingested findings keep scores null and the UI says "not computed" instead of
  showing the reference scorer's numbers as the pipeline's.
- The graph falls back to the seed only as a whole, with the reason on screen;
  ClinVar and seed nodes are never mixed.
- An Ensembl window is shown as real only when its reference allele matches the
  stored one; failed lookups are not cached.
- `/api/chat` rejects bodies over 256 kB and questions over 2000 characters,
  carries only prior-focus ids that match the graph id pattern and exist,
  aborts a turn after 55 s, and rate-limits each IP to 20 requests a minute.
  The limiter is in memory per process or Workers isolate, so it limits bursts,
  not a global quota.
- On Cloudflare Workers the import is read with `node:fs`, which cannot see the
  repository at runtime, so a deployed `/chat` shows the seed fallback until the
  dataset is bundled into the Worker.
