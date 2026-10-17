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

## API

| Method | Path                      | Purpose                                                                                      |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/health`                 | Liveness                                                                                     |
| GET    | `/diseases`               | The panel                                                                                    |
| POST   | `/orders`                 | Prototype "order your kit": picks a random demo genome, returns `{id, status: "processing"}` |
| GET    | `/orders/{id}`            | Status (`processing` → `ready`/`failed`), symptoms, report                                   |
| GET    | `/orders/{id}/genome.vcf` | The order's genome file                                                                      |
| GET    | `/orders/{id}/truth`      | Demo only: what was planted, to check the report                                             |
| POST   | `/analyze`                | `{vcf, symptoms, sex?}` → report; the real product's entry point                             |

Interactive docs: `/docs` once running. CORS origins come from `CRISPR_CORS_ORIGINS`
(comma-separated, default `http://localhost:3000`).

## Local development

Requires Python 3.12+.

```sh
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m etl.build_reference     # ~15 min; resumable, --refresh to redo
.venv/bin/python -m etl.build_genomes --samples 100 --disease-fraction 0.5   # ~10 min
.venv/bin/uvicorn crispr_backend.api:app --port 8000
```

Checks (also `bun run verify:backend` from the repo root):

```sh
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/python -m pytest
.venv/bin/python -m scripts.evaluate
```

Tests use a small built-in database and need no downloads. `data/` and `.venv/` are
git-ignored; rebuild the data with the ETL commands.

## LinuxONE deployment

The server is a LinuxONE Community Cloud VM (Ubuntu 24.04, s390x, 3 vCPU, 8 GB).
Docker and IBM's jupyter-lab-ml image are installed. From `backend/` on a laptop:

```sh
tar --exclude=__pycache__ -czf backend.tgz Dockerfile requirements.txt crispr_backend scripts
scp -i ~/.ssh/crispr.pem backend.tgz data/crispr.sqlite linux1@<server-ip>:~/
ssh -i ~/.ssh/crispr.pem linux1@<server-ip>
# on the server:
mkdir -p ~/backend ~/data && tar -xzf backend.tgz -C ~/backend && mv crispr.sqlite ~/data/
chmod a+rw ~/data ~/data/crispr.sqlite
cd ~/backend && sudo docker build -t crispr-backend .
sudo docker rm -f crispr-api; sudo docker run -d --name crispr-api --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v ~/data:/data -v ~/shared/models:/models:ro crispr-backend
```

The API listens on localhost only. To call it from your laptop:
`ssh -i ~/.ssh/crispr.pem -L 8000:localhost:8000 linux1@<server-ip>`, then
http://localhost:8000/docs. Exposing it to the website needs HTTPS (the site is served
over HTTPS, so browsers block plain-HTTP calls): put Caddy in front with a hostname such as
`<ip-with-dashes>.sslip.io` and open ports 80/443 with iptables. That is not done yet.

**Granite model:** `~/shared/models/granite-3.3-2b-instruct-be.Q4_K_M.gguf`, a
big-endian build from
[taronaeo/Granite-3.3-2B-Instruct-BE-GGUF](https://huggingface.co/taronaeo/Granite-3.3-2B-Instruct-BE-GGUF)
(the filename IBM's demo code expects). The model bundled in IBM's image is a 350M
base model that cannot follow instructions.

## Changelog

### 2026-10-17

- Backend lives outside the Bun workspaces: Cloudflare Workers Builds runs `bun run verify` for every deploy and has no Python environment, so Python checks run via `bun run verify:backend` instead.
- Demo genomes are 1000 Genomes samples with ClinVar variants planted in a fraction; there is no public set of diagnosed patient genomes. Controls can still carry real pathogenic variants: in the first build, a male with a hemizygous G6PD variant and a carrier of TTR V142I (common in West African ancestry, low penetrance) are genuine findings, not pipeline errors.
- Granite 3.3 2B runs at ~1 token/s on the 3-vCPU VM. It is used only to extract symptoms at order time (~2 min per order end to end). Report summaries are templated because Granite garbled variant facts in testing, and customer symptom texts are pre-generated in batch.
- Template symptom texts reuse HPO term names, so evaluation on them is optimistic (100% of planted diseases ranked first, 4% of controls flagged on 100 genomes × 3 descriptions). Granite-written descriptions are the realistic test.
- HPO lists G6PD deficiency as X-linked dominant; the panel treats it as recessive because heterozygous females are usually unaffected.
