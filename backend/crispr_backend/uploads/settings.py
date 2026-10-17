"""Upload resource policy and deployment configuration."""

import os
from dataclasses import dataclass
from pathlib import Path

from crispr_backend.db import BACKEND_ROOT


@dataclass(frozen=True)
class UploadSettings:
    directory: Path
    public_url: str = "https://148-100-79-183.sslip.io/files/"
    internal_url: str = "http://127.0.0.1:1080/files/"
    max_upload_bytes: int = 10 * 1024**3
    quota_bytes: int = 40 * 1024**3
    disk_reserve_bytes: int = 2 * 1024**3
    max_active_uploads: int = 4
    max_active_uploads_per_source: int = 2
    creations_per_minute: int = 6
    source_quota_bytes: int | None = None
    chunk_size: int = 8 * 1024**2
    retention_seconds: int = 24 * 60 * 60
    reservation_ttl_seconds: int = 5 * 60
    lease_seconds: int = 120
    max_attempts: int = 3
    worker_poll_seconds: float = 1.0

    def __post_init__(self):
        if (
            min(
                self.max_upload_bytes,
                self.quota_bytes,
                self.max_active_uploads,
                self.max_active_uploads_per_source,
                self.creations_per_minute,
                self.effective_source_quota_bytes,
                self.chunk_size,
                self.retention_seconds,
                self.reservation_ttl_seconds,
                self.lease_seconds,
                self.max_attempts,
            )
            <= 0
            or self.disk_reserve_bytes < 0
            or self.worker_poll_seconds <= 0
        ):
            raise ValueError("Upload limits must be positive")
        if self.max_upload_bytes > self.quota_bytes or self.chunk_size > self.max_upload_bytes:
            raise ValueError("Upload limits exceed their parent quota")
        if not self.public_url.startswith(("https://", "http://")) or not self.public_url.endswith("/files/"):
            raise ValueError("CRISPR_UPLOAD_PUBLIC_URL must be an absolute URL ending in /files/")

    @property
    def files(self) -> Path:
        return self.directory / "files"

    @property
    def database(self) -> Path:
        return self.directory / "jobs.sqlite3"

    @property
    def effective_source_quota_bytes(self) -> int:
        return (
            self.source_quota_bytes
            if self.source_quota_bytes is not None
            else min(self.max_upload_bytes, self.quota_bytes // 2)
        )

    @classmethod
    def from_env(cls):
        return cls(
            directory=Path(os.environ.get("CRISPR_UPLOAD_DIR", str(BACKEND_ROOT / "data" / "uploads"))),
            public_url=os.environ.get("CRISPR_UPLOAD_PUBLIC_URL", "https://148-100-79-183.sslip.io/files/"),
            internal_url=os.environ.get("CRISPR_TUSD_INTERNAL_URL", "http://127.0.0.1:1080/files/"),
            max_upload_bytes=int(os.environ.get("CRISPR_MAX_UPLOAD_BYTES", str(10 * 1024**3))),
            quota_bytes=int(os.environ.get("CRISPR_UPLOAD_QUOTA_BYTES", str(40 * 1024**3))),
            disk_reserve_bytes=int(os.environ.get("CRISPR_UPLOAD_DISK_RESERVE_BYTES", str(2 * 1024**3))),
            max_active_uploads=int(os.environ.get("CRISPR_MAX_ACTIVE_UPLOADS", "4")),
            max_active_uploads_per_source=int(os.environ.get("CRISPR_MAX_ACTIVE_UPLOADS_PER_SOURCE", "2")),
            creations_per_minute=int(os.environ.get("CRISPR_UPLOAD_CREATIONS_PER_MINUTE", "6")),
            source_quota_bytes=int(os.environ["CRISPR_UPLOAD_SOURCE_QUOTA_BYTES"])
            if "CRISPR_UPLOAD_SOURCE_QUOTA_BYTES" in os.environ
            else None,
            retention_seconds=int(os.environ.get("CRISPR_UPLOAD_RETENTION_SECONDS", str(24 * 60 * 60))),
            reservation_ttl_seconds=int(os.environ.get("CRISPR_UPLOAD_RESERVATION_TTL_SECONDS", "300")),
            lease_seconds=int(os.environ.get("CRISPR_UPLOAD_LEASE_SECONDS", "120")),
            max_attempts=int(os.environ.get("CRISPR_UPLOAD_MAX_ATTEMPTS", "3")),
            worker_poll_seconds=float(os.environ.get("CRISPR_UPLOAD_WORKER_POLL_SECONDS", "1")),
        )
