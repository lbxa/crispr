"""HTTP API for the Crispr prototype.

Run: .venv/bin/uvicorn crispr_backend.api:app --port 8000

Everything outside backend/ (the website, teammates' scripts and notebooks) reads
genome data through this API; only backend code opens the database directly.
"""

import gzip
import os
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import AliasChoices, BaseModel, Field

from crispr_backend import db
from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.panel import PANEL
from crispr_backend.simulation import orders
from crispr_backend.vcf import read_calls, read_calls_gz

MAX_VCF_BYTES = 20 * 1024 * 1024
# Each order calls the language model (~1 min with Granite on the 3-vCPU server); cap
# concurrent orders so a public API can't queue unbounded work.
MAX_ACTIVE_ORDERS = int(os.environ.get("CRISPR_MAX_ACTIVE_ORDERS", "3"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    with db.session() as connection:
        app.state.analyzer = Analyzer(connection)  # loads HPO and reference data once (~5 s)
    yield


app = FastAPI(title="Crispr prototype API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CRISPR_CORS_ORIGINS", "http://localhost:3000").split(",")],
    # The website is served from crispr.<account>.workers.dev.
    allow_origin_regex=os.environ.get("CRISPR_CORS_ORIGIN_REGEX", r"https://crispr\.[a-z0-9-]+\.workers\.dev"),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class AnalyzeRequest(BaseModel):
    vcf: str = Field(description="Single-sample VCF text on GRCh38", max_length=MAX_VCF_BYTES)
    symptoms: str = Field(default="", max_length=5000)
    sex: Literal["male", "female"] | None = None
    use_llm: bool = Field(
        default=True,
        validation_alias=AliasChoices("use_llm", "use_granite"),  # use_granite: the earlier name
        description="False skips the language model (keyword matching only)",
    )


class GenomeAnalyzeRequest(BaseModel):
    symptoms: str = Field(default="", max_length=5000)
    use_llm: bool = Field(
        default=True,
        validation_alias=AliasChoices("use_llm", "use_granite"),  # use_granite: the earlier name
        description="False skips the language model (keyword matching only)",
    )


def run_order_in_background(order_id: str) -> None:
    with db.session() as connection:
        orders.run_order(connection, app.state.analyzer, order_id)


def genome_row(connection, genome_id: int):
    genome = connection.execute("SELECT * FROM genomes WHERE id = ?", (genome_id,)).fetchone()
    if genome is None:
        raise HTTPException(404, "Genome not found")
    return genome


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/diseases")
def diseases() -> list[dict]:
    return [{"omim_id": d.omim_id, "name": d.name, "gene": d.gene, "inheritance": d.inheritance.value} for d in PANEL]


@app.get("/genomes")
def list_genomes() -> list[dict]:
    """Demo genomes, without what was planted in them."""
    with db.session() as connection:
        rows = connection.execute("SELECT id, sample_id, sex FROM genomes ORDER BY id").fetchall()
    return [dict(row) for row in rows]


@app.get("/genomes/{genome_id}/genome.vcf")
def get_genome_vcf(genome_id: int) -> Response:
    with db.session() as connection:
        genome = genome_row(connection, genome_id)
    return Response(
        gzip.decompress(genome["vcf_gz"]),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{genome["sample_id"]}-panel.vcf"'},
    )


@app.post("/genomes/{genome_id}/analyze")
def analyze_genome(genome_id: int, request: GenomeAnalyzeRequest) -> dict:
    """Analyze a chosen demo genome with your own symptom text; useful for scripted demos and testing."""
    with db.session() as connection:
        genome = genome_row(connection, genome_id)
    calls = read_calls_gz(genome["vcf_gz"])
    return app.state.analyzer.analyze(calls, request.symptoms, genome["sex"], request.use_llm)


@app.post("/orders", status_code=202)
def create_order(background: BackgroundTasks) -> dict:
    with db.session() as connection:
        if orders.active_orders(connection) >= MAX_ACTIVE_ORDERS:
            raise HTTPException(429, "Too many orders are being analyzed right now; try again in a minute.")
        try:
            order = orders.create_order(connection)
        except LookupError as error:
            raise HTTPException(503, str(error)) from error
    background.add_task(run_order_in_background, order["id"])
    return order


@app.get("/orders/{order_id}")
def get_order(order_id: str) -> dict:
    with db.session() as connection:
        order = orders.order_view(connection, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    return order


@app.get("/orders/{order_id}/genome.vcf")
def get_order_genome(order_id: str) -> Response:
    with db.session() as connection:
        row = connection.execute("SELECT genome_id FROM orders WHERE id = ?", (order_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Order not found")
    return get_genome_vcf(row["genome_id"])


@app.get("/orders/{order_id}/truth")
def get_truth(order_id: str) -> dict:
    """Demo only: reveals what was planted so viewers can check the analysis."""
    with db.session() as connection:
        truth = orders.reveal_truth(connection, order_id)
    if truth is None:
        raise HTTPException(404, "Order not found")
    return truth


@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> dict:
    """The real product's entry point: analyze an uploaded genome and symptom description."""
    try:
        calls = read_calls(request.vcf)
    except (ValueError, IndexError) as error:
        raise HTTPException(422, f"Could not read VCF: {error}") from error
    return app.state.analyzer.analyze(calls, request.symptoms, request.sex, request.use_llm)
