"""公文審核決定經不同入口仍具備相同領域結果，使用真實資料庫。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from api.core.config import settings
from api.models.audit_log import AuditLog
from api.models.discord_account import DiscordAccountLink, DiscordGuildConfig
from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    DeliveryMethod,
    Document,
    DocumentApproval,
    DocumentRecipient,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.notification import Notification
from api.models.org import Org
from api.models.outbox import OutboxEvent
from api.schemas.document import RejectMode
from api.services import discord_commands
from api.services import document as document_svc

pytestmark = pytest.mark.asyncio
_ADAPTERS = ["http", "batch", "discord"]


async def _prepare(db_session, make_user):
    creator = await make_user(
        notification_preferences={
            "document_approved": {"inapp": True, "email": False},
            "document_rejected": {"inapp": True, "email": False},
        }
    )
    actor = await make_user(is_superuser=True)
    org = Org(name=f"公文流程-{uuid.uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    doc = Document(
        serial_number=f"DOC-TEST-{uuid.uuid4().hex[:8]}",
        title="跨入口審核測試",
        subject="為測試完整審核決定，請 鑒核。",
        org_id=org.id,
        created_by=creator.id,
        status=DocumentStatus.PENDING,
        current_step=1,
    )
    db_session.add(doc)
    await db_session.flush()
    db_session.add(
        DocumentApproval(
            document_id=doc.id,
            approver_id=actor.id,
            step_order=1,
            status=ApprovalStepStatus.PENDING,
        )
    )
    await db_session.flush()
    return doc, creator, actor


async def _decide(adapter, db_session, authed_client_factory, actor, doc, *, reject_mode=None):
    action = "approve" if reject_mode is None else "reject"
    arguments = {"comment": "審核測試"}
    if reject_mode is not None:
        arguments["mode"] = reject_mode
    if adapter == "discord":
        discord_user_id = uuid.uuid4().hex
        db_session.add(DiscordAccountLink(user_id=actor.id, discord_user_id=discord_user_id))
        await db_session.flush()
        result = await discord_commands.execute(
            db_session,
            operation=f"document_{action}",
            discord_user_id=discord_user_id,
            interaction_id=uuid.uuid4().hex,
            guild_id=None,
            arguments={"document_id": str(doc.id), **arguments},
        )
        assert result == {"title": doc.title}
    else:
        client = authed_client_factory(actor)
        path = f"/documents/{doc.id}/{action}"
        if adapter == "batch":
            path = f"/documents/batch/{action}"
            arguments["document_ids"] = [str(doc.id)]
        response = await client.post(path, json=arguments)
        assert response.status_code == 200, response.text
        if adapter == "batch":
            assert response.json()["succeeded"] == 1
        else:
            # 完整 HTTP 序列化也必須能取得審核人／代理關聯。
            assert response.json()["approvals"]


@pytest.mark.parametrize("adapter", _ADAPTERS)
async def test_final_approval_sends_official_delivery_and_required_notices(
    adapter, db_session, make_user, authed_client_factory, monkeypatch
):
    doc, creator, actor = await _prepare(db_session, make_user)
    doc.visibility_level = DocumentVisibility.PUBLICLY_OPEN
    doc.is_public = True
    db_session.add(
        DocumentRecipient(
            document_id=doc.id,
            recipient_type="main",
            name="正式受文者",
            email="official-recipient@example.com",
            delivery_method=DeliveryMethod.EMAIL,
        )
    )
    monkeypatch.setattr(settings, "DISCORD_GUILD_ID", "approval-test-guild")
    db_session.add(
        DiscordGuildConfig(
            guild_id="approval-test-guild", announcement_channel_id="approval-test-channel"
        )
    )
    await db_session.flush()

    await _decide(adapter, db_session, authed_client_factory, actor, doc)

    assert doc.status == DocumentStatus.APPROVED
    assert doc.recipient_email_sent_at is not None
    events = list((await db_session.scalars(select(OutboxEvent))).all())
    deliveries = [event for event in events if event.event_type == "email.send"]
    assert len(deliveries) == 1
    assert deliveries[0].payload["to"] == ["official-recipient@example.com"]
    assert any(
        event.event_type == "discord.channel_alert"
        and event.payload["channel_id"] == "approval-test-channel"
        for event in events
    )
    notice = await db_session.scalar(
        select(Notification).where(
            Notification.related_id == doc.id, Notification.type == "document_approved"
        )
    )
    assert notice is not None and notice.user_id == creator.id
    expected_action = {
        "http": "approve",
        "batch": "batch.approve",
        "discord": "discord.document.approve",
    }[adapter]
    audit = await db_session.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == str(doc.id), AuditLog.action == expected_action
        )
    )
    assert audit is not None
    with pytest.raises(ValueError, match="非待審核狀態"):
        await document_svc.approve_document(db_session, doc, approver_id=actor.id)
    assert (
        len(
            list(
                await db_session.scalars(
                    select(OutboxEvent).where(OutboxEvent.event_type == "email.send")
                )
            )
        )
        == 1
    )


@pytest.mark.parametrize("adapter", _ADAPTERS)
async def test_nonfinal_approval_notifies_the_next_delegate(
    adapter, db_session, make_user, authed_client_factory
):
    doc, _creator, actor = await _prepare(db_session, make_user)
    principal = await make_user()
    delegate = await make_user()
    db_session.add(
        DocumentApproval(
            document_id=doc.id,
            approver_id=principal.id,
            delegate_id=delegate.id,
            delegate_source=DelegateSource.MANUAL,
            step_order=2,
            status=ApprovalStepStatus.WAITING,
        )
    )
    await db_session.flush()

    await _decide(adapter, db_session, authed_client_factory, actor, doc)

    assert doc.status == DocumentStatus.PENDING and doc.current_step == 2
    notices = list(
        await db_session.scalars(select(Notification).where(Notification.related_id == doc.id))
    )
    assert [(notice.user_id, notice.type) for notice in notices] == [
        (delegate.id, "document_pending")
    ]
    assert (
        await db_session.scalar(
            select(OutboxEvent.id).where(OutboxEvent.event_type == "email.send")
        )
        is None
    )


@pytest.mark.parametrize("adapter", _ADAPTERS)
@pytest.mark.parametrize("mode", [RejectMode.TO_CREATOR, RejectMode.TO_PREVIOUS])
async def test_rejection_notifies_the_creator_or_previous_delegate(
    adapter, mode, db_session, make_user, authed_client_factory
):
    doc, creator, actor = await _prepare(db_session, make_user)
    delegate = await make_user()
    doc.current_step = 2
    first = await db_session.scalar(
        select(DocumentApproval).where(DocumentApproval.document_id == doc.id)
    )
    first.status = ApprovalStepStatus.APPROVED
    first.delegate_id = delegate.id
    first.delegate_source = DelegateSource.MANUAL
    db_session.add(
        DocumentApproval(
            document_id=doc.id,
            approver_id=actor.id,
            step_order=2,
            status=ApprovalStepStatus.PENDING,
        )
    )
    await db_session.flush()

    await _decide(adapter, db_session, authed_client_factory, actor, doc, reject_mode=mode)

    notices = list(
        await db_session.scalars(select(Notification).where(Notification.related_id == doc.id))
    )
    expected = (
        (creator.id, "document_rejected")
        if mode == RejectMode.TO_CREATOR
        else (delegate.id, "document_pending")
    )
    assert [(notice.user_id, notice.type) for notice in notices] == [expected]
    assert doc.status == (
        DocumentStatus.REJECTED if mode == RejectMode.TO_CREATOR else DocumentStatus.PENDING
    )


async def test_wrong_approver_cannot_trigger_domain_effects(db_session, make_user):
    doc, _creator, _actor = await _prepare(db_session, make_user)
    stranger = await make_user(is_superuser=True)

    with pytest.raises(PermissionError):
        await document_svc.approve_document(db_session, doc, approver_id=stranger.id)

    assert doc.status == DocumentStatus.PENDING
    assert await db_session.scalar(select(Notification.id)) is None
    assert await db_session.scalar(select(OutboxEvent.id)) is None
