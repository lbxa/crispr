"""Request-level protections shared by the API: allowed origins, rate limits, concurrency caps.

The public API has no accounts, so each expensive route is bounded twice:
- `RateLimiter`: requests per client IP per minute. Uvicorn trusts forwarded headers only
  from the loopback Caddy proxy, so `request.client.host` is the real client address.
- `ConcurrencyCap`: analyses running at once across all clients, because each one can call
  the paid Gemini API or occupy Granite on the 3-vCPU server.
Both answer 429 with Retry-After instead of queueing work.
"""

import os
import re
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

# The production site (workers.dev, Cloudflare preview hosts of the same Worker, and its
# custom domain) plus local development. Override with CRISPR_CORS_ORIGINS / _REGEX.
DEFAULT_ORIGINS = "http://localhost:3000,https://genome.lbxa.net,https://crispr.lbxa.net"
DEFAULT_ORIGIN_REGEX = r"https://(?:[a-z0-9-]+-)?crispr\.lucas-chu-barbosa\.workers\.dev"


def allowed_origins() -> list[str]:
    return [o.strip() for o in os.environ.get("CRISPR_CORS_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()]


def allowed_origin_regex() -> str:
    return os.environ.get("CRISPR_CORS_ORIGIN_REGEX", DEFAULT_ORIGIN_REGEX)


def origin_allowed(origin: str) -> bool:
    return origin in allowed_origins() or re.fullmatch(allowed_origin_regex(), origin) is not None


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class RateLimiter:
    """Sliding one-minute window per client key."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= now - 60:
                hits.popleft()
            if len(hits) >= self.per_minute:
                retry = max(1, int(60 - (now - hits[0])) + 1)
                raise HTTPException(429, "Too many requests; try again shortly.", headers={"Retry-After": str(retry)})
            hits.append(now)
            if len(self._hits) > 10_000:  # forget idle clients so memory stays bounded
                for stale in [k for k, v in self._hits.items() if not v or v[-1] <= now - 60]:
                    del self._hits[stale]


class ConcurrencyCap:
    """At most `limit` holders at once; extra callers are refused rather than queued."""

    def __init__(self, limit: int):
        self._slots = threading.BoundedSemaphore(limit)

    def __enter__(self) -> "ConcurrencyCap":
        if not self._slots.acquire(blocking=False):
            raise HTTPException(429, "The analysis service is busy; try again shortly.", headers={"Retry-After": "10"})
        return self

    def __exit__(self, *_exc: object) -> None:
        self._slots.release()
