# Crispr backend

Python API that takes a genome (single-sample VCF, GRCh38) and a symptom description,
finds disease-causing variants that fit both, and proposes a CRISPR-Cas9 edit. It runs
on IBM LinuxONE (s390x) and uses IBM Granite, locally via llama.cpp, to read symptoms.

**Research prototype on simulated genomes. Not medical advice.**

## How it works

```
VCF + symptoms
 ├─ genotype   match calls to ClinVar pathogenic variants; apply inheritance
 │             (dominant: 1 copy; recessive: 2 copies, phase-aware; X-linked by sex)
 ├─ phenotype  symptoms text → HPO terms (Granite + HPO name/synonym matching)
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

| Path                              | Owns                                                                      |
| --------------------------------- | ------------------------------------------------------------------------- |
| `crispr_backend/panel.py`         | Disease panel, inheritance and mechanism                                  |
| `crispr_backend/db.py`            | SQLite schema and connections                                             |
| `crispr_backend/vcf.py`           | Pure-Python VCF reading (no htslib needed on s390x)                       |
| `crispr_backend/analysis/`        | Genotype, phenotype, CRISPR design, pipeline. Never reads ground truth    |
| `crispr_backend/simulation/`      | "Order your kit" flow and simulated customer symptoms; reads ground truth |
| `crispr_backend/granite.py`       | Optional local Granite (llama.cpp); `None` when unavailable               |
| `crispr_backend/api.py`           | FastAPI app                                                               |
| `etl/`                            | Builds the database from HPO, ClinVar, Ensembl, NCBI and 1000 Genomes     |
| `scripts/evaluate.py`             | Accuracy on planted diseases and false-alarm rate on controls             |
| `scripts/pregenerate_symptoms.py` | Batch Granite symptom descriptions (slow)                                 |

## Using the backend (no data download needed)

All data and the Granite model live on the LinuxONE server. The API is public at
**https://148-100-79-183.sslip.io** (interactive docs at `/docs`). Code outside `backend/`
(the website, notebooks, teammates' scripts) talks to this API and never to the database;
only backend code opens the database.

| Method | Path                       | Purpose                                                                                                              |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                  | Liveness                                                                                                             |
| GET    | `/diseases`                | The panel                                                                                                            |
| GET    | `/genomes`                 | Demo genomes (id, 1000 Genomes sample, sex); never reveals what was planted                                          |
| GET    | `/genomes/{id}/genome.vcf` | One genome's panel VCF (~80 KB)                                                                                      |
| POST   | `/genomes/{id}/analyze`    | `{symptoms, use_granite?}` → report for a chosen genome                                                              |
| POST   | `/orders`                  | Prototype "order your kit": random genome, returns `{id, status: "processing"}`; 429 if 3 orders are already running |
| GET    | `/orders/{id}`             | Status (`processing` → `ready`/`failed`), symptoms, report                                                           |
| GET    | `/orders/{id}/genome.vcf`  | The order's genome file                                                                                              |
| GET    | `/orders/{id}/truth`       | Demo only: what was planted, to check the report                                                                     |
| POST   | `/analyze`                 | `{vcf, symptoms, sex?, use_granite?}` → report; the real product's entry point                                       |

`use_granite: false` skips the ~1 minute Granite step and answers in under a second, but
then only symptoms written in medical terms are recognized (e.g. "bowing of the legs",
not "my legs are bowed"). Use it while iterating; leave it on for demos.

```sh
curl https://148-100-79-183.sslip.io/genomes
curl -X POST https://148-100-79-183.sslip.io/genomes/3/analyze -H 'Content-Type: application/json' \
  -d '{"symptoms": "macrocephaly, bowing of the legs, recurrent otitis media", "use_granite": false}'
```

CORS allows `http://localhost:3000` and `https://crispr.<account>.workers.dev`
(`CRISPR_CORS_ORIGINS` and `CRISPR_CORS_ORIGIN_REGEX` override them).

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

The server is a LinuxONE Community Cloud VM (Ubuntu 24.04, s390x, 3 vCPU, 8 GB) running
three containers: `crispr-api` (this backend, localhost:8000), `crispr-proxy` (Caddy:
HTTPS on 80/443 with an automatic certificate for the sslip.io name) and `notebook`
(IBM's Jupyter image). With the server's SSH key (ask Callum):

```sh
backend/scripts/deploy.sh            # ship code; keeps the server's database and orders
backend/scripts/deploy.sh --with-db  # also replace the database with backend/data/crispr.sqlite
```

The script is idempotent: it rebuilds and restarts the API, keeps ports 80/443 open in
`/etc/iptables/rules.v4`, and (re)starts the proxy.

**Granite model:** `~/shared/models/granite-3.3-2b-instruct-be.Q4_K_M.gguf`, a
big-endian build from
[taronaeo/Granite-3.3-2B-Instruct-BE-GGUF](https://huggingface.co/taronaeo/Granite-3.3-2B-Instruct-BE-GGUF)
(the filename IBM's demo code expects). The model bundled in IBM's image is a 350M
base model that cannot follow instructions.

## Changelog

### 2026-10-17

- All data and Granite stay on the server; teammates and the website use the public HTTPS API, so nobody needs the database locally. Ports 80/443 are persisted by editing `/etc/iptables/rules.v4` directly: `iptables-save` would also capture Docker's chains, which fail to restore at boot before Docker starts.
- `POST /orders` is capped at 3 concurrent orders (orders still processing after 10 minutes are treated as abandoned) because each runs ~1 minute of Granite on a 3-vCPU VM and the API is public.

- Backend lives outside the Bun workspaces: Cloudflare Workers Builds runs `bun run verify` for every deploy and has no Python environment, so Python checks run via `bun run verify:backend` instead. The stop hook runs it only when `backend/.venv` exists, so teammates without the Python setup are unaffected.
- pyhpo's `Ontology()` re-reads its data (~5 s) on every call; `phenotype.load_ontology()` caches it per process, which cut the backend checks from ~50 s to ~9 s.
- Demo genomes are 1000 Genomes samples with ClinVar variants planted in a fraction; there is no public set of diagnosed patient genomes. Controls can still carry real pathogenic variants: in the first build, a male with a hemizygous G6PD variant and a carrier of TTR V142I (common in West African ancestry, low penetrance) are genuine findings, not pipeline errors.
- Granite 3.3 2B runs at ~1 token/s on the 3-vCPU VM. It is used only to extract symptoms at order time (~2 min per order end to end). Report summaries are templated because Granite garbled variant facts in testing, and customer symptom texts are pre-generated in batch.
- Template symptom texts reuse HPO term names, so evaluation on them is optimistic (100% of planted diseases ranked first, 4% of controls flagged on 100 genomes × 3 descriptions). Granite-written descriptions are the realistic test.
- HPO lists G6PD deficiency as X-linked dominant; the panel treats it as recessive because heterozygous females are usually unaffected.
