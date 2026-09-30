from api.core.uploads_static import _is_public_path


def test_shop_media_is_publicly_embeddable() -> None:
    assert _is_public_path("shop/product.jpg")


def test_private_upload_prefixes_are_not_public() -> None:
    assert not _is_public_path("550e8400-e29b-41d4-a716-446655440000/private.pdf")
