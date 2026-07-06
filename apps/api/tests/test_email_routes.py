"""電子郵件路由的成功、驗證失敗、權限與批次操作測試。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.email_message import EmailCampaignRecipient, EmailMessage
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User


async def _seed_user(
    db: AsyncSession, email: str, codes: list[str], *, superuser: bool = False
) -> User:
    """建立測試使用者，並透過職位授予指定權限碼。"""
    user = User(
        email=email,
        display_name="測試使用者",
        is_active=True,
        is_verified=True,
        is_superuser=superuser,
    )
    db.add(user)
    await db.flush()
    if codes:
        org = Org(name="測試組織")
        db.add(org)
        await db.flush()
        position = Position(org_id=org.id, name="測試職位")
        db.add(position)
        await db.flush()
        for code in codes:
            db.add(Permission(position_id=position.id, code=code))
        db.add(
            UserPosition(
                user_id=user.id,
                position_id=position.id,
                start_date=date.today(),
                end_date=None,
            )
        )
        await db.flush()
    return user


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


@pytest.mark.asyncio
async def test_create_draft_message_succeeds(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user(db_session, "sender@school.edu", ["email:send"])
    _override_user(user)

    resp = await client.post(
        "/email/messages",
        json={"subject": "測試信件", "action": "draft"},
    )

    assert resp.status_code == 201
    assert resp.json()["status"] == "draft"


@pytest.mark.asyncio
async def test_list_my_drafts_only_returns_current_users_drafts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _seed_user(db_session, "draft-owner@school.edu", ["email:send"])
    other = await _seed_user(db_session, "draft-other@school.edu", ["email:send"])
    db_session.add_all(
        [
            EmailMessage(sender_id=owner.id, subject="我的永久草稿", status="draft"),
            EmailMessage(sender_id=other.id, subject="別人的草稿", status="draft"),
        ]
    )
    await db_session.flush()
    _override_user(owner)

    response = await client.get("/email/drafts")

    assert response.status_code == 200
    assert [item["subject"] for item in response.json()] == ["我的永久草稿"]


@pytest.mark.asyncio
async def test_create_message_without_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.post("/email/messages", json={"subject": "x", "action": "draft"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_message_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "nobody@school.edu", [])
    _override_user(user)

    resp = await client.post("/email/messages", json={"subject": "x", "action": "draft"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_missing_message_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "sender2@school.edu", ["email:send"])
    _override_user(user)

    resp = await client.get(f"/email/messages/{uuid.uuid4()}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_bulk_recipients_without_bulk_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "sender3@school.edu", ["email:send"])
    _override_user(user)

    resp = await client.post(
        "/email/messages",
        json={
            "subject": "群發信",
            "action": "draft",
            "recipients": {"org_ids": [str(uuid.uuid4())]},
        },
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_preview_recipients_resolves_position_members(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    sender = await _seed_user(db_session, "bulk@school.edu", ["email:send_bulk"])
    # sender 的職位即可作為收件目標（sender 本人在任）
    position_id = (
        await db_session.execute(
            select(UserPosition.position_id).where(UserPosition.user_id == sender.id)
        )
    ).scalar_one()
    _override_user(sender)

    resp = await client.post(
        "/email/preview-recipients",
        json={"position_ids": [str(position_id)]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["recipient_count"] == 1
    assert "測試使用者" in body["sample_names"]


@pytest.mark.asyncio
async def test_external_email_recipients_can_be_previewed_and_saved(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _seed_user(db_session, "external-sender@school.edu", ["email:send"])
    _override_user(user)
    monkeypatch.setattr("api.routers.email.enqueue_rendered", lambda *args, **kwargs: ["task-id"])

    preview_resp = await client.post(
        "/email/preview-recipients",
        json={"external_emails": ["outsider@example.org", "OUTSIDER@example.org"]},
    )
    assert preview_resp.status_code == 200
    assert preview_resp.json()["recipient_count"] == 1

    create_resp = await client.post(
        "/email/messages",
        json={
            "subject": "外部通知",
            "action": "draft",
            "recipients": {"external_emails": ["outsider@example.org"]},
        },
    )
    assert create_resp.status_code == 201

    message_id = uuid.UUID(create_resp.json()["id"])
    message = await db_session.get(EmailMessage, message_id)
    assert message is not None
    assert message.recipient_spec["external_emails"] == ["outsider@example.org"]

    send_resp = await client.post(
        "/email/messages",
        json={
            "subject": "外部即時通知",
            "action": "send",
            "recipients": {"external_emails": ["outside-now@example.org"]},
        },
    )
    assert send_resp.status_code == 201
    assert send_resp.json()["status"] == "queued"

    recipient = (
        await db_session.execute(
            select(EmailCampaignRecipient).where(
                EmailCampaignRecipient.email == "outside-now@example.org"
            )
        )
    ).scalar_one()
    assert recipient.user_id is None


@pytest.mark.asyncio
async def test_send_commits_recipient_before_enqueue(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _seed_user(db_session, "commit-before-send@school.edu", ["email:send"])
    _override_user(user)
    enqueue_transaction_states: list[bool] = []

    def fake_enqueue(*args, **kwargs) -> list[str]:
        enqueue_transaction_states.append(db_session.in_transaction())
        return ["task-id"]

    monkeypatch.setattr("api.routers.email.enqueue_rendered", fake_enqueue)

    response = await client.post(
        "/email/messages",
        json={
            "subject": "交易順序測試",
            "action": "send",
            "recipients": {"external_emails": ["recipient@example.org"]},
        },
    )

    assert response.status_code == 201
    assert enqueue_transaction_states == [False]


@pytest.mark.asyncio
async def test_test_send_includes_attachments(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _seed_user(db_session, "test-attachment@school.edu", ["email:send"])
    _override_user(user)
    attachment_id = uuid.uuid4()
    captured: list[dict] = []

    async def fake_render_requested(*args, **kwargs):
        return [{"filename": "agenda.pdf", "content": "encoded"}], []

    def fake_enqueue(*args, **kwargs) -> list[str]:
        captured.append(kwargs)
        return ["task-id"]

    monkeypatch.setattr("api.routers.email._render_requested_attachments", fake_render_requested)
    monkeypatch.setattr("api.routers.email.enqueue_rendered", fake_enqueue)

    response = await client.post(
        "/email/test",
        json={
            "subject": "附件測試",
            "attachment_ids": [str(attachment_id)],
        },
    )

    assert response.status_code == 200
    assert captured[0]["attachments"] == [{"filename": "agenda.pdf", "content": "encoded"}]


@pytest.mark.asyncio
async def test_resend_commits_recipient_before_enqueue(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _seed_user(db_session, "commit-before-resend@school.edu", ["email:send"])
    message = EmailMessage(
        sender_id=user.id,
        subject="重新寄送交易順序",
        body="內容",
        status="queued",
        recipient_count=1,
    )
    db_session.add(message)
    await db_session.flush()
    db_session.add(
        EmailCampaignRecipient(
            message_id=message.id,
            email="retry@example.org",
            status="queued",
        )
    )
    await db_session.commit()
    _override_user(user)
    enqueue_transaction_states: list[bool] = []

    def fake_enqueue(*args, **kwargs) -> list[str]:
        enqueue_transaction_states.append(db_session.in_transaction())
        return ["retry-task-id"]

    monkeypatch.setattr("api.routers.email.enqueue_rendered", fake_enqueue)

    response = await client.post(f"/email/messages/{message.id}/resend")

    assert response.status_code == 200
    assert enqueue_transaction_states == [False]


@pytest.mark.asyncio
async def test_recipient_table_overrides_name_and_uses_chinese_placeholder(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    sender = await _seed_user(db_session, "table-sender@school.edu", ["email:send"])
    recipient_user = User(
        email="accepted@school.edu",
        display_name="帳號原姓名",
        is_active=True,
        is_verified=True,
    )
    db_session.add(recipient_user)
    await db_session.flush()
    _override_user(sender)
    monkeypatch.setattr("api.routers.email.enqueue_rendered", lambda *args, **kwargs: ["task-id"])

    response = await client.post(
        "/email/messages",
        json={
            "subject": "{{ user.name }} 錄取通知",
            "body": "您已錄取 {{ 錄取部門 }}。",
            "action": "send",
            "recipients": {"user_ids": [str(recipient_user.id)]},
            "variable_definitions": [{"key": "錄取部門", "label": "錄取部門", "required": True}],
            "recipient_variables": [
                {
                    "email": recipient_user.email,
                    "name": "表格姓名",
                    "variables": {"錄取部門": "活動部"},
                }
            ],
        },
    )

    assert response.status_code == 201
    message_id = response.json()["id"]
    recipient = (
        await db_session.execute(
            select(EmailCampaignRecipient).where(
                EmailCampaignRecipient.email == recipient_user.email
            )
        )
    ).scalar_one()
    assert recipient.name == "表格姓名"
    assert recipient.variables == {"錄取部門": "活動部"}

    preview_response = await client.get(
        f"/email/messages/{message_id}/recipients/{recipient.id}/preview"
    )
    assert preview_response.status_code == 200
    assert "表格姓名 錄取通知" in preview_response.json()["html"]
    assert "您已錄取 活動部。" in preview_response.json()["html"]


@pytest.mark.asyncio
async def test_compose_preview_can_switch_to_specific_recipient(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    sender = await _seed_user(db_session, "preview-sender@school.edu", ["email:send"])
    _override_user(sender)

    response = await client.post(
        "/email/preview",
        json={
            "subject": "{{ user.name }} 的通知",
            "body": "錄取部門：{{ 錄取部門 }}",
            "variable_definitions": [{"key": "錄取部門", "label": "錄取部門", "required": True}],
            "preview_recipient": {
                "email": "specific@example.org",
                "name": "特定使用者",
                "variables": {"錄取部門": "公關部"},
            },
        },
    )

    assert response.status_code == 200
    assert "特定使用者 的通知" in response.json()["html"]
    assert "錄取部門：公關部" in response.json()["html"]


@pytest.mark.asyncio
async def test_compose_preview_allows_incomplete_rows_and_applies_branding(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    sender = await _seed_user(db_session, "branding-preview@school.edu", ["email:send"])
    _override_user(sender)

    response = await client.post(
        "/email/preview",
        json={
            "subject": "錄取通知",
            "body": "錄取部門：{{ 錄取部門 }}",
            "preview_text": "竹嶺班聯40屆幹部正式錄取名單",
            "accent_color": "#2563eb",
            "background_color": "#f1f5f9",
            "content_background_color": "#ffffff",
            "footer_text": "資訊部 敬上",
            "variable_definitions": [{"key": "錄取部門", "label": "錄取部門", "required": True}],
        },
    )

    assert response.status_code == 200
    html = response.json()["html"]
    assert "竹嶺班聯40屆幹部正式錄取名單" in html
    assert "color:#2563eb" in html
    assert "background-color:#f1f5f9" in html
    assert "資訊部 敬上" in html


@pytest.mark.asyncio
async def test_update_message_edits_draft_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "editor@school.edu", ["email:send"])
    message = EmailMessage(sender_id=user.id, subject="原始標題", status="draft")
    db_session.add(message)
    await db_session.flush()
    _override_user(user)

    resp = await client.patch(
        f"/email/messages/{message.id}",
        json={"subject": "更新後標題"},
    )

    assert resp.status_code == 200
    assert resp.json()["subject"] == "更新後標題"


@pytest.mark.asyncio
async def test_update_sent_message_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """已寄出的郵件不可編輯：只有草稿/預約中允許 PATCH，避免竄改已稽核的寄送內容。"""
    user = await _seed_user(db_session, "editor2@school.edu", ["email:send"])
    message = EmailMessage(sender_id=user.id, subject="已寄出", status="sent")
    db_session.add(message)
    await db_session.flush()
    _override_user(user)

    resp = await client.patch(
        f"/email/messages/{message.id}",
        json={"subject": "想改但不行"},
    )

    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_update_message_not_owner_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _seed_user(db_session, "owner@school.edu", ["email:send"])
    intruder = await _seed_user(db_session, "intruder@school.edu", ["email:send"])
    message = EmailMessage(sender_id=owner.id, subject="別人的草稿", status="draft")
    db_session.add(message)
    await db_session.flush()
    _override_user(intruder)

    resp = await client.patch(
        f"/email/messages/{message.id}",
        json={"subject": "偷改"},
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_send_message_endpoint_sends_draft_succeeds(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _seed_user(db_session, "send-endpoint@school.edu", ["email:send"])
    message = EmailMessage(
        sender_id=user.id,
        subject="草稿待寄出",
        body="內容",
        status="draft",
        recipient_spec={"external_emails": ["draft-target@example.org"]},
    )
    db_session.add(message)
    await db_session.flush()
    _override_user(user)
    monkeypatch.setattr("api.routers.email.enqueue_rendered", lambda *args, **kwargs: ["task-id"])

    resp = await client.post(f"/email/messages/{message.id}/send")

    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"


@pytest.mark.asyncio
async def test_send_message_endpoint_on_sent_message_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "send-endpoint2@school.edu", ["email:send"])
    message = EmailMessage(sender_id=user.id, subject="已寄出", status="sent")
    db_session.add(message)
    await db_session.flush()
    _override_user(user)

    resp = await client.post(f"/email/messages/{message.id}/send")

    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_delete_draft_message_removes_it(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "deleter@school.edu", ["email:send"])
    message = EmailMessage(sender_id=user.id, subject="待刪草稿", status="draft")
    db_session.add(message)
    await db_session.flush()
    message_id = message.id
    _override_user(user)

    resp = await client.delete(f"/email/messages/{message_id}")

    assert resp.status_code == 204
    assert await db_session.get(EmailMessage, message_id) is None


@pytest.mark.asyncio
async def test_delete_scheduled_message_cancels_instead_of_removing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "canceler@school.edu", ["email:send"])
    message = EmailMessage(sender_id=user.id, subject="待取消預約", status="scheduled")
    db_session.add(message)
    await db_session.flush()
    message_id = message.id
    _override_user(user)

    resp = await client.delete(f"/email/messages/{message_id}")

    assert resp.status_code == 204
    cancelled = await db_session.get(EmailMessage, message_id)
    assert cancelled is not None
    assert cancelled.status == "cancelled"


@pytest.mark.asyncio
async def test_delete_sent_message_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "cant-delete-sent@school.edu", ["email:send"])
    message = EmailMessage(sender_id=user.id, subject="已寄出", status="sent")
    db_session.add(message)
    await db_session.flush()
    _override_user(user)

    resp = await client.delete(f"/email/messages/{message.id}")

    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_list_messages_filters_by_status_and_keyword(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "lister@school.edu", ["email:send"])
    db_session.add_all(
        [
            EmailMessage(sender_id=user.id, subject="草稿甲", status="draft"),
            EmailMessage(sender_id=user.id, subject="已寄乙", status="sent"),
        ]
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get("/email/messages", params={"status": "draft"})

    assert resp.status_code == 200
    subjects = [item["subject"] for item in resp.json()]
    assert subjects == ["草稿甲"]

    resp_q = await client.get("/email/messages", params={"q": "已寄"})
    assert resp_q.status_code == 200
    assert [item["subject"] for item in resp_q.json()] == ["已寄乙"]


@pytest.mark.asyncio
async def test_list_messages_without_view_logs_only_sees_own(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "own-viewer@school.edu", ["email:send"])
    other = await _seed_user(db_session, "other-sender@school.edu", ["email:send"])
    db_session.add_all(
        [
            EmailMessage(sender_id=user.id, subject="我的信", status="draft"),
            EmailMessage(sender_id=other.id, subject="別人的信", status="draft"),
        ]
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get("/email/messages")

    assert resp.status_code == 200
    assert [item["subject"] for item in resp.json()] == ["我的信"]


@pytest.mark.asyncio
async def test_get_message_detail_includes_recipient_status_counts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "detail-viewer@school.edu", ["email:send"])
    message = EmailMessage(sender_id=user.id, subject="詳情測試", status="sent", recipient_count=1)
    db_session.add(message)
    await db_session.flush()
    db_session.add(
        EmailCampaignRecipient(message_id=message.id, email="a@example.org", status="sent")
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get(f"/email/messages/{message.id}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["recipient_status_counts"] == {"sent": 1}


@pytest.mark.asyncio
async def test_get_message_detail_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _seed_user(db_session, "detail-owner@school.edu", ["email:send"])
    stranger = await _seed_user(db_session, "detail-stranger@school.edu", ["email:send"])
    message = EmailMessage(sender_id=owner.id, subject="他人詳情", status="draft")
    db_session.add(message)
    await db_session.flush()
    _override_user(stranger)

    resp = await client.get(f"/email/messages/{message.id}")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_message_recipients_returns_rows(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "recipients-viewer@school.edu", ["email:send"])
    message = EmailMessage(sender_id=user.id, subject="收件人列表", status="sent")
    db_session.add(message)
    await db_session.flush()
    db_session.add(
        EmailCampaignRecipient(message_id=message.id, email="row@example.org", status="sent")
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get(f"/email/messages/{message.id}/recipients")

    assert resp.status_code == 200
    assert [row["email"] for row in resp.json()] == ["row@example.org"]


@pytest.mark.asyncio
async def test_list_message_recipients_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _seed_user(db_session, "recipients-owner@school.edu", ["email:send"])
    stranger = await _seed_user(db_session, "recipients-stranger@school.edu", ["email:send"])
    message = EmailMessage(sender_id=owner.id, subject="他人收件人", status="sent")
    db_session.add(message)
    await db_session.flush()
    _override_user(stranger)

    resp = await client.get(f"/email/messages/{message.id}/recipients")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_preview_message_recipient_wrong_message_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "preview-mismatch@school.edu", ["email:send"])
    message_a = EmailMessage(sender_id=user.id, subject="信件甲", status="sent")
    message_b = EmailMessage(sender_id=user.id, subject="信件乙", status="sent")
    db_session.add_all([message_a, message_b])
    await db_session.flush()
    recipient = EmailCampaignRecipient(message_id=message_a.id, email="x@example.org")
    db_session.add(recipient)
    await db_session.flush()
    _override_user(user)

    resp = await client.get(f"/email/messages/{message_b.id}/recipients/{recipient.id}/preview")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_upload_email_image_rejects_bad_content_type(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "image-uploader@school.edu", ["email:send"])
    _override_user(user)

    resp = await client.post(
        "/email/images",
        files={"file": ("evil.txt", b"not-an-image", "text/plain")},
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_email_image_succeeds(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    from api.services.storage import LocalStorageBackend

    user = await _seed_user(db_session, "image-uploader2@school.edu", ["email:send"])
    _override_user(user)
    monkeypatch.setattr(
        "api.routers.email.get_storage", lambda: LocalStorageBackend(base_dir=str(tmp_path))
    )

    resp = await client.post(
        "/email/images",
        files={"file": ("logo.png", b"\x89PNG\r\n\x1a\n data", "image/png")},
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["content_type"] == "image/png"
    assert body["url"]


@pytest.mark.asyncio
async def test_test_send_without_email_returns_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "no-email-user@school.edu", ["email:send"])
    user.email = ""
    await db_session.flush()
    _override_user(user)

    resp = await client.post("/email/test", json={"subject": "測試"})

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_test_send_sample_queues_for_selected_rows(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _seed_user(db_session, "sample-tester@school.edu", ["email:send"])
    _override_user(user)
    queued: list[str] = []
    monkeypatch.setattr(
        "api.routers.email.enqueue_rendered",
        lambda destinations, *args, **kwargs: queued.extend(destinations) or ["task-id"],
    )

    resp = await client.post(
        "/email/test-sample",
        json={
            "subject": "抽樣測試",
            "test_emails": ["qa@example.org"],
            "recipient_variables": [
                {"email": "row1@example.org", "name": "第一列", "variables": {}}
            ],
        },
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["queued"] == 1
    assert body["sent_to"] == ["qa@example.org"]
    assert queued == ["qa@example.org"]


@pytest.mark.asyncio
async def test_create_message_schedule_action_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "scheduler@school.edu", ["email:send"])
    _override_user(user)
    future_time = (datetime.now(UTC) + timedelta(days=1)).isoformat()

    resp = await client.post(
        "/email/messages",
        json={"subject": "預約通知", "action": "schedule", "scheduled_at": future_time},
    )

    assert resp.status_code == 201
    assert resp.json()["status"] == "scheduled"


@pytest.mark.asyncio
async def test_create_message_schedule_past_time_returns_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "scheduler2@school.edu", ["email:send"])
    _override_user(user)

    resp = await client.post(
        "/email/messages",
        json={
            "subject": "過去時間",
            "action": "schedule",
            "scheduled_at": "2000-01-01T00:00:00Z",
        },
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_message_idempotency_key_returns_existing_draft(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "idempotent-sender@school.edu", ["email:send"])
    _override_user(user)

    first = await client.post(
        "/email/messages",
        json={"subject": "重複請求", "action": "draft", "idempotency_key": "dup-key-1"},
    )
    assert first.status_code == 201
    second = await client.post(
        "/email/messages",
        json={"subject": "重複請求（應被忽略）", "action": "draft", "idempotency_key": "dup-key-1"},
    )

    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


@pytest.mark.asyncio
async def test_create_message_send_exceeding_daily_quota_returns_429(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _seed_user(db_session, "quota-user@school.edu", ["email:send"])
    _override_user(user)
    monkeypatch.setattr("api.routers.email.settings.EMAIL_DAILY_QUOTA_PER_USER", 1)
    monkeypatch.setattr("api.routers.email.enqueue_rendered", lambda *args, **kwargs: ["task-id"])

    resp = await client.post(
        "/email/messages",
        json={
            "subject": "超過配額",
            "action": "send",
            "recipients": {
                "external_emails": ["over-quota-1@example.org", "over-quota-2@example.org"]
            },
        },
    )

    assert resp.status_code == 429


@pytest.mark.asyncio
async def test_resolve_recipients_include_school_filters_by_domain(
    db_session: AsyncSession,
) -> None:
    from api.services.recipient import resolve_recipients

    school = User(
        email="stu@hchs.hc.edu.tw", display_name="校內生", is_active=True, is_verified=True
    )
    external = User(
        email="admin@gmail.com", display_name="校外管理員", is_active=True, is_verified=True
    )
    db_session.add_all([school, external])
    await db_session.flush()

    _u1, school_emails = await resolve_recipients(db_session, include_school=True)
    assert "stu@hchs.hc.edu.tw" in school_emails
    assert "admin@gmail.com" not in school_emails

    _u2, all_emails = await resolve_recipients(db_session, include_all=True)
    assert "stu@hchs.hc.edu.tw" in all_emails
    assert "admin@gmail.com" in all_emails
