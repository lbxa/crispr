"""Atomic reservations, job claims and lease fencing in a separate SQLite store.

No genome bytes, raw filenames or bearer tokens are persisted in this database.
Every write opens its own short transaction; expensive file work stays outside it.
"""

import hashlib
import hmac
import json
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Literal

from crispr_backend.uploads.settings import UploadSettings

UploadFormat = Literal["vcf", "vcf_gzip"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    source_key TEXT,
    format TEXT NOT NULL CHECK (format IN ('vcf', 'vcf_gzip')),
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    status TEXT NOT NULL CHECK (status IN ('uploading','queued','processing','complete','failed','canceled','expired')),
    tus_created INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_id TEXT,
    lease_until REAL,
    uploaded_bytes INTEGER NOT NULL DEFAULT 0,
    records_scanned INTEGER NOT NULL DEFAULT 0,
    variants_checked INTEGER NOT NULL DEFAULT 0,
    retained_variants INTEGER NOT NULL DEFAULT 0,
    uncompressed_bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT,
    report_json TEXT,
    error_code TEXT,
    error_message TEXT,
    retryable INTEGER NOT NULL DEFAULT 0,
    purged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS uploads_next_job ON uploads(status, created_at);
"""


class UploadError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, *, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable


def timestamp(value: float) -> str:
    return datetime.fromtimestamp(value, UTC).isoformat().replace("+00:00", "Z")


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def valid_id(upload_id: str) -> bool:
    return len(upload_id) == 32 and all(character in "0123456789abcdef" for character in upload_id)


class UploadRepository:
    """Owns upload/job state transitions and compare-and-swap lease ownership."""

    def __init__(self, settings: UploadSettings):
        self.settings = settings
        settings.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        settings.files.mkdir(mode=0o700, exist_ok=True)
        with self.connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(SCHEMA)
        with self.connection(write=True) as connection:
            if "source_key" not in {row["name"] for row in connection.execute("PRAGMA table_info(uploads)")}:
                connection.execute("ALTER TABLE uploads ADD COLUMN source_key TEXT")
            connection.execute("CREATE INDEX IF NOT EXISTS uploads_source_created ON uploads(source_key, created_at)")

    @contextmanager
    def connection(self, *, write: bool = False):
        connection = sqlite3.connect(self.settings.database, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            with connection:
                yield connection
        finally:
            connection.close()

    def reserve(
        self, size_bytes: int, format: UploadFormat, *, available_bytes: int, source_key: str | None = None
    ) -> tuple[dict, str]:
        now = time.time()
        capability = secrets.token_urlsafe(32)
        upload_id = uuid.uuid4().hex
        with self.connection(write=True) as connection:
            if source_key is not None:
                source = connection.execute(
                    """SELECT SUM(CASE WHEN purged=0 AND status IN ('uploading','queued','processing') THEN 1 ELSE 0 END) AS active,
                       COALESCE(SUM(CASE WHEN purged=0 THEN size_bytes ELSE 0 END),0) AS reserved,
                       SUM(CASE WHEN created_at>? THEN 1 ELSE 0 END) AS recent
                       FROM uploads WHERE source_key=?""",
                    (now - 60, source_key),
                ).fetchone()
                if source["active"] and source["active"] >= self.settings.max_active_uploads_per_source:
                    raise UploadError(
                        "UPLOAD_SOURCE_CAPACITY",
                        "You already have the maximum number of active uploads.",
                        429,
                        retryable=True,
                    )
                if source["recent"] and source["recent"] >= self.settings.creations_per_minute:
                    raise UploadError(
                        "UPLOAD_SOURCE_RATE",
                        "Too many upload sessions were created. Try again in a minute.",
                        429,
                        retryable=True,
                    )
                if source["reserved"] + size_bytes > self.settings.effective_source_quota_bytes:
                    raise UploadError(
                        "UPLOAD_SOURCE_QUOTA",
                        "Your upload storage allowance is full. Try again after previous files are removed.",
                        429,
                        retryable=True,
                    )
            totals = connection.execute(
                """SELECT COALESCE(SUM(size_bytes),0) AS reserved,
                   SUM(CASE WHEN status IN ('uploading','queued','processing') THEN 1 ELSE 0 END) AS active,
                   COALESCE(SUM(CASE WHEN status='uploading' THEN size_bytes-uploaded_bytes ELSE 0 END),0) AS remaining
                   FROM uploads WHERE purged=0"""
            ).fetchone()
            if totals["active"] and totals["active"] >= self.settings.max_active_uploads:
                raise UploadError(
                    "UPLOAD_CAPACITY",
                    "The analysis server is busy. Try again after another upload finishes.",
                    429,
                    retryable=True,
                )
            if totals["reserved"] + size_bytes > self.settings.quota_bytes:
                raise UploadError(
                    "UPLOAD_QUOTA", "The upload storage quota is full. Try again later.", 507, retryable=True
                )
            if totals["remaining"] + size_bytes + self.settings.disk_reserve_bytes > available_bytes:
                raise UploadError(
                    "UPLOAD_DISK_FULL", "The analysis server has insufficient free storage.", 507, retryable=True
                )
            connection.execute(
                """INSERT INTO uploads (id,token_hash,source_key,format,size_bytes,status,created_at,updated_at,expires_at)
                   VALUES (?, ?, ?, ?, ?, 'uploading', ?, ?, ?)""",
                (
                    upload_id,
                    token_hash(capability),
                    source_key,
                    format,
                    size_bytes,
                    now,
                    now,
                    now + self.settings.reservation_ttl_seconds,
                ),
            )
            row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
        return dict(row), capability

    def get(self, upload_id: str) -> dict | None:
        if not valid_id(upload_id):
            return None
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
        return dict(row) if row else None

    def authenticate(self, token: str, upload_id: str | None = None) -> dict:
        if not token or len(token) > 256:
            raise UploadError("UPLOAD_UNAUTHORIZED", "A valid upload token is required.", 401)
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM uploads WHERE token_hash=?", (token_hash(token),)).fetchone()
        if row is None or not hmac.compare_digest(row["token_hash"], token_hash(token)):
            raise UploadError("UPLOAD_UNAUTHORIZED", "A valid upload token is required.", 401)
        result = dict(row)
        if upload_id is not None and result["id"] != upload_id:
            raise UploadError("UPLOAD_UNAUTHORIZED", "The upload token does not match this upload.", 401)
        return result

    def mark_tus_created(self, upload_id: str) -> None:
        with self.connection(write=True) as connection:
            changed = connection.execute(
                "UPDATE uploads SET tus_created=1,updated_at=? WHERE id=? AND status='uploading' AND tus_created=0 AND expires_at>?",
                (time.time(), upload_id, time.time()),
            ).rowcount
            if not changed:
                raise UploadError(
                    "UPLOAD_ALREADY_CREATED", "This upload already has a resumable file. Resume its existing URL.", 409
                )

    def record_uploaded_bytes(self, upload_id: str, uploaded_bytes: int) -> dict:
        with self.connection(write=True) as connection:
            row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
            if uploaded_bytes < 0 or uploaded_bytes > row["size_bytes"]:
                raise UploadError("UPLOAD_INVALID_STORAGE", "The stored upload exceeds its reserved size.", 422)
            connection.execute(
                """UPDATE uploads SET uploaded_bytes=MAX(uploaded_bytes,?),updated_at=?,expires_at=?
                   WHERE id=? AND status='uploading' AND uploaded_bytes<?""",
                (uploaded_bytes, time.time(), time.time() + self.settings.retention_seconds, upload_id, uploaded_bytes),
            )
            row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
        return dict(row)

    def enqueue_completed_upload(self, upload_id: str) -> dict:
        now = time.time()
        with self.connection(write=True) as connection:
            connection.execute(
                """UPDATE uploads SET status='queued',uploaded_bytes=size_bytes,updated_at=?,expires_at=?
                   WHERE id=? AND status='uploading' AND expires_at>?""",
                (now, now + self.settings.retention_seconds, upload_id, now),
            )
            row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
        return dict(row)

    def retry_failed(self, upload_id: str) -> dict:
        now = time.time()
        with self.connection(write=True) as connection:
            row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
            if not self.require_retryable(dict(row)):
                return dict(row)
            connection.execute(
                """UPDATE uploads SET status='queued',error_code=NULL,error_message=NULL,retryable=0,
                   records_scanned=0,variants_checked=0,retained_variants=0,uncompressed_bytes=0,
                   updated_at=?,expires_at=? WHERE id=?""",
                (now, now + self.settings.retention_seconds, upload_id),
            )
            return dict(connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone())

    def require_retryable(self, session: dict) -> bool:
        """Classify an explicit retry before file I/O, then recheck in its transaction."""
        if session["expires_at"] <= time.time():
            raise UploadError("UPLOAD_EXPIRED", "This upload has expired. Upload the file again.", 410)
        if session["status"] in ("queued", "processing", "complete"):
            return False
        if (
            session["status"] != "failed"
            or not session["retryable"]
            or session["attempts"] >= self.settings.max_attempts
        ):
            raise UploadError(
                "UPLOAD_NOT_RETRYABLE", "This analysis cannot be retried. Select another genome file.", 409
            )
        return True

    def cancel(self, upload_id: str) -> dict:
        now = time.time()
        with self.connection(write=True) as connection:
            connection.execute(
                """UPDATE uploads SET status='canceled',report_json=NULL,updated_at=?,expires_at=?,
                   error_code=NULL,error_message=NULL,retryable=0
                   WHERE id=? AND status IN ('uploading','queued','processing')""",
                (now, now + self.settings.retention_seconds, upload_id),
            )
            return dict(connection.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone())

    def claim_next_job(self) -> dict | None:
        now = time.time()
        with self.connection(write=True) as connection:
            # The singleton worker lease is global, including a prior process after restart.
            if connection.execute("SELECT 1 FROM uploads WHERE lease_until>? LIMIT 1", (now,)).fetchone():
                return None
            connection.execute(
                """UPDATE uploads SET status='queued',lease_id=NULL,lease_until=NULL,updated_at=?
                   WHERE status='processing' AND lease_until<=? AND attempts<?""",
                (now, now, self.settings.max_attempts),
            )
            connection.execute(
                """UPDATE uploads SET status='failed',lease_id=NULL,lease_until=NULL,error_code='WORKER_INTERRUPTED',
                   error_message='Analysis was interrupted repeatedly. Upload the file again.',retryable=0,updated_at=?
                   WHERE status='processing' AND lease_until<=? AND attempts>=?""",
                (now, now, self.settings.max_attempts),
            )
            connection.execute(
                """UPDATE uploads SET status='failed',error_code='WORKER_INTERRUPTED',
                   error_message='Analysis was interrupted repeatedly. Upload the file again.',retryable=0,updated_at=?
                   WHERE status='queued' AND attempts>=?""",
                (now, self.settings.max_attempts),
            )
            row = connection.execute(
                "SELECT * FROM uploads WHERE status='queued' AND expires_at>? AND attempts<? ORDER BY created_at LIMIT 1",
                (now, self.settings.max_attempts),
            ).fetchone()
            if row is None:
                return None
            lease_id = uuid.uuid4().hex
            connection.execute(
                """UPDATE uploads SET status='processing',attempts=attempts+1,lease_id=?,lease_until=?,updated_at=?,
                   records_scanned=0,variants_checked=0,retained_variants=0,uncompressed_bytes=0
                   WHERE id=? AND status='queued'""",
                (lease_id, now + self.settings.lease_seconds, now, row["id"]),
            )
            return dict(connection.execute("SELECT * FROM uploads WHERE id=?", (row["id"],)).fetchone())

    def heartbeat(self, upload_id: str, lease_id: str, progress: dict[str, int]) -> bool:
        now = time.time()
        with self.connection(write=True) as connection:
            return bool(
                connection.execute(
                    """UPDATE uploads SET lease_until=?,updated_at=?,records_scanned=?,variants_checked=?,
                   retained_variants=?,uncompressed_bytes=? WHERE id=? AND status='processing' AND lease_id=? AND lease_until>?""",
                    (
                        now + self.settings.lease_seconds,
                        now,
                        progress["records_scanned"],
                        progress["variants_checked"],
                        progress["retained_variants"],
                        progress["uncompressed_bytes"],
                        upload_id,
                        lease_id,
                        now,
                    ),
                ).rowcount
            )

    def finish(
        self,
        upload_id: str,
        lease_id: str,
        *,
        report: dict | None = None,
        sha256: str | None = None,
        error: UploadError | None = None,
    ) -> bool:
        now = time.time()
        with self.connection(write=True) as connection:
            return bool(
                connection.execute(
                    """UPDATE uploads SET status=?,report_json=?,sha256=?,error_code=?,error_message=?,retryable=?,
                   lease_id=NULL,lease_until=NULL,updated_at=?,expires_at=?
                   WHERE id=? AND status='processing' AND lease_id=? AND lease_until>?""",
                    (
                        "failed" if error else "complete",
                        json.dumps(report) if report is not None else None,
                        sha256,
                        error.code if error else None,
                        error.message if error else None,
                        int(bool(error and error.retryable)),
                        now,
                        now + self.settings.retention_seconds,
                        upload_id,
                        lease_id,
                        now,
                    ),
                ).rowcount
            )

    def release_interrupted(self, upload_id: str, lease_id: str) -> None:
        with self.connection(write=True) as connection:
            connection.execute(
                """UPDATE uploads SET status=CASE WHEN status='processing' THEN
                   CASE WHEN attempts<? THEN 'queued' ELSE 'failed' END ELSE status END,
                   error_code=CASE WHEN status='processing' AND attempts>=? THEN 'WORKER_INTERRUPTED' ELSE error_code END,
                   error_message=CASE WHEN status='processing' AND attempts>=? THEN
                   'Analysis was interrupted repeatedly. Upload the file again.' ELSE error_message END,
                   retryable=0,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=?""",
                (
                    self.settings.max_attempts,
                    self.settings.max_attempts,
                    self.settings.max_attempts,
                    time.time(),
                    upload_id,
                    lease_id,
                ),
            )

    def expire_and_list_cleanup(self) -> list[dict]:
        now = time.time()
        with self.connection(write=True) as connection:
            connection.execute(
                """UPDATE uploads SET status='expired',report_json=NULL,error_code=NULL,error_message=NULL,
                   retryable=0,updated_at=? WHERE expires_at<=? AND status!='expired'""",
                (now, now),
            )
            rows = connection.execute(
                """SELECT * FROM uploads WHERE status IN ('canceled','expired')
                   AND (purged=0 OR (tus_created=1 AND expires_at+?>?))
                   AND (tus_created=0 OR updated_at<=?)
                   AND (lease_until IS NULL OR lease_until<=?)""",
                (self.settings.retention_seconds, now, now - 60, now),
            ).fetchall()
        return [dict(row) for row in rows]

    def mark_purged(self, upload_id: str) -> None:
        with self.connection(write=True) as connection:
            connection.execute(
                """UPDATE uploads SET purged=1,lease_id=NULL,lease_until=NULL,updated_at=?
                   WHERE id=? AND status IN ('canceled','expired')""",
                (time.time(), upload_id),
            )

    def awaiting_completion(self) -> list[dict]:
        with self.connection() as connection:
            rows = connection.execute("SELECT * FROM uploads WHERE status='uploading' AND tus_created=1").fetchall()
        return [dict(row) for row in rows]
