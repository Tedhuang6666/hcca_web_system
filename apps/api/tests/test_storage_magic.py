"""上傳 magic-byte 驗證測試。"""

from __future__ import annotations

import io

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

from api.services.storage import LocalStorageBackend, detect_content_type


def _upload(filename: str, content: bytes, content_type: str | None = None) -> UploadFile:
    headers = Headers({"content-type": content_type}) if content_type else None
    return UploadFile(file=io.BytesIO(content), filename=filename, headers=headers)


def test_detect_matches_real_types() -> None:
    assert detect_content_type(b"%PDF-1.7 ...", "application/pdf") == "application/pdf"
    assert detect_content_type(b"\x89PNG\r\n\x1a\n", "image/png") == "image/png"
    assert detect_content_type(b"\xff\xd8\xff\xe0", "image/jpeg") == "image/jpeg"


def test_detect_rejects_html_disguised_as_png() -> None:
    with pytest.raises(ValueError):
        detect_content_type(b"<html><script>alert(1)</script>", "image/png")


def test_detect_rejects_zip_claiming_image() -> None:
    # docx 容器（PK）但宣稱 image/png → 不符
    with pytest.raises(ValueError):
        detect_content_type(b"PK\x03\x04rest", "image/png")


async def test_save_rejects_polyglot_png(tmp_path) -> None:
    backend = LocalStorageBackend(base_dir=str(tmp_path))
    # 副檔名與宣告型別都偽裝成 png，但內容是 HTML → 應被擋
    with pytest.raises(ValueError):
        await backend.save(_upload("evil.png", b"<svg onload=alert(1)>", content_type="image/png"))


async def test_save_accepts_real_png(tmp_path) -> None:
    backend = LocalStorageBackend(base_dir=str(tmp_path))
    stored = await backend.save(
        _upload("ok.png", b"\x89PNG\r\n\x1a\n\x00real", content_type="image/png")
    )
    assert stored.content_type == "image/png"
