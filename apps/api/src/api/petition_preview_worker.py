"""只供 API 透過共用 Unix socket 呼叫的隔離 Office 預覽服務。"""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import Response

from api.services.petition_preview import (
    MAX_PREVIEW_SOURCE_SIZE,
    OFFICE_EXTENSIONS,
    PetitionPreviewError,
    PetitionPreviewUnavailable,
    convert_office_attachment_locally,
)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_conversion_lock = asyncio.Lock()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/convert")
async def convert(filename: str, request: Request) -> Response:
    """接收附件 bytes，回傳 PDF；服務只綁定容器共用的 Unix socket。"""
    if (
        request.headers.get("content-length", "").isdigit()
        and int(request.headers["content-length"]) > MAX_PREVIEW_SOURCE_SIZE
    ):
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Office 附件超過預覽大小限制",
        )

    content = await request.body()
    if len(content) > MAX_PREVIEW_SOURCE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Office 附件超過預覽大小限制",
        )
    if Path(filename).suffix.lower() not in OFFICE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="不支援此附件格式的預覽",
        )

    try:
        async with _conversion_lock:
            pdf_bytes = await convert_office_attachment_locally(content, filename)
    except PetitionPreviewUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Office 預覽服務目前無法使用",
        ) from exc
    except PetitionPreviewError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
