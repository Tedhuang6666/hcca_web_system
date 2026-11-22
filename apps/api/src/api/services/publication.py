"""發布中心服務。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.announcement import Announcement, AnnouncementAudience
from api.models.publication import (
    PublicationCampaign,
    PublicationDelivery,
    PublicationDeliveryStatus,
    PublicationStatus,
)
from api.schemas.publication import PublicationCampaignCreate, PublicationCampaignUpdate
from api.services._base import apply_updates
from api.services.outbox import emit


async def list_campaigns(
    db: AsyncSession,
    *,
    activity_id: uuid.UUID | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[PublicationCampaign]:
    stmt = select(PublicationCampaign).order_by(PublicationCampaign.updated_at.desc()).limit(limit)
    if activity_id:
        stmt = stmt.where(PublicationCampaign.activity_id == activity_id)
    if status:
        stmt = stmt.where(PublicationCampaign.status == status)
    return list((await db.execute(stmt)).scalars().all())


async def get_campaign(db: AsyncSession, campaign_id: uuid.UUID) -> PublicationCampaign | None:
    return await db.get(PublicationCampaign, campaign_id)


async def create_campaign(
    db: AsyncSession, data: PublicationCampaignCreate, *, actor_id: uuid.UUID
) -> PublicationCampaign:
    campaign = PublicationCampaign(**data.model_dump(), created_by_id=actor_id)
    db.add(campaign)
    await db.flush()
    await db.refresh(campaign)
    return campaign


async def update_campaign(
    db: AsyncSession, campaign: PublicationCampaign, data: PublicationCampaignUpdate
) -> PublicationCampaign:
    apply_updates(campaign, data)
    await db.flush()
    await db.refresh(campaign)
    return campaign


async def preview(campaign: PublicationCampaign) -> dict:
    channels = {
        channel: {
            "title": campaign.title,
            "body": _render_channel_body(campaign.body, channel),
        }
        for channel in campaign.channels
    }
    return {
        "title": campaign.title,
        "channels": channels,
        "estimated_recipients": 0,
    }


async def send(db: AsyncSession, campaign: PublicationCampaign) -> PublicationCampaign:
    now = datetime.now(UTC)
    for channel in campaign.channels:
        delivery = PublicationDelivery(
            campaign_id=campaign.id,
            channel=channel,
            status=PublicationDeliveryStatus.QUEUED.value,
        )
        db.add(delivery)
        if channel == "announcement":
            ann = Announcement(
                title=campaign.title,
                content=_tiptap_content(campaign.body),
                is_published=True,
                published_at=now,
                org_id=campaign.org_id,
                activity_id=campaign.activity_id,
                author_id=campaign.created_by_id,
                audience_type=AnnouncementAudience.ALL.value,
            )
            db.add(ann)
            await db.flush()
            delivery.status = PublicationDeliveryStatus.SENT.value
            delivery.sent_at = now
            delivery.provider_message_id = str(ann.id)
            delivery.target = f"/announcements/{ann.id}"
        else:
            await emit(
                db,
                event_type="publication.dispatch",
                payload={
                    "campaign_id": str(campaign.id),
                    "channel": channel,
                    "title": campaign.title,
                    "body": _render_channel_body(campaign.body, channel),
                    "activity_id": str(campaign.activity_id) if campaign.activity_id else None,
                },
            )
    campaign.status = PublicationStatus.SENT.value
    campaign.sent_at = now
    await db.flush()
    await db.refresh(campaign)
    return campaign


async def stats(db: AsyncSession, campaign_id: uuid.UUID) -> dict:
    rows = await db.execute(
        select(
            PublicationDelivery.channel,
            PublicationDelivery.status,
            func.count(PublicationDelivery.id),
        )
        .where(PublicationDelivery.campaign_id == campaign_id)
        .group_by(PublicationDelivery.channel, PublicationDelivery.status)
    )
    by_channel: dict[str, int] = {}
    by_status: dict[str, int] = {}
    total = 0
    for channel, status, count in rows:
        n = int(count)
        total += n
        by_channel[str(channel)] = by_channel.get(str(channel), 0) + n
        by_status[str(status)] = by_status.get(str(status), 0) + n
    return {
        "campaign_id": campaign_id,
        "total_deliveries": total,
        "by_channel": by_channel,
        "by_status": by_status,
    }


def _render_channel_body(body: str, channel: str) -> str:
    if channel in {"line", "discord"} and len(body) > 1800:
        return f"{body[:1800]}..."
    return body


def _tiptap_content(body: str) -> dict:
    return {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": line}] if line else [],
            }
            for line in body.splitlines()
        ],
    }
