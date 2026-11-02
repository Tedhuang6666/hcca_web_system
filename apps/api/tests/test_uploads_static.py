import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.routing import Mount

from api.core.uploads_static import PublicUploadsStaticFiles, _is_public_path


def test_shop_media_is_publicly_embeddable() -> None:
    assert _is_public_path("shop/product.jpg")


def test_private_upload_prefixes_are_not_public() -> None:
    assert not _is_public_path("550e8400-e29b-41d4-a716-446655440000/private.pdf")


@pytest.fixture
def uploads_app(tmp_path) -> Starlette:
    uploads = tmp_path / "uploads"
    public_dir = uploads / "announcements"
    public_dir.mkdir(parents=True)
    (public_dir / "public.jpg").write_bytes(b"public image")
    private_dir = uploads / "petitions" / "CASE"
    private_dir.mkdir(parents=True)
    (private_dir / "private.pdf").write_bytes(b"private petition attachment")
    private_vendor_dir = uploads / "recommended-vendors" / "vendor-1"
    private_vendor_dir.mkdir(parents=True)
    (private_vendor_dir / "menu.pdf").write_bytes(b"inactive vendor menu")
    (tmp_path / "outside.pdf").write_bytes(b"outside storage root")
    return Starlette(routes=[Mount("/uploads", PublicUploadsStaticFiles(directory=uploads))])


async def test_public_upload_is_still_accessible(uploads_app) -> None:
    async with AsyncClient(transport=ASGITransport(uploads_app), base_url="http://test") as client:
        response = await client.get("/uploads/announcements/public.jpg")

    assert response.status_code == 200
    assert response.content == b"public image"


@pytest.mark.parametrize(
    "request_path",
    (
        "/uploads/petitions/CASE/private.pdf",
        "/uploads/recommended-vendors/vendor-1/menu.pdf",
        "/uploads/announcements/../petitions/CASE/private.pdf",
        "/uploads/announcements/%2e%2e/petitions/CASE/private.pdf",
        "/uploads/announcements/..%2fpetitions/CASE/private.pdf",
        "/uploads/announcements/%2e%2e%5cpetitions%5cCASE%5cprivate.pdf",
        "/uploads/announcements/%252e%252e/petitions/CASE/private.pdf",
        "/uploads/announcements/../../outside.pdf",
        "/uploads/announcements/%2e%2e/%2e%2e/outside.pdf",
    ),
)
async def test_public_upload_route_rejects_traversal(uploads_app, request_path) -> None:
    async with AsyncClient(transport=ASGITransport(uploads_app), base_url="http://test") as client:
        response = await client.get(request_path)

    assert response.status_code == 404
    assert b"private petition attachment" not in response.content
    assert b"inactive vendor menu" not in response.content
    assert b"outside storage root" not in response.content
