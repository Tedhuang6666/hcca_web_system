"""儲存後端單元測試 — LocalStorage round-trip / 驗證 / local_path，S3 presigned disposition。

對應修復：下載/預覽端點改走 storage 抽象（[routers/documents_attachments.py]），
不再寫死讀本機 uploads/ 目錄；本測試鎖住兩種後端的契約以保護 S3 遷移。
"""

from __future__ import annotations

import io

import pytest
from fastapi import UploadFile

from api.services import storage
from api.services.storage import LocalStorageBackend, S3StorageBackend


def _upload(filename: str, content: bytes, content_type: str | None = None) -> UploadFile:
    headers = None
    if content_type is not None:
        from starlette.datastructures import Headers

        headers = Headers({"content-type": content_type})
    return UploadFile(file=io.BytesIO(content), filename=filename, headers=headers)


# ── LocalStorageBackend ──────────────────────────────────────────────────────


async def test_local_save_round_trip(tmp_path):
    backend = LocalStorageBackend(base_dir=str(tmp_path))
    stored = await backend.save(_upload("報告.pdf", b"%PDF-1.4 data"), prefix="doc1")

    assert stored.storage_key.startswith("doc1/")
    assert stored.filename == "報告.pdf"
    assert stored.content_type == "application/pdf"
    assert stored.file_size == len(b"%PDF-1.4 data")
    # 實體檔案應寫入並可由 local_path 取回
    path = backend.local_path(stored.storage_key)
    assert path is not None
    assert path.exists()
    assert path.read_bytes() == b"%PDF-1.4 data"


async def test_local_rejects_disallowed_type(tmp_path):
    backend = LocalStorageBackend(base_dir=str(tmp_path))
    with pytest.raises(ValueError, match="不支援的檔案類型"):
        await backend.save(_upload("evil.exe", b"MZ...", content_type="application/x-msdownload"))


async def test_local_rejects_oversized(tmp_path):
    backend = LocalStorageBackend(base_dir=str(tmp_path))
    big = b"x" * (storage.MAX_FILE_SIZE + 1)
    with pytest.raises(ValueError, match="超過最大限制"):
        await backend.save(_upload("big.pdf", big))


async def test_local_delete_removes_file(tmp_path):
    backend = LocalStorageBackend(base_dir=str(tmp_path))
    stored = await backend.save(_upload("a.png", b"\x89PNG data", content_type="image/png"))
    path = backend.local_path(stored.storage_key)
    assert path is not None and path.exists()
    await backend.delete(stored.storage_key)
    assert not path.exists()


async def test_local_get_url_ignores_disposition(tmp_path):
    """本機後端的 get_url 不使用 disposition/download_name，回傳靜態路徑。"""
    backend = LocalStorageBackend(base_dir=str(tmp_path))
    url = await backend.get_url("doc1/abc.pdf", disposition="attachment", download_name="x.pdf")
    assert url == "/uploads/doc1/abc.pdf"


async def test_local_path_points_under_base(tmp_path):
    backend = LocalStorageBackend(base_dir=str(tmp_path))
    path = backend.local_path("doc1/abc.pdf")
    assert path is not None
    assert str(path).startswith(str(tmp_path))


# ── S3StorageBackend ─────────────────────────────────────────────────────────


class _FakeS3Client:
    """記錄 generate_presigned_url 收到的參數，避免真打 AWS。"""

    def __init__(self) -> None:
        self.last_params: dict | None = None

    def generate_presigned_url(self, op, Params, ExpiresIn):  # noqa: N803
        self.last_params = Params
        return f"https://s3.example/{Params['Key']}?sig=x&expires={ExpiresIn}"


def _s3_backend_with_fake_client() -> tuple[S3StorageBackend, _FakeS3Client]:
    backend = object.__new__(S3StorageBackend)  # 跳過 __init__（不需 boto3 連線）
    backend._bucket = "test-bucket"  # type: ignore[attr-defined]
    backend._region = "ap-northeast-1"  # type: ignore[attr-defined]
    fake = _FakeS3Client()
    backend._client = fake  # type: ignore[attr-defined]
    return backend, fake


async def test_s3_local_path_is_none():
    """遠端後端不提供本機路徑，下載端點應改走重導向。"""
    backend, _ = _s3_backend_with_fake_client()
    assert backend.local_path("doc1/abc.pdf") is None


async def test_s3_get_url_plain():
    backend, fake = _s3_backend_with_fake_client()
    url = await backend.get_url("doc1/abc.pdf")
    assert url.startswith("https://s3.example/doc1/abc.pdf")
    assert "ResponseContentDisposition" not in (fake.last_params or {})


async def test_s3_get_url_attachment_sets_disposition():
    backend, fake = _s3_backend_with_fake_client()
    await backend.get_url("doc1/abc.pdf", disposition="attachment", download_name="報告.pdf")
    assert fake.last_params is not None
    cd = fake.last_params["ResponseContentDisposition"]
    assert cd.startswith("attachment;")
    # 非 ASCII 檔名以 RFC5987 編碼
    assert "filename*=UTF-8''" in cd
    assert "%E5" in cd  # 「報」的 UTF-8 百分號編碼起始位元組


async def test_s3_get_url_inline_disposition():
    backend, fake = _s3_backend_with_fake_client()
    await backend.get_url("doc1/abc.pdf", disposition="inline")
    assert fake.last_params["ResponseContentDisposition"] == "inline"
