"""陳情附件的站內 Office 預覽轉換。"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

OFFICE_EXTENSIONS = frozenset({".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"})
OFFICE_PREVIEW_TIMEOUT_SECONDS = 30
MAX_PREVIEW_PDF_SIZE = 50 * 1024 * 1024


class PetitionPreviewError(RuntimeError):
    """Office 附件無法轉成PDF預覽。"""


class PetitionPreviewUnavailable(PetitionPreviewError):
    """本機 Office 轉檔程式不存在或暫時無法使用。"""


async def convert_office_attachment_to_pdf(content: bytes, filename: str) -> bytes:
    """在隔離的暫存目錄中使用 LibreOffice 將 Office 附件轉成 PDF。"""
    suffix = Path(filename).suffix.lower()
    if suffix not in OFFICE_EXTENSIONS:
        raise PetitionPreviewError("不支援此附件格式的預覽")

    with tempfile.TemporaryDirectory(prefix="petition-preview-") as temp_name:
        root = Path(temp_name)
        source_path = root / f"source{suffix}"
        output_dir = root / "converted"
        profile_dir = root / "profile"
        output_dir.mkdir()
        profile_dir.mkdir()
        await asyncio.to_thread(source_path.write_bytes, content)

        try:
            process = await asyncio.create_subprocess_exec(
                "libreoffice",
                "--headless",
                "--nologo",
                "--nodefault",
                "--norestore",
                "--nolockcheck",
                "--nofirststartwizard",
                f"-env:UserInstallation={profile_dir.as_uri()}",
                "--convert-to",
                "pdf",
                "--outdir",
                str(output_dir),
                str(source_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise PetitionPreviewUnavailable("Office 預覽服務目前無法使用") from exc

        try:
            _stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=OFFICE_PREVIEW_TIMEOUT_SECONDS
            )
        except TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise PetitionPreviewError("Office 附件轉檔逾時，請下載原始檔查看") from exc

        output_path = output_dir / "source.pdf"
        if process.returncode != 0 or not output_path.is_file():
            detail = stderr.decode("utf-8", errors="replace").strip()
            message = "Office 附件轉檔失敗，請下載原始檔查看"
            if detail:
                raise PetitionPreviewError(message) from RuntimeError(detail[:500])
            raise PetitionPreviewError(message)

        pdf_bytes = await asyncio.to_thread(output_path.read_bytes)
        if not pdf_bytes.startswith(b"%PDF") or len(pdf_bytes) > MAX_PREVIEW_PDF_SIZE:
            raise PetitionPreviewError("Office 附件轉檔結果無效，請下載原始檔查看")
        return pdf_bytes
