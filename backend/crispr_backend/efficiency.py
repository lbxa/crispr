"""Client for the CRISPRon scoring service (TensorFlow 2.4 on s390x, see scoring_service/).

The service runs in IBM's TensorFlow container because the backend's Python (3.12) is newer
than TensorFlow 2.4.1 supports. Set CRISPRON_URL to its address (e.g. http://localhost:8001).
`get_scorer()` returns None when unset, and the scorer returns None when the service errors,
so reports are produced without scores rather than failing.
"""

import os
from collections.abc import Callable
from dataclasses import dataclass

import requests


@dataclass(frozen=True)
class Prediction:
    efficiency: float  # ensemble-mean predicted indel frequency (%)
    models: dict[str, float]  # each ensemble member's own prediction
    energy: dict[str, float]  # CRISPRoff terms; `crisproff_score` is the model's ΔG input


Scorer = Callable[[list[str]], list[Prediction] | None]
TIMEOUT = 30


def get_scorer() -> Scorer | None:
    url = os.environ.get("CRISPRON_URL", "").strip().rstrip("/")
    return _remote_scorer(url) if url else None


def _remote_scorer(url: str) -> Scorer:
    def score(contexts: list[str]) -> list[Prediction] | None:
        try:
            response = requests.post(f"{url}/score", json={"contexts": contexts}, timeout=TIMEOUT)
            response.raise_for_status()
            items = response.json()["predictions"]
            if not isinstance(items, list) or len(items) != len(contexts):
                return None
            return [
                Prediction(
                    float(item["efficiency"]),
                    {str(k): float(v) for k, v in item["models"].items()},
                    {str(k): float(v) for k, v in item["energy"].items()},
                )
                for item in items
            ]
        except (requests.RequestException, KeyError, ValueError, TypeError, AttributeError):
            return None

    return score
