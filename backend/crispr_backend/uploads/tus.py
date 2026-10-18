"""The tusd filestore boundary; never trusts client offsets or stored paths."""

import json
import os
import stat
from contextlib import contextmanager
from pathlib import Path

import requests

from crispr_backend.uploads.settings import UploadSettings
from crispr_backend.uploads.store import UploadError, valid_id


class TusStore:
    def __init__(self, settings: UploadSettings):
        self.settings = settings

    def path(self, upload_id: str) -> Path:
        if not valid_id(upload_id):
            raise UploadError("UPLOAD_NOT_FOUND", "Upload not found.", 404)
        return self.settings.files / upload_id

    def offset(self, upload_id: str) -> int:
        try:
            file_stat = self.path(upload_id).stat(follow_symlinks=False)
        except FileNotFoundError:
            return 0
        if not stat.S_ISREG(file_stat.st_mode):
            raise UploadError("UPLOAD_INVALID_STORAGE", "The stored upload is not a regular file.", 422)
        return file_stat.st_size

    def verify_complete(self, session: dict) -> Path:
        path = self.path(session["id"])
        try:
            # tusd's .info Offset remains zero; its HEAD handler derives the real
            # offset from stat(data). Size and metadata are persisted in .info.
            descriptor = os.open(path.with_suffix(".info"), os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as stream:
                encoded = stream.read(64 * 1024 + 1)
            if len(encoded) > 64 * 1024:
                raise ValueError("Oversized tus receipt")
            info = json.loads(encoded)
            metadata = info.get("MetaData", {})
            if (
                info.get("ID") != session["id"]
                or type(info.get("Size")) is not int
                or info["Size"] != session["size_bytes"]
                or info.get("SizeIsDeferred", False)
                or not isinstance(metadata, dict)
                or metadata.get("session_id") != session["id"]
                or metadata.get("format") != session["format"]
            ):
                raise ValueError("Invalid tus receipt")
            offset = self.offset(session["id"])
        except FileNotFoundError as error:
            raise UploadError(
                "UPLOAD_INCOMPLETE", "The upload has not finished. Resume the transfer first.", 409
            ) from error
        except (ValueError, TypeError, AttributeError, OSError) as error:
            raise UploadError("UPLOAD_INVALID_STORAGE", "The stored upload receipt is invalid.", 422) from error
        if offset != session["size_bytes"]:
            raise UploadError("UPLOAD_INCOMPLETE", "The upload has not finished. Resume the transfer first.", 409)
        return path

    @contextmanager
    def open_complete(self, session: dict):
        path = self.verify_complete(session)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream:
            if (
                not stat.S_ISREG(os.fstat(stream.fileno()).st_mode)
                or os.fstat(stream.fileno()).st_size != session["size_bytes"]
            ):
                raise UploadError("UPLOAD_INVALID_STORAGE", "The stored upload changed before processing.", 422)
            yield stream

    def terminate(self, upload_id: str) -> bool:
        """Let tusd acquire its file lock before deleting an active transfer.

        Direct unlinking could race a PATCH that recreates the receipt after
        cancellation. A failed termination retains the quota reservation and is
        retried by cleanup; an already absent transfer is naturally idempotent.
        """
        path = self.path(upload_id)
        if not path.exists() and not path.with_suffix(".info").exists():
            return True
        try:
            response = requests.delete(
                f"{self.settings.internal_url}{upload_id}",
                headers={"Tus-Resumable": "1.0.0"},
                timeout=5,
            )
        except requests.RequestException:
            return False
        return response.status_code in (204, 404, 410) and not path.exists() and not path.with_suffix(".info").exists()
