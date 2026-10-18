"""Local API for front-end work: synthetic database plus a MOCK CRISPRon scorer.

    .venv/bin/python -m scripts.dev_stack        # API on :8000, mock scorer on :8001
    CRISPRON_URL=http://127.0.0.1:8001 .venv/bin/python -m scripts.dev_stack   # use a real scorer instead

The scorer is a stand-in (a fixed function of GC content and seed composition), not CRISPRon:
it exercises the advisability plumbing and UI without TensorFlow or the model files. Genome 1
is a synthetic fever-syndrome patient; genome 2 is a control. Never deploy this.
"""

import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))

import uvicorn  # noqa: E402
from conftest import populate  # noqa: E402  # pyright: ignore[reportMissingImports]

from scoring_service import server  # noqa: E402

API_PORT = int(os.environ.get("PORT", "8000"))
SCORER_PORT = 8001


def mock_prediction(contexts: list[str]) -> list[dict]:
    """Same response shape as the real service; every value is fabricated."""

    def one(context: str) -> dict:
        spacer = context[4:24]
        gc = (spacer.count("G") + spacer.count("C")) / 20
        seed_gc = (spacer[10:].count("G") + spacer[10:].count("C")) / 10
        efficiency = round(max(5.0, 100 * (0.9 - 2.2 * abs(gc - 0.55) - 0.4 * abs(seed_gc - 0.6))), 2)
        models = {f"mock-{i}": round(efficiency + (i - 3) * 1.5, 2) for i in range(1, 7)}
        energy = {
            "rna_dna": -20.0 - 10 * gc,
            "rna_dna_weighted": -40.0 - 20 * gc,
            "dna_opening": 26.0,
            "spacer_self_fold": -1.5,
            "crisproff_score": 20.0 + 10 * gc,
        }
        return {"efficiency": efficiency, "models": models, "energy": energy}

    return [one(c) for c in contexts]


def main() -> None:
    path = Path(tempfile.mkdtemp(prefix="crispr-dev-")) / "dev.sqlite"
    populate(path)
    os.environ.update(CRISPR_DB=str(path), CRISPR_LLM="none")
    if os.environ.get("CRISPRON_URL"):
        print(f"Using the real scorer at {os.environ['CRISPRON_URL']}; API on :{API_PORT} (database {path})")
    else:
        os.environ["CRISPRON_URL"] = f"http://127.0.0.1:{SCORER_PORT}"
        scorer = ThreadingHTTPServer(("127.0.0.1", SCORER_PORT), server.make_handler(mock_prediction))
        threading.Thread(target=scorer.serve_forever, daemon=True).start()
        print(f"MOCK CRISPRon scorer on :{SCORER_PORT}; API on :{API_PORT} (database {path})")
    uvicorn.run("crispr_backend.api:app", host="127.0.0.1", port=API_PORT, log_level="warning")


if __name__ == "__main__":
    main()
