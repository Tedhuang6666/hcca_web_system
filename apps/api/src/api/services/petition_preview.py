"""陳情附件 Office 預覽的 API 端轉檔用戶端。"""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
import tempfile
from pathlib import Path

import httpx

OFFICE_EXTENSIONS = frozenset({".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"})
OFFICE_PREVIEW_TIMEOUT_SECONDS = 30
MAX_PREVIEW_SOURCE_SIZE = 25 * 1024 * 1024
MAX_PREVIEW_PDF_SIZE = 50 * 1024 * 1024
DEFAULT_PREVIEW_SOCKET = "/run/petition-preview/worker.sock"


class PetitionPreviewError(RuntimeError):
    """Office 附件無法轉成 PDF 預覽。"""


class PetitionPreviewUnavailable(PetitionPreviewError):
    """隔離的 Office 預覽服務不存在或暫時無法使用。"""


def _office_extension(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in OFFICE_EXTENSIONS:
        raise PetitionPreviewError("不支援此附件格式的預覽")
    return suffix


async def convert_office_attachment_to_pdf(content: bytes, filename: str) -> bytes:
    """透過僅供容器內使用的 Unix socket 將附件送到隔離轉檔服務。"""
    _office_extension(filename)
    if len(content) > MAX_PREVIEW_SOURCE_SIZE:
        raise PetitionPreviewError("Office 附件超過預覽大小限制，請下載原始檔查看")

    socket_path = os.environ.get("PETITION_PREVIEW_SOCKET", DEFAULT_PREVIEW_SOCKET)
    transport = httpx.AsyncHTTPTransport(uds=socket_path, trust_env=False)
    timeout = httpx.Timeout(
        OFFICE_PREVIEW_TIMEOUT_SECONDS + 5,
        connect=5,
        write=10,
        pool=5,
    )
    try:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://petition-preview",
            timeout=timeout,
        ) as client:
            response = await client.post(
                "/convert",
                params={"filename": Path(filename).name},
                content=content,
            )
    except httpx.TimeoutException as exc:
        raise PetitionPreviewError("Office 附件轉檔逾時，請下載原始檔查看") from exc
    except httpx.HTTPError as exc:
        raise PetitionPreviewUnavailable("Office 預覽服務目前無法使用") from exc

    if response.status_code == 422:
        detail = "Office 附件轉檔失敗，請下載原始檔查看"
        try:
            response_detail = response.json().get("detail")
            if isinstance(response_detail, str) and response_detail:
                detail = response_detail[:200]
        except (ValueError, AttributeError):
            pass
        raise PetitionPreviewError(detail)
    if response.status_code == 413:
        raise PetitionPreviewError("Office 附件超過預覽大小限制，請下載原始檔查看")
    if response.status_code != 200:
        raise PetitionPreviewUnavailable("Office 預覽服務目前無法使用")

    pdf_bytes = response.content
    if not pdf_bytes.startswith(b"%PDF") or len(pdf_bytes) > MAX_PREVIEW_PDF_SIZE:
        raise PetitionPreviewError("Office 附件轉檔結果無效，請下載原始檔查看")
    return pdf_bytes


async def convert_office_attachment_locally(content: bytes, filename: str) -> bytes:
    """只供隔離 worker 呼叫：以明確停用更新與巨集的 UNO 設定進行轉檔。"""
    suffix = _office_extension(filename)
    if len(content) > MAX_PREVIEW_SOURCE_SIZE:
        raise PetitionPreviewError("Office 附件超過預覽大小限制，請下載原始檔查看")

    converter_script = (
        Path(__file__).resolve().parents[3] / "scripts" / "convert_office_attachment.py"
    )
    with tempfile.TemporaryDirectory(prefix="petition-preview-") as temp_name:
        root = Path(temp_name)
        source_path = root / f"source{suffix}"
        output_path = root / "converted.pdf"
        profile_path = root / "profile"
        profile_path.mkdir()
        await asyncio.to_thread(source_path.write_bytes, content)

        try:
            process = await asyncio.create_subprocess_exec(
                "/usr/bin/python3",
                str(converter_script),
                "--input",
                str(source_path),
                "--output",
                str(output_path),
                "--profile",
                str(profile_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            raise PetitionPreviewUnavailable("Office 預覽服務目前無法使用") from exc

        try:
            _stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=OFFICE_PREVIEW_TIMEOUT_SECONDS
            )
        except TimeoutError as exc:
            _kill_process_group(process.pid)
            await process.communicate()
            raise PetitionPreviewError("Office 附件轉檔逾時，請下載原始檔查看") from exc
        except asyncio.CancelledError:
            _kill_process_group(process.pid)
            await process.communicate()
            raise

        if process.returncode != 0 or not output_path.is_file():
            detail = stderr.decode("utf-8", errors="replace").strip()
            message = "Office 附件轉檔失敗，請下載原始檔查看"
            if detail:
                raise PetitionPreviewError(message) from RuntimeError(detail[:500])
            raise PetitionPreviewError(message)

        if output_path.stat().st_size > MAX_PREVIEW_PDF_SIZE:
            raise PetitionPreviewError("Office 附件轉檔結果無效，請下載原始檔查看")
        pdf_bytes = await asyncio.to_thread(output_path.read_bytes)
        if not pdf_bytes.startswith(b"%PDF"):
            raise PetitionPreviewError("Office 附件轉檔結果無效，請下載原始檔查看")
        return pdf_bytes


def _kill_process_group(process_id: int) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process_id, signal.SIGKILL)
