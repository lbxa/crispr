"""HTTP API for the Crispr prototype.

Run: .venv/bin/uvicorn crispr_backend.api:app --port 8000
"""

import gzip
import os
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from crispr_backend import db
from crispr_backend.analysis.pipeline import Analyzer
from crispr_backend.panel import PANEL
from crispr_backend.simulation import orders
from crispr_backend.vcf import read_calls

MAX_VCF_BYTES = 20 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    with db.session() as connection:
        app.state.analyzer = Analyzer(connection)  # loads HPO and reference data once (~5 s)
    yield


app = FastAPI(title="Crispr prototype API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("CRISPR_CORS_ORIGINS", "http://localhost:3000").split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class AnalyzeRequest(BaseModel):
    vcf: str = Field(description="Single-sample VCF text on GRCh38", max_length=MAX_VCF_BYTES)
    symptoms: str = Field(default="", max_length=5000)
    sex: Literal["male", "female"] | None = None


def run_order_in_background(order_id: str) -> None:
    with db.session() as connection:
        orders.run_order(connection, app.state.analyzer, order_id)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/diseases")
def diseases() -> list[dict]:
    return [{"omim_id": d.omim_id, "name": d.name, "gene": d.gene, "inheritance": d.inheritance.value} for d in PANEL]


@app.post("/orders", status_code=202)
def create_order(background: BackgroundTasks) -> dict:
    with db.session() as connection:
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
def get_genome(order_id: str) -> Response:
    with db.session() as connection:
        row = connection.execute(
            "SELECT g.vcf_gz FROM orders o JOIN genomes g ON g.id = o.genome_id WHERE o.id = ?", (order_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Order not found")
    return Response(
        gzip.decompress(row["vcf_gz"]),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="crispr-{order_id}.vcf"'},
    )


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
    return app.state.analyzer.analyze(calls, request.symptoms, request.sex)
