"""公開檔案的字面路徑與實體檔案必須落在同一個授權範圍。"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.routing import Mount

from api.core.uploads_static import PublicUploadsStaticFiles, _is_public_path
from api.routers import site
from api.services.storage import LocalStorageBackend

PUBLIC_PREFIXES = (
    "announcements",
    "merchandise-submissions/templates",
    "shop",
    "surveys",
    "public-site",
)
PRIVATE_PREFIXES = (
    "550e8400-e29b-41d4-a716-446655440000",
    "finance/evidence",
    "petitions/CASE",
    "recommended-vendors/vendor-1",
    "merchandise-submissions/submission-1",
)


@pytest.mark.parametrize("prefix", PUBLIC_PREFIXES)
@pytest.mark.parametrize("suffix", ("../private.pdf", "nested/../../private.pdf"))
def test_public_path_check_rejects_parent_segments(prefix: str, suffix: str) -> None:
    assert not _is_public_path(f"{prefix}/{suffix}")


@pytest.mark.parametrize(
    "path",
    ("/shop/image.jpg", "shop\\image.jpg", "shop//image.jpg", "shop/./image.jpg"),
)
def test_public_path_check_rejects_ambiguous_separators(path: str) -> None:
    assert not _is_public_path(path)


@pytest.mark.parametrize("prefix", PUBLIC_PREFIXES)
@pytest.mark.parametrize("method", ("GET", "HEAD"))
async def test_each_public_prefix_still_serves_media(tmp_path: Path, prefix: str, method: str):
    image = tmp_path / prefix / "image.jpg"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"public image")
    app = Starlette(routes=[Mount("/uploads", PublicUploadsStaticFiles(directory=tmp_path))])

    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        response = await client.request(method, f"/uploads/{prefix}/image.jpg")

    assert response.status_code == 200
    assert response.content == (b"public image" if method == "GET" else b"")


@pytest.mark.parametrize("prefix", PRIVATE_PREFIXES)
async def test_direct_response_rejects_traversal(tmp_path: Path, prefix: str):
    (tmp_path / "shop").mkdir()
    private = tmp_path / prefix / "private.pdf"
    private.parent.mkdir(parents=True)
    private.write_bytes(b"private attachment")
    static = PublicUploadsStaticFiles(directory=tmp_path)

    response = await static.get_response(
        f"shop/../{prefix}/private.pdf", {"type": "http", "method": "GET", "headers": []}
    )

    assert response.status_code == 404


@pytest.mark.parametrize("public_prefix", PUBLIC_PREFIXES)
@pytest.mark.parametrize("private_prefix", PRIVATE_PREFIXES)
@pytest.mark.parametrize("link_kind", ("file", "directory", "prefix"))
async def test_static_public_alias_cannot_serve_private_file(
    tmp_path: Path, public_prefix: str, private_prefix: str, link_kind: str
):
    private = tmp_path / private_prefix / "private.pdf"
    private.parent.mkdir(parents=True)
    private.write_bytes(b"private attachment")
    public = tmp_path / public_prefix
    public.parent.mkdir(parents=True, exist_ok=True)
    if link_kind == "prefix":
        public.symlink_to(private.parent, target_is_directory=True)
        request_path = f"{public_prefix}/private.pdf"
    else:
        public.mkdir()
        link = public / "alias"
        link.symlink_to(private if link_kind == "file" else private.parent)
        request_path = f"{public_prefix}/alias" + (
            "/private.pdf" if link_kind == "directory" else ""
        )
    app = Starlette(routes=[Mount("/uploads", PublicUploadsStaticFiles(directory=tmp_path))])

    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        response = await client.get(f"/uploads/{request_path}", headers={"Range": "bytes=0-6"})

    assert response.status_code == 404
    assert b"private" not in response.content


@pytest.mark.parametrize("link_kind", ("file", "directory", "prefix"))
async def test_public_site_image_cannot_follow_private_alias(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, link_kind: str
):
    private = tmp_path / "private" / "secret.jpg"
    private.parent.mkdir()
    private.write_bytes(b"private image")
    public = tmp_path / "public-site"
    if link_kind == "prefix":
        public.symlink_to(private.parent, target_is_directory=True)
        key = "public-site/secret.jpg"
    else:
        public.mkdir()
        alias = public / "alias.jpg"
        alias.symlink_to(private if link_kind == "file" else private.parent)
        key = "public-site/alias.jpg" + ("/secret.jpg" if link_kind == "directory" else "")
    monkeypatch.setattr(site, "get_storage", lambda: LocalStorageBackend(str(tmp_path)))
    app = FastAPI()
    app.include_router(site.router)

    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        response = await client.get(f"/site/public/images/{key}")

    assert response.status_code == 404
    assert b"private image" not in response.content


async def test_public_site_image_still_serves_stored_image(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    image = tmp_path / "public-site" / "image.jpg"
    image.parent.mkdir()
    image.write_bytes(b"public image")
    monkeypatch.setattr(site, "get_storage", lambda: LocalStorageBackend(str(tmp_path)))
    app = FastAPI()
    app.include_router(site.router)

    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        response = await client.get("/site/public/images/public-site/image.jpg")

    assert response.status_code == 200
    assert response.content == b"public image"
    assert response.headers["content-type"] == "image/jpeg"


async def test_storage_root_can_itself_be_a_symlink(tmp_path: Path):
    actual = tmp_path / "actual"
    actual.mkdir()
    (actual / "image.jpg").write_bytes(b"public image")
    root = tmp_path / "uploads"
    root.symlink_to(actual, target_is_directory=True)

    storage = LocalStorageBackend(str(root))

    assert await storage.read_bytes("image.jpg") == b"public image"


async def test_local_storage_cannot_read_another_key_through_alias(tmp_path: Path):
    private = tmp_path / "private.pdf"
    private.write_bytes(b"private attachment")
    (tmp_path / "alias.pdf").symlink_to(private)
    storage = LocalStorageBackend(str(tmp_path))

    assert storage.local_path("alias.pdf") is None
    with pytest.raises(FileNotFoundError):
        await storage.read_bytes("alias.pdf")
