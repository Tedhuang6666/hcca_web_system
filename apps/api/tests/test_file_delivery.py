"""已授權檔案傳遞的本機／S3 回應矩陣，不連線到外部儲存。"""

from __future__ import annotations

from urllib.parse import quote

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from httpx import ASGITransport, AsyncClient

from api.core.config import settings
from api.services.file_delivery import deliver_stored_file, presigned_storage_redirect
from api.services.storage import LocalStorageBackend, S3StorageBackend


class _S3Client:
    def __init__(self) -> None:
        self.params = {}

    def generate_presigned_url(self, operation, Params, ExpiresIn):  # noqa: N803
        assert operation == "get_object"
        self.params = Params
        return f"https://hcca-files.s3.ap-northeast-1.amazonaws.com/{Params['Key']}?sig=test"


@pytest.fixture
def s3_storage(monkeypatch):
    monkeypatch.setattr(settings, "S3_BUCKET", "hcca-files")
    monkeypatch.setattr(settings, "S3_REGION", "ap-northeast-1")
    storage = object.__new__(S3StorageBackend)
    storage._bucket = "hcca-files"
    storage._region = "ap-northeast-1"
    client = _S3Client()
    storage._client = client
    return storage, client


@pytest.mark.parametrize("disposition", ["inline", "attachment"])
async def test_local_file_returns_content_chinese_filename_and_domain_headers(
    tmp_path, disposition
):
    storage = LocalStorageBackend(str(tmp_path))
    (tmp_path / "stored.pdf").write_bytes(b"%PDF-file")
    filename = "核准 公文.pdf"
    domain_headers = {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "frame-ancestors 'self'",
        "X-Frame-Options": "SAMEORIGIN",
    }
    app = FastAPI()

    @app.get("/file")
    async def get_file():
        return await deliver_stored_file(
            storage,
            "stored.pdf",
            content_type="application/pdf",
            filename=filename,
            disposition=disposition,
            headers=domain_headers,
        )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/file")

    assert response.status_code == 200
    assert response.content == b"%PDF-file"
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == (
        f"{disposition}; filename*=UTF-8''{quote(filename, safe='')}"
    )
    for key, value in domain_headers.items():
        assert response.headers[key] == value


@pytest.mark.parametrize("directory", [False, True])
async def test_missing_or_nonfile_local_path_uses_domain_404(tmp_path, directory):
    storage = LocalStorageBackend(str(tmp_path))
    if directory:
        (tmp_path / "missing.pdf").mkdir()

    with pytest.raises(HTTPException) as error:
        await deliver_stored_file(storage, "missing.pdf", missing_detail="附件檔案不存在")

    assert error.value.status_code == 404
    assert error.value.detail == "附件檔案不存在"


@pytest.mark.parametrize("disposition", ["inline", "attachment"])
async def test_remote_file_signs_disposition_and_preserves_domain_headers(s3_storage, disposition):
    storage, client = s3_storage
    response = await deliver_stored_file(
        storage,
        "documents/stored.pdf",
        filename="核准公文.pdf",
        disposition=disposition,
        headers={"Cache-Control": "private, no-store", "X-Frame-Options": "SAMEORIGIN"},
    )

    assert isinstance(response, RedirectResponse)
    assert response.status_code == 307
    assert response.headers["location"] == (
        "https://hcca-files.s3.ap-northeast-1.amazonaws.com/"
        "documents/stored.pdf?sig=test"
    )
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-frame-options"] == "SAMEORIGIN"
    assert client.params["ResponseContentDisposition"] == (
        f"{disposition}; filename*=UTF-8''{quote('核准公文.pdf')}"
    )


async def test_immutable_file_cache_is_not_applied_to_presigned_redirect(tmp_path, s3_storage):
    storage = LocalStorageBackend(str(tmp_path))
    (tmp_path / "image.png").write_bytes(b"image")
    local_headers = {"Cache-Control": "public, max-age=31536000, immutable"}

    local = await deliver_stored_file(storage, "image.png", local_headers=local_headers)
    remote = await deliver_stored_file(s3_storage[0], "image.png", local_headers=local_headers)

    assert isinstance(local, FileResponse)
    assert local.headers["cache-control"] == local_headers["Cache-Control"]
    assert "cache-control" not in remote.headers


@pytest.mark.parametrize(
    "url",
    [
        "http://hcca-files.s3.ap-northeast-1.amazonaws.com/file.pdf",
        "https://attacker.example/file.pdf",
        "https://hcca-files.s3.ap-northeast-1.amazonaws.com.attacker.example/file.pdf",
        "https://user@hcca-files.s3.ap-northeast-1.amazonaws.com/file.pdf",
        "https://hcca-files.s3.ap-northeast-1.amazonaws.com:8443/file.pdf",
        "https://hcca-files.s3.ap-northeast-1.amazonaws.com:invalid/file.pdf",
        "https://[invalid/file.pdf",
    ],
)
def test_storage_redirect_rejects_untrusted_or_malformed_url(s3_storage, url):
    with pytest.raises(HTTPException) as error:
        presigned_storage_redirect(url)
    assert error.value.status_code == 502


@pytest.mark.parametrize("host", ["hcca-files.s3.amazonaws.com", "s3.amazonaws.com"])
def test_storage_redirect_accepts_us_east_1_hosts(monkeypatch, host):
    monkeypatch.setattr(settings, "S3_BUCKET", "hcca-files")
    monkeypatch.setattr(settings, "S3_REGION", "us-east-1")

    assert presigned_storage_redirect(f"https://{host}/file.pdf").status_code == 307
