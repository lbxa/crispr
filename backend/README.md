# Crispr backend

Python API that takes a genome (single-sample VCF, GRCh38) and a symptom description,
finds disease-causing variants that fit both, and proposes a CRISPR-Cas9 edit. It runs
on IBM LinuxONE (s390x) and uses a language model to read symptoms: Google Gemini via
its API, or IBM Granite running locally via llama.cpp (see [Language model](#language-model)).

**Research prototype on simulated genomes. Not medical advice.**

## How it works

```
VCF + symptoms
 ├─ genotype   match calls to ClinVar pathogenic variants; apply inheritance
 │             (dominant: 1 copy; recessive: 2 copies, phase-aware; X-linked by sex)
 ├─ phenotype  symptoms text → HPO terms (language model + HPO name/synonym matching)
 │             → Resnik similarity to each panel disease's HPO profile
 ├─ tiering    likely (genotype + disease ranks top 3 by symptoms) / possible / carrier
 ├─ crispr     SpCas9 NGG guides near the variant, ranked by cut distance, GC,
 │             poly-T and allele specificity; repair template for correction or an
 │             allele-specific knockout for gain-of-function disease; base/prime
 │             editing alternative. Off-target activity is NOT assessed.
 └─ report     JSON with evidence, edit plans, template summary and disclaimer
```

**Disease panel:** 24 single-gene diseases caused by small variants
([panel.py](crispr_backend/panel.py)), from sickle cell anemia and cystic fibrosis to
Marfan syndrome and hemophilia A/B.

**Demo genomes:** real 1000 Genomes 30x samples restricted to the panel genes. A
fraction get ClinVar pathogenic variants (2+ review stars) planted in a
disease-causing pattern; the rest are controls. What was planted is stored in
`genome_truth`, which only the simulation layer reads. A test enforces that the
analysis never reads it.

## Code map

| Path                                                          | Owns                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `crispr_backend/panel.py`                                     | Disease panel, inheritance and mechanism                                             |
| `crispr_backend/db.py`                                        | SQLite schema and connections                                                        |
| `crispr_backend/vcf.py`                                       | Pure-Python VCF reading (no htslib needed on s390x)                                  |
| `crispr_backend/analysis/`                                    | Genotype, phenotype, CRISPR design, pipeline. Never reads ground truth               |
| `crispr_backend/analysis/genome_view.py`                      | Versioned BED-compatible finding map and bounded GRCh38 reference contexts           |
| `crispr_backend/analysis/body_map.py`, `anatomy_regions.json` | Validated Gemini condition-to-avatar region mapping and supported display catalog    |
| `crispr_backend/simulation/`                                  | "Order your kit" flow and simulated customer symptoms; reads ground truth            |
| `crispr_backend/llm.py`                                       | Gemini or Granite, chosen in `.env`; `None` when unavailable                         |
| `crispr_backend/api.py`                                       | FastAPI app                                                                          |
| `crispr_backend/uploads/`                                     | Upload admission/capabilities, tus receipts, durable SQLite jobs and separate worker |
| `crispr_backend/reporting.py`, `lab_pdf.py`                   | Saved-analysis projections and paginated laboratory PDF; no catalog substitution or rescoring |
| `scripts/validate_large_genome.py`                            | Isolated-process memory measurement and resumability/integrity acceptance            |
| `scripts/validate_database_genomes.py`                        | Read-only streaming/parity acceptance for compressed demo-genome SQLite BLOBs        |
| `Dockerfile.tusd`, `Caddyfile`                                | Native s390x tusd build and authenticated streaming HTTPS proxy                      |
| `etl/`                                                        | Builds the database from HPO, ClinVar, Ensembl, NCBI and 1000 Genomes                |
| `scripts/evaluate.py`                                         | Accuracy on planted diseases and false-alarm rate on controls                        |
| `scripts/pregenerate_symptoms.py`                             | Batch language-model symptom descriptions                                            |

## Using the backend (no data download needed)

All data and the language model live on the LinuxONE server. The API is public at
**https://148-100-79-183.sslip.io** (interactive docs at `/docs` only when `CRISPR_PUBLIC_DOCS=1`; off by default). Code outside `backend/`
(the website, notebooks, teammates' scripts) talks to this API and never to the database;
only backend code opens the database.

| Method | Path                       | Purpose                                                                                                              |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                  | Liveness                                                                                                             |
| GET    | `/diseases`                | The panel                                                                                                            |
| GET    | `/reference/{chromosome}`  | `?start=&end=` → GRCh38 bases (zero-based, ≤ 16,384), `N` where unknown; read from `hg38.2bit`                       |
| GET    | `/genomes`                 | Demo genomes (id, 1000 Genomes sample, sex); never reveals what was planted                                          |
| GET    | `/genomes/{id}/genome.vcf` | One genome's panel VCF (~80 KB)                                                                                      |
| POST   | `/genomes/{id}/analyze`    | `{symptoms, use_llm?}` → report for a chosen genome                                                                  |
| POST   | `/orders`                  | Prototype "order your kit": random genome, returns `{id, status: "processing"}`; 429 if 3 orders are already running |
| GET    | `/orders/{id}`             | Status (`processing` → `ready`/`failed`), symptoms, report                                                           |
| GET    | `/orders/{id}/genome.vcf`  | The order's genome file                                                                                              |
| GET    | `/orders/{id}/truth`       | Demo only: what was planted, to check the report                                                                     |
| POST   | `/analyze`                 | Legacy small-file JSON analysis, limited to 20 MiB                                                                   |
| POST   | `/uploads`                 | Reserve a large genome upload; returns bearer capability and direct tus endpoint                                     |
| GET    | `/uploads/{id}`            | Authorized transfer/analysis progress and final report                                                               |
| GET    | `/uploads/{id}/report.pdf` | Capability-authorized laboratory PDF from the completed saved analysis                                               |
| POST   | `/uploads/{id}/complete`   | Verify durable upload and enqueue analysis idempotently                                                              |
| POST   | `/uploads/{id}/retry`      | Retry a retryable analysis without retransferring the genome                                                         |
| DELETE | `/uploads/{id}`            | Cancel unfinished transfer/analysis                                                                                  |
| GET    | `/genes`                   | Genes that can be scored for editing: disease, inheritance, mechanism, variant count                                 |
| GET    | `/genes/{gene}/crispr`     | Edit plans + CRISPRon scores by gene name; optional `variation_id`, `max_variants` (default 2)                       |

`use_llm: false` skips the language model and answers in under a second (`use_granite` is
accepted as the old name), but
then only symptoms written in medical terms are recognized (e.g. "bowing of the legs",
not "my legs are bowed"). Use it while iterating; leave it on for demos.

```sh
curl https://148-100-79-183.sslip.io/genomes
curl -X POST https://148-100-79-183.sslip.io/genomes/3/analyze -H 'Content-Type: application/json' \
  -d '{"symptoms": "macrocephaly, bowing of the legs, recurrent otitis media", "use_llm": false}'
```

CORS allows `http://localhost:3000`, `https://genome.lbxa.net` and `https://crispr.<account>.workers.dev`
(`CRISPR_CORS_ORIGINS` and `CRISPR_CORS_ORIGIN_REGEX` override them).

## Large genome workflow

The web flow uses tus-js-client → Caddy → tusd → persistent LinuxONE storage.
Next.js serves connection metadata only. Neither the web server nor the API
materializes a multi-gigabyte genome as multipart data, text or JSON. Plain `.vcf`
and compressed `.vcf.gz` are supported; compressed data stays compressed until
the streaming worker scans it. The legacy `/analyze` endpoint remains unchanged
for small-file callers.

The upload service issues a per-session bearer capability and reserves disk
capacity before transfer. Caddy checks every file request against that capability;
tusd owns offsets and locking. A separate worker claims persisted jobs, reports
scan counters and publishes results with a lease check. A restart recovers the
queue. Runtime state lives in `CRISPR_UPLOAD_DIR/jobs.sqlite3` and files beneath
`CRISPR_UPLOAD_DIR/files`, separate from the replaceable reference database.

Default ceilings are 10 GiB per upload, 40 GiB total reservations, four active
uploads and 2 GiB of free disk reserved. Transfer chunks are 8 MiB. Only exact
ClinVar loci relevant to the existing panel remain in memory; the report still
counts all passing alternate-allele calls. Whole-genome scanning does not expand
the 24-disease panel or add variant normalization.

Admission also limits each source address to two active uploads, six new sessions
per minute, and 10 GiB of retained reservations by default. Shared NAT clients
share that allowance. The stored address fingerprint is a resource-accounting
key, not an authenticated user identity. Only the loopback Caddy proxy is trusted
to supply forwarded client addresses. Empty reservations expire after five minutes;
stored bytes extend the transfer window to 24 hours.

Run the worker separately from uvicorn:

```sh
cd backend
.venv/bin/python -m crispr_backend.uploads.worker
```

Both processes require the same reference database and upload configuration.
The deploy script configures the shared persistent volume, the private tusd
endpoint and public HTTPS URL. For local end-to-end work, run native tusd and
Caddy with `backend/Caddyfile` and set `CRISPR_HOST=http://127.0.0.1:9080`,
`CRISPR_UPLOAD_PUBLIC_URL=http://127.0.0.1:9080/files/`,
`CRISPR_TUSD_INTERNAL_URL=http://127.0.0.1:1080/files/`, and an absolute
`CRISPR_UPLOAD_DIR`. Point the web app's `CRISPR_API_URL` at that Caddy origin.
Keep API/tusd bound to loopback; all browser requests go through the proxy.

See [the architecture and recovery contract](../docs/large-genome-processing.md)
and [the executable validation guide](scripts/LARGE_FILE_VALIDATION.md) for
protocol flags, resource limits, privacy, failure modes and acceptance commands.
Files already on IBM can be processed by the validation CLI directly; they do
not need to be downloaded or uploaded again for the server processing test.

## Developing backend code

Requires Python 3.12+. No data download is needed: tests use a small built-in database.

```sh
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
```

Checks: lint, formatting, pyright type checking and tests. Run them with `bun run verify:backend`
from the repo root (~10 s); the Claude/Codex stop hook also runs them whenever `backend/.venv` exists.

```sh
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pyright && .venv/bin/python -m pytest
```

`tests/test_clinvar.py` covers the ClinVar import offline; `.venv/bin/python -m pytest -m network`
also checks live ClinVar still has CFTR F508del in the expected format (run it after a new
ClinVar release).

**Only if you need real data locally** (rebuilding the database, `scripts/evaluate.py`): the
ETL keeps ~45 MB in the git-ignored `data/` (it streams more from 1000 Genomes while building but stores only the panel genes):

```sh
.venv/bin/python -m etl.build_reference     # ~15 min; resumable, --refresh to redo
.venv/bin/python -m etl.build_genomes --samples 100 --disease-fraction 0.5   # ~10 min
.venv/bin/python -m scripts.evaluate
```

## LinuxONE deployment

The server is a LinuxONE Community Cloud VM (Ubuntu 24.04, s390x, 3 vCPU, 8 GB).
The deployment runs `crispr-api` (localhost:8000), `crispr-proxy` (Caddy HTTPS
on 80/443), `crispr-tusd` (localhost:1080) and `crispr-upload-worker` alongside
IBM's `notebook` container. The upload server is built from pinned Go source
because upstream tusd release images/binaries do not include s390x. With the
server's SSH key (ask Callum):

```sh
backend/scripts/deploy.sh            # ship code; keeps the server's database and orders
backend/scripts/deploy.sh --with-db  # also replace the database with backend/data/crispr.sqlite
```

To check the deployed system end to end (server, data, HTTPS, language model), run the smoke
test from anywhere; it needs only Python 3, no virtualenv:

```sh
python3 backend/scripts/smoke_test.py          # full: includes a real order (~2 min with Granite)
python3 backend/scripts/smoke_test.py --quick  # skip the order (~5 s); deploy.sh runs this
python3 backend/scripts/smoke_test.py --url http://localhost:8000
```

It checks health, the panel, the genome list (no ground truth exposed), a genome
download, a fast analysis, and a full order compared against `/truth`. A planted
disease must always be found; whether it's ranked first is reported, since that depends
on the symptom text.

The deploy script is idempotent: it rebuilds and restarts the API, keeps ports 80/443 open in
`/etc/iptables/rules.v4`, and (re)starts the proxy.

Deployment also checks tusd/worker containers and runs a synthetic resumable
upload through public HTTPS from the deploying machine. Use the development
virtualenv above (or `CRISPR_VALIDATION_PYTHON`) for that gate. LinuxONE cannot
reach its own public IP, so public acceptance must run from an external client;
in-place file processing tests still run inside the worker on IBM.

## CRISPR advisability (CRISPRon)

Each edit plan gets an `advisability` block: the best CRISPRon-predicted indel frequency (0-100) among
its guides, a band (high >= 60, moderate >= 40, low) and a plain-language basis. Every guide also
carries its own `efficiency`, `model_scores` (each of the six ensemble models' predictions) and `energy` (the CRISPRoff
terms behind the ΔG input: `rna_dna`, `rna_dna_weighted`, `dna_opening`, `spacer_self_fold`, `crisproff_score`), plus its
30-nt `context`. Guide ranking is unchanged. CRISPRon runs as a separate service
([scoring_service/](scoring_service/)) in IBM's s390x TensorFlow 2.4.1 container, because the backend's
Python 3.12 is newer than that TensorFlow supports. Set `CRISPRON_URL` in `.env` to enable it; unset or
unreachable, reports simply omit the score. The service needs the cloned
[RTH-tools/crispron](https://github.com/RTH-tools/crispron) repo (SavedModels in
`data/deep_models/best/*/`, `data/model/energy_dics.pkl`) mounted at `/crispron`, plus the CRISPRoff
pipeline script that CRISPRon uses for ΔG (ViennaRNA 2.2.5 via Bioconda).

**Setup (verified).** Clone [RTH-tools/crispron](https://github.com/RTH-tools/crispron) (AGPL-3.0) into
`backend/data/crispron` and add two files from the [CRISPRoff 1.1.2 download](https://rth.dk/resources/crispr/crisproff/download):
`CRISPRspec_CRISPRoff_pipeline.py` to `bin/` and `energy_dics.pkl` to `data/model/`. In a conda env with
`python=3.9 biopython=1.78 viennarna=2.2.5 tensorflow=2.4.1 numpy=1.19.5` (conda-forge + bioconda), start the service
with `CRISPRON_DIR=backend/data/crispron python -m scoring_service.server`. On the 341 guides in CRISPRon's own test
set it reproduces the published predictions to within 0.005. Then run the API with `CRISPRON_URL=http://127.0.0.1:8001`.

Reports (`overview`) and gene plans carry one verdict: the best advisability score against a threshold
(`recommended`, `not_recommended`, `unavailable`, `no_guide` when no SpCas9 target lies near any variant, or `no_edit`). The threshold defaults to 50 and is set with
`CRISPR_ADVISE_THRESHOLD`; it is provisional until real gene scores have been reviewed.

To try it locally without TensorFlow or the model files, run `.venv/bin/python -m scripts.dev_stack`:
a synthetic database plus a **mock** scorer on :8001 and the API on :8000, then open the web app's
`/advisability-test` page.

### CRISPRon scorer on the LinuxONE server

The server's notebook image has TensorFlow 2.18 (not 2.4.1), so the scorer runs from
`scoring_service/Dockerfile.linuxone`: it compiles ViennaRNA 2.2.5 from source and installs
Biopython; `model.py` falls back to the graph-mode SavedModel loader that ignores the saved optimizer
state. Scores differ from the TF 2.4.1 reference by about 0.1 points; the CRISPRoff energies match
exactly. Run as the `crispr-scorer` container on loopback port 8001 (`SCORER_HOST=127.0.0.1`), with
the CRISPRon `bin/`, `data/model/` and `data/deep_models/best/` mounted at `/crispron`, and
`CRISPRON_URL=http://127.0.0.1:8001` in the server's `backend/.env`. `deploy.sh` does not manage
the scorer container; rebuild it by hand after changing `scoring_service/`.

## Language model

The model turns customers' plain-language symptoms into clinical terms. Gemini also
maps non-carrier findings onto the avatar's supported body regions; genotype,
clinical tiering and edit planning remain deterministic. Choose it in `backend/.env`, copied from `.env.example` (git-ignored;
values without quotes):

```sh
cp backend/.env.example backend/.env   # then add GEMINI_API_KEY
backend/scripts/deploy.sh              # uploads .env to the server, readable only by linux1
```

| `CRISPR_LLM` | Model                                                                  | Trade-off                                               |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `gemini`     | Gemini 3.6 Flash via the Gemini API (`GEMINI_API_KEY`, `GEMINI_MODEL`) | Seconds per order; symptom text is sent to Google       |
| `granite`    | IBM Granite 3.3 2B on LinuxONE via llama.cpp                           | Nothing leaves the server; ~1 token/s, ~2 min per order |
| `none`       | No model                                                               | Keyword matching only                                   |
| blank        | Gemini if a key is set, otherwise Granite                              |                                                         |

If the model errors or is over quota, the analysis falls back to keyword matching
instead of failing. Tests always run with `none` and fake HTTP, so they never call a model.

### Avatar body mapping

Completed reports include `body_map` version 1, separate from the DNA-coordinate
`genome_view`. `mapped` results identify each non-carrier finding by its index in
the final sorted `findings` array and list `region_ids` from `anatomy_regions.json`.
`not_needed` means there are no disease findings to visualize; `unavailable`
means mapping was disabled or Gemini was unavailable or returned invalid output.
An empty region list means the condition has no supported surface association.
These are display associations, not predicted symptoms or clinical diagnoses.

The upload worker requests mapping with `map_body=True` while keeping symptom
extraction off. Other callers follow `use_llm` unless they explicitly override
`map_body`. Configure `CRISPR_LLM=gemini` and `GEMINI_API_KEY` to enable it; Granite
is never loaded for this feature. One schema-constrained call receives only
condition names, gene symbols, OMIM IDs and the region catalog. Raw genome data,
sample identifiers and symptom text are excluded. Responses must cover exactly
the eligible findings with unique, supported regions. Invalid responses produce
no partial highlights and never fail the genome analysis. Existing worker lease
heartbeats continue during the call, and the completed mapping is persisted
with the report. Reading or refreshing a completed report makes no model call.

**Granite model file:** `~/shared/models/granite-3.3-2b-instruct-be.Q4_K_M.gguf`, a
big-endian build from
[taronaeo/Granite-3.3-2B-Instruct-BE-GGUF](https://huggingface.co/taronaeo/Granite-3.3-2B-Instruct-BE-GGUF)
(the filename IBM's demo code expects). The model bundled in IBM's image is a 350M
base model that cannot follow instructions.

## Changelog

### 2026-10-18

- Genome laboratory PDFs follow a bank-receipt layout: compact branded letterhead on every page, white paper, aligned label/value rows, restrained rules and no shaded panels or boxed evidence tables. Keep the full scientific evidence and provenance; validate pagination visually after renderer changes, including long annotations and empty results.
- Laboratory PDFs use the completed upload's immutable `report_json`, exact alleles and GRCh38 coordinates, inherited genotype evidence, guides, repair templates and original scoring threshold. `GET /uploads/{id}/report.pdf` requires that upload's bearer capability, returns an attachment with `private, no-store`, and applies 20 requests/minute per source and two concurrent renders. ReportLab embeds its bundled fonts and escapes report strings; rendering makes no model/network calls. Catalog plans and carrier findings must never become patient editing targets. The research score estimates cutting activity, not clinical eligibility or treatment success.
- Completed upload views now include actual `gene_plans` and bounded finding evidence. Preserve the saved threshold when projecting each gene; changing the runtime threshold must not reinterpret an existing analysis. Jobs whose saved evidence fails the lab schema cannot export and need reanalysis; existing summaries remain readable.
- Avatar display metadata recognizes the exact selected-sample identifiers `HG001`, `NA12878` and `GM12878` as female, as documented in [NIST RM 8398](https://tsapps.nist.gov/srmext/certificates/8398%28QTY10%29.pdf). The HG001 v4.2.1 benchmark lacks `##SAMPLE` sex metadata. Conflicting, malformed or oversized declarations remain unknown; never infer a profile from the filename or absent Y calls, or use this display fallback as clinical sex.
- The production browser origin is `https://genome.lbxa.net`. Keep API CORS, upload origin authorization and tusd's deployment allowlist aligned; the frontend transfers genomes directly to this backend.
- Security hardening. Caddy now blocks `/internal/*` with a `handle` block (a bare `respond` ran after the catch-all `handle`, so the tus hook and forward-auth routes were publicly reachable), caps non-upload bodies at 21 MB, and sends HSTS, nosniff, frame and referrer headers without a `Server` header. `crispr_backend/security.py` owns allowed origins (this team's Worker and `genome.lbxa.net`, not any `crispr.*.workers.dev`), per-IP rate limits (`CRISPR_ANALYSES_PER_MINUTE` 20, `CRISPR_PLANS_PER_MINUTE` 60, `CRISPR_ORDERS_PER_MINUTE` 5) and a cap on concurrent analyses (`CRISPR_MAX_ACTIVE_ANALYSES` 3), each answering 429 with `Retry-After`. `/docs`, `/redoc` and `/openapi.json` need `CRISPR_PUBLIC_DOCS=1`; VCF parse errors no longer echo input; the scorer binds loopback by default. `deploy.sh` restores a missing `CRISPRON_URL`, keeps `~/data` owner-only (0700/0600) and limits tusd CORS to the same origins; base images are pinned by digest.
- `/reference/{chromosome}` serves GRCh38 bases from UCSC's `hg38.2bit` (835 MB) in `~/data/reference/` on the server; `deploy.sh` downloads it once. `reference.py` is a pure-Python, byte-order-aware random-access reader (a 4,096-base read takes ~0.3 ms on LinuxONE), so no compiled 2bit library is needed on s390x. Without the file the endpoint returns 503 and the web app falls back to `N`.
- Avatar mapping uses Gemini only after deterministic clinical findings are finalized. Restrict its schema to the avatar catalog and exact non-carrier finding indices so the model cannot add diagnoses, color carriers or change clinical tiers. Keep disease associations separate from predicted symptoms and genetic edit targets.
- Persist `body_map` with completed upload reports; reuse it on reads and refreshes. Mapping is optional enrichment, so provider errors leave an explicit unavailable state instead of failing genome analysis. The web contract test checks catalog parity with the actual model regions.
- Gemini's structured-output grammar rejects larger nested `maxItems` bounds. Keep the outer mapping cardinality limit in Pydantic and validate exact finding coverage locally; retain the supported-region enum in the request schema. Live acceptance covers the full 24-condition panel, not just a single finding.

### 2026-10-17

- Genome uploads return nullable `genome.model_profile` for the selected sample's explicit `##SAMPLE=<ID=...,Sex=male|female>` metadata (also `M`/`F`, case-insensitive). Header collection is capped at 64 KiB; missing, malformed, conflicting or oversized metadata stays unknown. This is display metadata only: it never changes the clinical sex supplied to analysis or estimates sex from missing Y variants.
- Disease-positive viewer tests use exact GRCh38 panel alleles and disease-causing genotypes. A synthetic homozygous [CFTR F508del](https://www.ncbi.nlm.nih.gov/clinvar/variation/7105/) (`7:117559590 ATCT>A`) plus homozygous [HBB HbS](https://www.ncbi.nlm.nih.gov/clinvar/variation/15333/) (`11:5227002 T>A`) produces two affected-genotype findings with reference contexts on separate chromosomes. Genome-only requests label both `possible` because no symptoms were supplied; the browser fixture's heterozygous CFTR call deliberately tests a carrier instead.
- Completed analyses include `genome_view` with GRCh38 primary chromosome lengths, zero-based half-open finding intervals, separate REF/ALT alleles and deduplicated disease annotations. The browser receives this explicit projection alongside its summary; raw symptom/edit payloads remain excluded. See `docs/genome-regions.md` at the repository root for the wire contract.
- Reference context comes only from verified forward-strand `gene_regions` sequence, bounded to 256 flanking bases on each side and 1,536 total bases. Missing/mismatched context remains unavailable; VCFs cannot reconstruct complete patient chromosomes. Older stored job reports remain readable but require reanalysis for a map.
- Large genomes use direct resumable tus transfers to IBM storage and a separate durable worker; Next.js remains a small control plane. Job state is separate from `crispr.sqlite` so `deploy.sh --with-db` cannot erase uploads or analysis recovery state.
- Existing demo genomes stay gzip-compressed in `crispr.sqlite`'s `genomes.vcf_gz` column, mounted at `/data/crispr.sqlite` on IBM. Validate them in place through SQLite BLOB streaming; avoid exporting all genomes or moving large uploads into that demo database.
- LinuxONE cannot reach its own public IP through NAT loopback. Deployment acceptance uses the deploying client for public HTTPS transfers and the worker container for in-place processing, so each check exercises the intended network path.
- Per-source reservation, creation-rate and byte caps complement global admission. The proxy owns trusted client-address forwarding; application code ignores arbitrary forwarded headers, and a source fingerprint is not an authenticated account.
- Duplicate forced-ID tus creation must remain rejected: tusd's filestore truncates collisions. A claimed resource that never reached disk recovers through a fresh session ID; cancellation cleanup waits for late creation and resweeps tombstones before releasing accounting.
- Upload scanning streams plain VCF, gzip and BGZF while retaining only exact ClinVar matches. Missing assembly metadata retains the GRCh38 assumption; explicit GRCh37/hg19 and multiple samples fail. Identical relevant duplicates collapse and conflicting genotypes fail to avoid false inheritance findings; counters still describe the full scan.
- Caddy authorizes every file request with a session capability, hides internal routes and streams bodies. tusd owns locking and safe termination; cleanup must keep its private termination API enabled even though public deletion goes through FastAPI.
- The HG001 benchmark is an acceptance input, not an expanded clinical panel. Parser RSS/timing, complete worker memory and real IBM throughput are separate claims; use files already on the server for remote processing validation without another transfer.
- The language model is swappable (`llm.py`): Gemini 3.6 Flash via API or Granite on LinuxONE, set in a git-ignored `.env` that `deploy.sh` uploads separately so the key never enters the Docker image. Gemini is far faster, but sends symptom text to Google and weakens the "AI on IBM Z" story; Granite stays available. Gemini 3.x ignores `temperature` and counts thinking tokens toward the output limit, so the client sends neither a temperature nor a token cap.
- All data and Granite stay on the server; teammates and the website use the public HTTPS API, so nobody needs the database locally. Ports 80/443 are persisted by editing `/etc/iptables/rules.v4` directly: `iptables-save` would also capture Docker's chains, which fail to restore at boot before Docker starts.
- `POST /orders` is capped at 3 concurrent orders (orders still processing after 10 minutes are treated as abandoned) because each runs ~1 minute of Granite on a 3-vCPU VM and the API is public.

- Backend lives outside the Bun workspaces: Cloudflare Workers Builds runs `bun run verify` for every deploy and has no Python environment, so Python checks run via `bun run verify:backend` instead. The stop hook runs it only when `backend/.venv` exists, so teammates without the Python setup are unaffected.
- pyhpo's `Ontology()` re-reads its data (~5 s) on every call; `phenotype.load_ontology()` caches it per process, which cut the backend checks from ~50 s to ~9 s.
- Demo genomes are 1000 Genomes samples with ClinVar variants planted in a fraction; there is no public set of diagnosed patient genomes. Controls can still carry real pathogenic variants: in the first build, a male with a hemizygous G6PD variant and a carrier of TTR V142I (common in West African ancestry, low penetrance) are genuine findings, not pipeline errors.
- Granite 3.3 2B runs at ~1 token/s on the 3-vCPU VM. It is used only to extract symptoms at order time (~2 min per order end to end). Report summaries are templated because Granite garbled variant facts in testing, and customer symptom texts are pre-generated in batch.
- Template symptom texts reuse HPO term names, so evaluation on them is optimistic (100% of planted diseases ranked first, 4% of controls flagged on 100 genomes × 3 descriptions). Granite-written descriptions are the realistic test.
- HPO lists G6PD deficiency as X-linked dominant; the panel treats it as recessive because heterozygous females are usually unaffected.
