"""HTTP front end for the CRISPRon ensemble. Standard library only (runs on Python 3.8).

POST /score {"contexts": ["<30-mer>", ...]} -> {"predictions": [{"efficiency", "models", "energy"}, ..]}
    (efficiency: ensemble-mean predicted indel %; models: each model's own value; energy: CRISPRoff terms)
GET  /health
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, List, Optional

from .encoding import validate

MAX_BATCH = 256
Scorer = Callable[[List[str]], List[dict]]  # per guide: efficiency, models, energy


def make_handler(scorer: Scorer):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            self._send(200, {"status": "ok"}) if self.path == "/health" else self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/score":
                return self._send(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                contexts = json.loads(self.rfile.read(length))["contexts"]
                if not isinstance(contexts, list) or not 0 < len(contexts) <= MAX_BATCH:
                    raise ValueError("contexts must be a list of 1-%d sequences" % MAX_BATCH)
                contexts = [validate(c) for c in contexts]
            except (ValueError, KeyError, TypeError) as error:
                return self._send(400, {"error": str(error)})
            predictions = [
                {
                    "efficiency": round(p["efficiency"], 2),
                    "models": {name: round(v, 2) for name, v in p["models"].items()},
                    "energy": {name: round(v, 3) for name, v in p["energy"].items()},
                }
                for p in scorer(contexts)
            ]
            self._send(200, {"predictions": predictions})

        def log_message(self, format, *args) -> None:  # noqa: A002  # request lines carry no secrets, but keep the console quiet
            pass

    return Handler


def main(scorer: Optional[Scorer] = None) -> None:
    if scorer is None:
        from .model import Ensemble, find_model_dirs

        scorer = Ensemble(find_model_dirs()).predict
    port = int(os.environ.get("PORT", "8001"))
    # Loopback by default: the scorer has no authentication. Set SCORER_HOST=0.0.0.0 only in an isolated container network.
    host = os.environ.get("SCORER_HOST", "127.0.0.1")
    ThreadingHTTPServer((host, port), make_handler(scorer)).serve_forever()


if __name__ == "__main__":
    main()
