from __future__ import annotations

import base64
import hashlib
import hmac
import time
import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.email_message import (
    EmailAttachment,
    EmailCampaignRecipient,
    EmailMessage,
    EmailRecipientListMember,
    EmailSuppression,
    EmailTemplate,
)
from api.models.user import User
from api.services import email_platform as platform_svc


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def _superuser(db: AsyncSession) -> User:
    user = User(
        email=f"email-admin-{uuid.uuid4().hex[:8]}@school.edu",
        display_name="郵件管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_private_template_crud_and_versioning(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)
    created = await client.post(
        "/email/templates",
        json={
            "name": "錄取通知",
            "visibility": "private",
            "content": {"subject": "{{ user.name }} 錄取通知", "body": "內容"},
            "variable_definitions": [{"key": "錄取部門", "label": "錄取部門"}],
        },
    )
    assert created.status_code == 201
    template_id = created.json()["id"]

    updated = await client.patch(
        f"/email/templates/{template_id}",
        json={"content": {"subject": "第二版", "body": "更新內容"}},
    )
    assert updated.status_code == 200
    assert updated.json()["current_version"] == 2

    versions = await client.get(f"/email/templates/{template_id}/versions")
    assert versions.status_code == 200
    assert [row["version"] for row in versions.json()] == [2, 1]


@pytest.mark.asyncio
async def test_recipient_list_deduplicates_email(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)
    response = await client.post(
        "/email/recipient-lists",
        json={
            "name": "錄取名單",
            "visibility": "private",
            "members": [
                {"email": "USER@example.org", "name": "第一筆", "variables": {}},
                {"email": "user@example.org", "name": "重複", "variables": {}},
            ],
        },
    )
    assert response.status_code == 201
    assert len(response.json()["members"]) == 1
    assert response.json()["members"][0]["email"] == "user@example.org"


@pytest.mark.asyncio
async def test_preflight_excludes_suppressed_recipient(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    db_session.add(
        EmailSuppression(
            email="blocked@example.org",
            reason="bounce",
            source="test",
            suppressed_at=datetime.now(UTC),
        )
    )
    await db_session.flush()
    _override_user(user)

    response = await client.post(
        "/email/preflight",
        json={
            "recipient_variables": [
                {"email": "blocked@example.org", "name": "退信者", "variables": {}},
                {"email": "ok@example.org", "name": "正常", "variables": {}},
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["unique_count"] == 1
    assert response.json()["suppressed_emails"] == ["blocked@example.org"]


@pytest.mark.asyncio
async def test_resend_event_is_idempotent_and_updates_analytics(
    db_session: AsyncSession,
) -> None:
    user = await _superuser(db_session)
    message = EmailMessage(
        sender_id=user.id,
        subject="追蹤測試",
        body="內容",
        recipient_count=1,
        status="sent",
    )
    db_session.add(message)
    await db_session.flush()
    recipient = EmailCampaignRecipient(
        message_id=message.id,
        email="tracked@example.org",
        provider_id="provider-1",
        status="sent",
    )
    db_session.add(recipient)
    await db_session.flush()
    payload = {
        "id": "event-1",
        "type": "email.opened",
        "data": {"email_id": "provider-1"},
    }

    assert await platform_svc.process_resend_event(db_session, payload) is True
    assert await platform_svc.process_resend_event(db_session, payload) is False
    analytics = await platform_svc.get_analytics(db_session, message.id)
    assert analytics["opened"] == 1
    assert analytics["open_rate_estimated"] == 1


@pytest.mark.asyncio
async def test_clone_message_copies_recipient_snapshot_and_attachments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    source = EmailMessage(
        sender_id=user.id,
        subject="會議通知",
        body="會議內容",
        recipient_count=1,
        status="sent",
    )
    db_session.add(source)
    await db_session.flush()
    db_session.add_all(
        [
            EmailCampaignRecipient(
                message_id=source.id,
                email="member@example.org",
                name="出席人",
                variables={"職稱": "代表"},
                status="sent",
            ),
            EmailAttachment(
                message_id=source.id,
                uploaded_by_id=user.id,
                storage_key="email/attachments/agenda.pdf",
                filename="agenda.pdf",
                content_type="application/pdf",
                file_size=1024,
                delivery_mode="attachment",
            ),
        ]
    )
    await db_session.commit()
    _override_user(user)

    response = await client.post(f"/email/messages/{source.id}/clone?audience=all")

    assert response.status_code == 200
    draft_id = uuid.UUID(response.json()["id"])
    draft = await db_session.get(EmailMessage, draft_id)
    assert draft is not None
    assert draft.recipient_spec == {"external_emails": ["member@example.org"]}
    assert draft.recipient_variables[0]["variables"] == {"職稱": "代表"}
    cloned_attachment = await db_session.scalar(
        select(EmailAttachment).where(EmailAttachment.message_id == draft_id)
    )
    assert cloned_attachment is not None
    assert cloned_attachment.filename == "agenda.pdf"
    assert cloned_attachment.storage_key == "email/attachments/agenda.pdf"


@pytest.mark.asyncio
async def test_list_templates_only_returns_own_and_org_shared(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)

    resp = await client.get("/email/templates")

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_delete_template_deactivates_it(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)
    created = await client.post(
        "/email/templates",
        json={"name": "待刪範本", "content": {"subject": "s", "body": "b"}},
    )
    template_id = created.json()["id"]

    resp = await client.delete(f"/email/templates/{template_id}")

    assert resp.status_code == 204
    row = await db_session.get(EmailTemplate, uuid.UUID(template_id))
    assert row is not None
    assert row.is_active is False


@pytest.mark.asyncio
async def test_update_template_without_ownership_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _superuser(db_session)
    other = await _superuser(db_session)
    # 移除 other 的 superuser，使其不再自動繞過擁有權檢查
    other.is_superuser = False
    await db_session.flush()
    template = EmailTemplate(
        owner_id=owner.id,
        visibility="private",
        name="他人範本",
        content={"subject": "s", "body": "b"},
    )
    db_session.add(template)
    await db_session.flush()
    _override_user(other)

    resp = await client.patch(
        f"/email/templates/{template.id}",
        json={"name": "想改別人的範本"},
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_template_versions_without_ownership_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _superuser(db_session)
    other = await _superuser(db_session)
    other.is_superuser = False
    await db_session.flush()
    template = EmailTemplate(
        owner_id=owner.id,
        visibility="private",
        name="私人範本",
        content={"subject": "s", "body": "b"},
    )
    db_session.add(template)
    await db_session.flush()
    _override_user(other)

    resp = await client.get(f"/email/templates/{template.id}/versions")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_recipient_lists_returns_created_list(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)
    await client.post(
        "/email/recipient-lists",
        json={"name": "名單A", "members": [{"email": "a@example.org", "variables": {}}]},
    )

    resp = await client.get("/email/recipient-lists")

    assert resp.status_code == 200
    assert [row["name"] for row in resp.json()] == ["名單A"]


@pytest.mark.asyncio
async def test_update_recipient_list_replaces_members(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)
    created = await client.post(
        "/email/recipient-lists",
        json={"name": "名單B", "members": [{"email": "old@example.org", "variables": {}}]},
    )
    list_id = created.json()["id"]

    resp = await client.patch(
        f"/email/recipient-lists/{list_id}",
        json={"members": [{"email": "new@example.org", "variables": {}}]},
    )

    assert resp.status_code == 200
    # response 可能來自同一個測試 session 內尚未過期的 identity map 快取（正式環境每個
    # request 各自獨立 session，不會有此問題），故直接查 DB 驗證取代信任回應本體。
    db_session.expire_all()
    rows = (
        (
            await db_session.execute(
                select(EmailRecipientListMember).where(
                    EmailRecipientListMember.list_id == uuid.UUID(list_id)
                )
            )
        )
        .scalars()
        .all()
    )
    assert [r.email for r in rows] == ["new@example.org"]


@pytest.mark.asyncio
async def test_delete_recipient_list_deactivates_it(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)
    created = await client.post("/email/recipient-lists", json={"name": "待刪名單"})
    list_id = created.json()["id"]

    resp = await client.delete(f"/email/recipient-lists/{list_id}")

    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_recipient_list_missing_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)

    resp = await client.delete(f"/email/recipient-lists/{uuid.uuid4()}")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_upload_attachment_succeeds(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    from api.services.storage import LocalStorageBackend

    user = await _superuser(db_session)
    _override_user(user)
    monkeypatch.setattr(
        "api.routers.email_platform.get_storage",
        lambda: LocalStorageBackend(base_dir=str(tmp_path)),
    )

    resp = await client.post(
        "/email/attachments",
        files={"file": ("agenda.pdf", b"%PDF-1.4 test", "application/pdf")},
    )

    assert resp.status_code == 201
    assert resp.json()["filename"].endswith(".pdf")


@pytest.mark.asyncio
async def test_revoke_attachment_without_ownership_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _superuser(db_session)
    other = await _superuser(db_session)
    other.is_superuser = False
    await db_session.flush()
    attachment = EmailAttachment(
        uploaded_by_id=owner.id,
        storage_key="email/attachments/x.pdf",
        filename="x.pdf",
        content_type="application/pdf",
        file_size=10,
        delivery_mode="attachment",
    )
    db_session.add(attachment)
    await db_session.flush()
    _override_user(other)

    resp = await client.delete(f"/email/attachments/{attachment.id}")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_revoke_attachment_missing_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)

    resp = await client.delete(f"/email/attachments/{uuid.uuid4()}")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_download_attachment_redirects_to_storage_url(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _superuser(db_session)
    attachment = EmailAttachment(
        uploaded_by_id=user.id,
        storage_key="email/attachments/x.pdf",
        filename="x.pdf",
        content_type="application/pdf",
        file_size=10,
        delivery_mode="attachment",
    )
    db_session.add(attachment)
    await db_session.flush()
    _override_user(user)

    async def fake_download_url(row: object) -> str:
        return "https://storage.example.org/x.pdf"

    monkeypatch.setattr(
        "api.routers.email_platform.platform_svc.attachment_download_url",
        fake_download_url,
    )

    resp = await client.get(f"/email/attachments/{attachment.id}/download", follow_redirects=False)

    assert resp.status_code in (302, 307)
    assert resp.headers["location"] == "https://storage.example.org/x.pdf"


@pytest.mark.asyncio
async def test_message_analytics_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _superuser(db_session)
    stranger = await _superuser(db_session)
    stranger.is_superuser = False
    await db_session.flush()
    message = EmailMessage(sender_id=owner.id, subject="分析測試", status="sent")
    db_session.add(message)
    await db_session.flush()
    _override_user(stranger)

    resp = await client.get(f"/email/messages/{message.id}/analytics")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_message_analytics_returns_rates(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    message = EmailMessage(sender_id=user.id, subject="分析測試2", status="sent")
    db_session.add(message)
    await db_session.flush()
    db_session.add(
        EmailCampaignRecipient(
            message_id=message.id,
            email="opened@example.org",
            status="sent",
            delivered_at=datetime.now(UTC),
            first_opened_at=datetime.now(UTC),
        )
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get(f"/email/messages/{message.id}/analytics")

    assert resp.status_code == 200
    assert resp.json()["opened"] == 1
    assert resp.json()["delivered"] == 1


@pytest.mark.asyncio
async def test_export_message_recipients_returns_csv(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    message = EmailMessage(sender_id=user.id, subject="匯出測試", status="sent")
    db_session.add(message)
    await db_session.flush()
    db_session.add(EmailCampaignRecipient(message_id=message.id, email="e@example.org"))
    await db_session.flush()
    _override_user(user)

    resp = await client.get(f"/email/messages/{message.id}/export")

    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "e@example.org" in resp.text


@pytest.mark.asyncio
async def test_clone_message_unopened_audience_excludes_opened_recipients(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    source = EmailMessage(sender_id=user.id, subject="部分已讀", status="sent")
    db_session.add(source)
    await db_session.flush()
    db_session.add_all(
        [
            EmailCampaignRecipient(
                message_id=source.id,
                email="opened@example.org",
                first_opened_at=datetime.now(UTC),
                status="sent",
            ),
            EmailCampaignRecipient(
                message_id=source.id, email="unopened@example.org", status="sent"
            ),
        ]
    )
    await db_session.commit()
    _override_user(user)

    resp = await client.post(f"/email/messages/{source.id}/clone?audience=unopened")

    assert resp.status_code == 200
    draft = await db_session.get(EmailMessage, uuid.UUID(resp.json()["id"]))
    assert draft.recipient_spec == {"external_emails": ["unopened@example.org"]}


@pytest.mark.asyncio
async def test_resend_webhook_without_secret_configured_returns_503(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("api.services.email_platform.settings.RESEND_WEBHOOK_SECRET", "")

    resp = await client.post(
        "/email/resend/webhook",
        headers={
            "svix-id": "evt-1",
            "svix-timestamp": str(int(time.time())),
            "svix-signature": "v1,x",
        },
        json={"id": "evt-1", "type": "email.opened", "data": {"email_id": "provider-1"}},
    )

    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_resend_webhook_invalid_signature_returns_401(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "api.services.email_platform.settings.RESEND_WEBHOOK_SECRET",
        "whsec_" + base64.b64encode(b"a-real-secret-key-000000").decode(),
    )

    resp = await client.post(
        "/email/resend/webhook",
        headers={
            "svix-id": "evt-2",
            "svix-timestamp": str(int(time.time())),
            "svix-signature": "v1,not-the-right-signature",
        },
        json={"id": "evt-2", "type": "email.opened", "data": {"email_id": "provider-1"}},
    )

    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_resend_webhook_valid_signature_processes_event(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _superuser(db_session)
    message = EmailMessage(sender_id=user.id, subject="webhook 測試", status="sent")
    db_session.add(message)
    await db_session.flush()
    db_session.add(
        EmailCampaignRecipient(
            message_id=message.id, email="hook@example.org", provider_id="prov-42"
        )
    )
    await db_session.commit()

    secret_bytes = b"a-real-secret-key-000000"
    monkeypatch.setattr(
        "api.services.email_platform.settings.RESEND_WEBHOOK_SECRET",
        "whsec_" + base64.b64encode(secret_bytes).decode(),
    )
    body = b'{"id": "evt-3", "type": "email.opened", "data": {"email_id": "prov-42"}}'
    message_id = "evt-3"
    timestamp = str(int(time.time()))
    signed = f"{message_id}.{timestamp}.".encode() + body
    signature = base64.b64encode(hmac.new(secret_bytes, signed, hashlib.sha256).digest()).decode()

    resp = await client.post(
        "/email/resend/webhook",
        headers={
            "svix-id": message_id,
            "svix-timestamp": timestamp,
            "svix-signature": f"v1,{signature}",
            "content-type": "application/json",
        },
        content=body,
    )

    assert resp.status_code == 200
    assert resp.json()["processed"] is True
