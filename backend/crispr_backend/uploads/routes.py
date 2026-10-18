"""Small HTTP control plane; genome bytes go directly to tusd instead."""

import hashlib
import json
import os
import re
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from crispr_backend.uploads.service import UploadService
from crispr_backend.uploads.store import UploadError

router = APIRouter()


class CreateUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    size_bytes: int = Field(gt=0, strict=True)
    format: Literal["vcf", "vcf_gzip"]


def upload_service(request: Request) -> UploadService:
    return request.app.state.uploads


Service = Annotated[UploadService, Depends(upload_service)]


def bearer(header: str | None) -> str:
    if header is None or not header.startswith("Bearer "):
        raise UploadError("UPLOAD_UNAUTHORIZED", "A valid upload token is required.", 401)
    return header.removeprefix("Bearer ")


def require_origin(origin: str | None) -> None:
    if not origin:
        return  # CLI acceptance clients have no browser origin.
    allowed = [
        value.strip()
        for value in os.environ.get(
            "CRISPR_CORS_ORIGINS",
            "http://localhost:3000,https://genome.lbxa.net",
        ).split(",")
    ]
    pattern = os.environ.get("CRISPR_CORS_ORIGIN_REGEX", r"https://crispr\.[a-z0-9-]+\.workers\.dev")
    if origin not in allowed and not re.fullmatch(pattern, origin):
        raise UploadError("UPLOAD_ORIGIN", "This website is not allowed to use this upload server.", 403)


async def upload_error_response(_request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, UploadError):
        raise error
    return JSONResponse(
        {"error": {"code": error.code, "message": error.message, "retryable": error.retryable}},
        status_code=error.status_code,
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/uploads", status_code=201)
def create_upload(payload: CreateUpload, request: Request, service: Service) -> JSONResponse:
    require_origin(request.headers.get("Origin"))
    # Uvicorn accepts proxy headers only from the loopback Caddy proxy. Never
    # derive identity from arbitrary X-Forwarded-For or Forwarded headers here.
    source_key = hashlib.sha256((request.client.host if request.client else "unknown").encode()).hexdigest()
    return JSONResponse(
        service.create(payload.size_bytes, payload.format, source_key=source_key),
        status_code=201,
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/uploads/{upload_id}")
def get_upload(upload_id: str, request: Request, service: Service) -> JSONResponse:
    session = service.authenticate(bearer(request.headers.get("Authorization")), upload_id)
    return JSONResponse(service.view(session), headers={"Cache-Control": "private, no-store"})


@router.post("/uploads/{upload_id}/complete", status_code=202)
def complete_upload(upload_id: str, request: Request, service: Service) -> JSONResponse:
    session = service.authenticate(bearer(request.headers.get("Authorization")), upload_id)
    return JSONResponse(service.complete(session), status_code=202, headers={"Cache-Control": "private, no-store"})


@router.post("/uploads/{upload_id}/retry", status_code=202)
def retry_upload(upload_id: str, request: Request, service: Service) -> JSONResponse:
    session = service.authenticate(bearer(request.headers.get("Authorization")), upload_id)
    return JSONResponse(service.retry(session), status_code=202, headers={"Cache-Control": "private, no-store"})


@router.delete("/uploads/{upload_id}")
def cancel_upload(upload_id: str, request: Request, service: Service) -> JSONResponse:
    session = service.authenticate(bearer(request.headers.get("Authorization")), upload_id)
    return JSONResponse(service.cancel(session), headers={"Cache-Control": "private, no-store"})


@router.get("/internal/uploads/authorize", include_in_schema=False)
def authorize_tus(request: Request, service: Service) -> Response:
    require_origin(request.headers.get("Origin"))
    method = request.headers.get("X-Forwarded-Method", "").upper()
    if method == "OPTIONS":
        return Response(status_code=204)
    parsed = urlsplit(request.headers.get("X-Forwarded-Uri", ""))
    path = parsed.path
    session = service.authenticate(bearer(request.headers.get("Authorization")))
    if session["status"] == "canceled":
        raise UploadError("UPLOAD_CANCELED", "This upload was canceled.", 410)
    if method == "POST" and path in ("/files", "/files/") and session["status"] == "uploading":
        return Response(status_code=204)
    if path == f"/files/{session['id']}" and (
        method == "HEAD" or method == "PATCH" and session["status"] == "uploading"
    ):
        return Response(status_code=204)
    raise UploadError("UPLOAD_TRANSFER_FORBIDDEN", "This upload request is not allowed.", 403)


class TusFileInfo(BaseModel):
    ID: str = ""
    Size: int = Field(ge=0, strict=True)
    SizeIsDeferred: bool = False
    MetaData: dict[str, str] = Field(default_factory=dict)


class TusHttpRequest(BaseModel):
    Header: dict[str, list[str] | str] = Field(default_factory=dict)


class TusEvent(BaseModel):
    Upload: TusFileInfo
    HTTPRequest: TusHttpRequest


class TusHook(BaseModel):
    Type: Literal["pre-create", "post-finish"]
    Event: TusEvent


def hook_header(headers: dict[str, list[str] | str], name: str) -> str | None:
    value = next((value for key, value in headers.items() if key.lower() == name.lower()), None)
    if isinstance(value, list):
        return value[0] if len(value) == 1 else None
    return value


@router.post("/internal/uploads/tus-hook", include_in_schema=False)
async def tus_hook(request: Request, service: Service) -> JSONResponse:
    try:
        data = bytearray()
        async for part in request.stream():
            data.extend(part)
            if len(data) > 64 * 1024:
                raise UploadError("UPLOAD_HOOK_INVALID", "Invalid upload hook.", 413)
        hook = TusHook.model_validate_json(data)
        upload = hook.Event.Upload
        headers = hook.Event.HTTPRequest.Header
        require_origin(hook_header(headers, "Origin"))
        session = service.authenticate(bearer(hook_header(headers, "Authorization")), upload.MetaData.get("session_id"))
        if (
            upload.SizeIsDeferred
            or upload.Size != session["size_bytes"]
            or upload.MetaData.get("session_id") != session["id"]
            or upload.MetaData.get("format") != session["format"]
        ):
            raise UploadError("UPLOAD_DECLARATION", "The upload declaration does not match its reservation.", 409)
        if hook.Type == "post-finish":
            if upload.ID != session["id"]:
                raise UploadError("UPLOAD_DECLARATION", "The upload ID does not match its reservation.", 409)
            service.complete(session)
            return JSONResponse({})
        if session["status"] != "uploading":
            raise UploadError("UPLOAD_CANCELED", "This upload is no longer active.", 409)
        if (hook_header(headers, "Content-Type") or "").split(";", 1)[
            0
        ].strip().lower() == "application/offset+octet-stream":
            raise UploadError(
                "UPLOAD_CREATION_BODY", "Send genome data using resumable PATCH requests after creation.", 400
            )
        service.repository.mark_tus_created(session["id"])
        return JSONResponse(
            {
                "ChangeFileInfo": {
                    "ID": session["id"],
                    "MetaData": {
                        "session_id": session["id"],
                        "format": session["format"],
                    },
                }
            }
        )
    except (ValidationError, json.JSONDecodeError):
        failure = UploadError("UPLOAD_HOOK_INVALID", "Invalid upload hook.", 422)
        return rejected_hook(failure)
    except UploadError as error:
        return rejected_hook(error)


def rejected_hook(error: UploadError) -> JSONResponse:
    # A hook rejection itself must be HTTP 2xx; tusd applies HTTPResponse to the
    # browser request. Returning 4xx here would instead become a tusd 500.
    return JSONResponse(
        {
            "RejectUpload": True,
            "HTTPResponse": {
                "StatusCode": error.status_code,
                "Body": json.dumps(
                    {"error": {"code": error.code, "message": error.message, "retryable": error.retryable}}
                ),
                "Header": {"Content-Type": "application/json"},
            },
        }
    )
