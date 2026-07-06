"""公文附件 router 測試 — 上傳 / 連結 / 列表 / 重新命名 / 刪除 / 下載 / 預覽。"""

from __future__ import annotations

import io
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import Document, DocumentAttachment, DocumentStatus, DocumentVisibility
from api.models.org import Org
from api.models.user import User

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _authed(factory, user: User):
    """回傳已登入且帶有 CSRF token 的 client（authed_client_factory 預設不含 CSRF cookie）。"""
    import secrets

    ac = factory(user)
    token = secrets.token_urlsafe(32)
    ac.cookies.set("csrf_token", token)
    ac._csrf_token = token
    return ac


def _make_doc(org: Org, creator: User, **overrides: object) -> Document:
    defaults: dict = {
        "serial_number": f"DOC-2026-{uuid.uuid4().hex[:8]}",
        "title": "測試公文",
        "org_id": org.id,
        "created_by": creator.id,
        "status": DocumentStatus.DRAFT,
        "subject": "為測試公文附件流程，請 鑒核。",
    }
    defaults.update(overrides)
    return Document(**defaults)


# ── 列表 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_attachments_by_creator_succeeds(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"附件列表組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-list-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    db_session.add(
        DocumentAttachment(
            document_id=doc.id,
            filename="test.pdf",
            storage_key="somewhere/test.pdf",
            content_type="application/pdf",
            uploaded_by=creator.id,
        )
    )
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/attachments")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["url"] == f"/documents/{doc.id}/attachments/{body[0]['id']}/download"


@pytest.mark.asyncio
async def test_list_attachments_without_access_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"附件列表拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-list-creator2@example.com", display_name="Creator", is_active=True)
    stranger = User(email="att-list-stranger2@example.com", display_name="Stranger", is_active=True)
    db_session.add_all([org, creator, stranger])
    await db_session.flush()

    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.SUBJECT_ONLY)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, stranger)
    resp = await ac.get(f"/documents/{doc.id}/attachments")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_attachments_anonymous_public_document_succeeds(
    db_session: AsyncSession, client
) -> None:
    org = Org(name=f"附件匿名組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-list-anon@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.PUBLICLY_OPEN, is_public=True)
    db_session.add(doc)
    await db_session.flush()

    resp = await client.get(f"/documents/{doc.id}/attachments")

    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_list_attachments_anonymous_non_public_returns_404(
    db_session: AsyncSession, client
) -> None:
    org = Org(name=f"附件匿名拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-list-anon2@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.ORG_ONLY)
    db_session.add(doc)
    await db_session.flush()

    resp = await client.get(f"/documents/{doc.id}/attachments")

    assert resp.status_code == 404


# ── 上傳 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upload_attachment_by_creator_succeeds(
    db_session: AsyncSession, authed_client_factory, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "STORAGE_LOCAL_DIR", str(tmp_path))

    org = Org(name=f"上傳組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-upload-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.post(
        f"/documents/{doc.id}/attachments",
        files={"file": ("photo.png", io.BytesIO(_PNG_MAGIC), "image/png")},
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["content_type"] == "image/png"
    assert body["url"] == f"/documents/{doc.id}/attachments/{body['id']}/download"


@pytest.mark.asyncio
async def test_upload_attachment_unsupported_type_returns_422(
    db_session: AsyncSession, authed_client_factory, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "STORAGE_LOCAL_DIR", str(tmp_path))

    org = Org(name=f"上傳拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-upload-creator2@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.post(
        f"/documents/{doc.id}/attachments",
        files={"file": ("evil.exe", io.BytesIO(b"MZ\x00\x00"), "application/x-executable")},
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_attachment_by_non_editor_returns_403(
    db_session: AsyncSession, authed_client_factory, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "STORAGE_LOCAL_DIR", str(tmp_path))

    org = Org(name=f"上傳無權限組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-upload-creator3@example.com", display_name="Creator", is_active=True)
    stranger = User(
        email="att-upload-stranger3@example.com", display_name="Stranger", is_active=True
    )
    db_session.add_all([org, creator, stranger])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, stranger)
    resp = await ac.post(
        f"/documents/{doc.id}/attachments",
        files={"file": ("photo.png", io.BytesIO(_PNG_MAGIC), "image/png")},
    )

    assert resp.status_code == 403


# ── 外部連結附件 ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_link_attachment_by_creator_succeeds(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"連結附件組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-link-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.post(
        f"/documents/{doc.id}/attachments/link",
        json={"url": "https://example.com/doc.pdf", "display_text": "外部檔案"},
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["filename"] == "外部檔案"
    assert body["link_url"] == "https://example.com/doc.pdf"
    assert body["url"] == ""


# ── 刪除 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_attachment_by_uploader_succeeds(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"刪除附件組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-delete-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="link.pdf",
        link_url="https://example.com/a.pdf",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.delete(f"/documents/{doc.id}/attachments/{att.id}")

    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_attachment_by_non_uploader_without_edit_access_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"刪除附件拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-delete-creator2@example.com", display_name="Creator", is_active=True)
    stranger = User(
        email="att-delete-stranger2@example.com", display_name="Stranger", is_active=True
    )
    db_session.add_all([org, creator, stranger])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="link.pdf",
        link_url="https://example.com/a.pdf",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    ac = _authed(authed_client_factory, stranger)
    resp = await ac.delete(f"/documents/{doc.id}/attachments/{att.id}")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_attachment_not_found_returns_404(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"刪除附件找不到組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-delete-creator3@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.delete(f"/documents/{doc.id}/attachments/{uuid.uuid4()}")

    assert resp.status_code == 404


# ── 重新命名 ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rename_attachment_by_creator_succeeds(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"重新命名組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-rename-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="link.pdf",
        link_url="https://example.com/a.pdf",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.patch(
        f"/documents/{doc.id}/attachments/{att.id}",
        json={"filename": "新名稱.pdf"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["display_name"] == "新名稱.pdf"


@pytest.mark.asyncio
async def test_rename_attachment_empty_name_returns_422(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"重新命名空白組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-rename-creator2@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="link.pdf",
        link_url="https://example.com/a.pdf",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.patch(
        f"/documents/{doc.id}/attachments/{att.id}",
        json={"filename": "   "},
    )

    assert resp.status_code == 422


# ── 下載 / 預覽 ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_download_attachment_local_file_succeeds(
    db_session: AsyncSession, authed_client_factory, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "STORAGE_LOCAL_DIR", str(tmp_path))
    (tmp_path / "myfile.png").write_bytes(_PNG_MAGIC)

    org = Org(name=f"下載組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-download-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="myfile.png",
        storage_key="myfile.png",
        content_type="image/png",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/attachments/{att.id}/download")

    assert resp.status_code == 200, resp.text
    assert resp.content == _PNG_MAGIC


@pytest.mark.asyncio
async def test_download_attachment_link_only_returns_400(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"下載連結組織-{uuid.uuid4().hex[:6]}")
    creator = User(
        email="att-download-creator2@example.com", display_name="Creator", is_active=True
    )
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="link.pdf",
        link_url="https://example.com/a.pdf",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/attachments/{att.id}/download")

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_download_attachment_not_found_returns_404(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"下載找不到組織-{uuid.uuid4().hex[:6]}")
    creator = User(
        email="att-download-creator3@example.com", display_name="Creator", is_active=True
    )
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/attachments/{uuid.uuid4()}/download")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_download_attachment_anonymous_public_document_succeeds(
    db_session: AsyncSession, client, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "STORAGE_LOCAL_DIR", str(tmp_path))
    (tmp_path / "public.png").write_bytes(_PNG_MAGIC)

    org = Org(name=f"下載匿名組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-download-anon@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.PUBLICLY_OPEN, is_public=True)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="public.png",
        storage_key="public.png",
        content_type="image/png",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    resp = await client.get(f"/documents/{doc.id}/attachments/{att.id}/download")

    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_preview_attachment_local_file_succeeds(
    db_session: AsyncSession, authed_client_factory, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "STORAGE_LOCAL_DIR", str(tmp_path))
    (tmp_path / "preview.png").write_bytes(_PNG_MAGIC)

    org = Org(name=f"預覽組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-preview-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="preview.png",
        storage_key="preview.png",
        content_type="image/png",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/attachments/{att.id}/preview")

    assert resp.status_code == 200, resp.text
    assert "attachment" not in resp.headers.get("content-disposition", "")


@pytest.mark.asyncio
async def test_preview_attachment_link_only_returns_400(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"預覽連結組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-preview-creator2@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="link.pdf",
        link_url="https://example.com/a.pdf",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/attachments/{att.id}/preview")

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_preview_attachment_without_access_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"預覽無權限組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="att-preview-creator3@example.com", display_name="Creator", is_active=True)
    stranger = User(
        email="att-preview-stranger3@example.com", display_name="Stranger", is_active=True
    )
    db_session.add_all([org, creator, stranger])
    await db_session.flush()

    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.SUBJECT_ONLY)
    db_session.add(doc)
    await db_session.flush()
    att = DocumentAttachment(
        document_id=doc.id,
        filename="link.pdf",
        link_url="https://example.com/a.pdf",
        uploaded_by=creator.id,
    )
    db_session.add(att)
    await db_session.flush()

    ac = _authed(authed_client_factory, stranger)
    resp = await ac.get(f"/documents/{doc.id}/attachments/{att.id}/preview")

    assert resp.status_code == 403
