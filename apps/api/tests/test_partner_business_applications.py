"""特約商家公開申請與後台審核測試。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.discord_notification_route import DiscordNotificationRoute
from api.models.outbox import OutboxEvent


async def test_public_portal_returns_default_config(client) -> None:
    response = await client.get("/partner-map/applications/portal")

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_accepting"] is True
    assert [field["key"] for field in payload["settings"]["fields"]] == [
        "business_name",
        "contact_name",
        "contact_email",
        "contact_phone",
        "cooperation_summary",
    ]


async def test_public_submission_emits_routed_discord_event(
    client, db_session: AsyncSession
) -> None:
    db_session.add(
        DiscordNotificationRoute(
            guild_id="guild-1",
            event_key="partner_application.submitted",
            module="shop",
            channel_id="partner-applications",
        )
    )
    await db_session.flush()

    response = await client.post(
        "/partner-map/applications",
        json={
            "field_values": {
                "business_name": "晨光咖啡",
                "contact_name": "王小明",
                "contact_email": "hello@example.com",
                "contact_phone": "0912345678",
                "cooperation_summary": "希望提供學生折扣。",
            }
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "pending"
    event = await db_session.scalar(
        select(OutboxEvent).where(OutboxEvent.event_type == "discord.channel_alert")
    )
    assert event is not None
    assert event.payload["channel_id"] == "partner-applications"
    assert event.payload["event_key"] == "partner_application.submitted"


async def test_admin_can_configure_fields_and_review_application(
    client, admin_user, authed_client_factory
) -> None:
    admin_client = authed_client_factory(admin_user)
    field = {
        "key": "business_name",
        "label": "店家名稱",
        "field_type": "text",
        "required": True,
        "placeholder": None,
        "help_text": None,
        "options": [],
        "sort_order": 10,
        "is_active": True,
    }
    update = await admin_client.patch(
        "/partner-map/admin/applications/settings",
        json={
            "title": "合作申請",
            "intro": "請留下合作資料。",
            "fields": [field],
        },
    )
    assert update.status_code == 200

    submitted = await client.post(
        "/partner-map/applications",
        json={"field_values": {"business_name": "測試店家"}},
    )
    assert submitted.status_code == 201
    application_id = submitted.json()["id"]

    review = await admin_client.patch(
        f"/partner-map/admin/applications/{application_id}",
        json={"status": "approved", "review_note": "合作內容已確認"},
    )
    assert review.status_code == 200
    assert review.json()["status"] == "approved"
    assert review.json()["review_note"] == "合作內容已確認"
