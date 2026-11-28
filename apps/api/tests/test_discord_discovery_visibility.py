"""Discord 查詢與網站列表使用相同的公文、公告可見範圍。"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.announcement import Announcement, AnnouncementAudience
from api.models.discord_account import DiscordAccountLink
from api.models.document import (
    Document,
    DocumentClassification,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.org import Org
from api.services.discord_commands import execute


async def test_discord_discovery_limits_unpositioned_user_to_visible_items(
    db_session: AsyncSession, make_user
) -> None:
    viewer = await make_user(email="outside@example.com")
    author = await make_user(email="author@example.com")
    other = await make_user(email="other@example.com")
    db_session.add_all(
        [
            DiscordAccountLink(user_id=viewer.id, discord_user_id="discovery-viewer"),
            DiscordAccountLink(user_id=author.id, discord_user_id="discovery-author"),
        ]
    )
    org = Org(name="Discord 測試機關")
    db_session.add(org)
    await db_session.flush()

    def document(title: str, serial: str, visibility: DocumentVisibility, **extra) -> Document:
        return Document(
            title=title,
            serial_number=serial,
            org_id=org.id,
            created_by=author.id,
            status=DocumentStatus.APPROVED,
            visibility_level=visibility,
            **extra,
        )

    db_session.add_all(
        [
            document("ZZTEST public document", "ZZTEST-PUBLIC", DocumentVisibility.PUBLIC),
            document("ZZTEST private document", "ZZTEST-PRIVATE", DocumentVisibility.ORG_ONLY),
            document(
                "ZZTEST secret document",
                "ZZTEST-SECRET",
                DocumentVisibility.PUBLIC,
                classification=DocumentClassification.SECRET,
            ),
        ]
    )

    def announcement(title: str, audience: AnnouncementAudience) -> Announcement:
        return Announcement(
            title=title,
            content={},
            author_id=author.id,
            is_published=True,
            published_at=datetime.now(UTC),
            audience_type=audience.value,
        )

    public = announcement("ZZTEST public announcement", AnnouncementAudience.ALL)
    targeted = announcement("ZZTEST targeted announcement", AnnouncementAudience.MEMBERS)
    targeted.audience_users = [viewer]
    other_member = announcement("ZZTEST other member", AnnouncementAudience.MEMBERS)
    other_member.audience_users = [other]
    other_org = announcement("ZZTEST other org", AnnouncementAudience.ORGS)
    other_org.audience_orgs = [org]
    db_session.add_all([public, targeted, other_member, other_org])
    await db_session.flush()

    async def run(discord_user_id: str, operation: str, **arguments):
        return await execute(
            db_session,
            operation=operation,
            discord_user_id=discord_user_id,
            interaction_id="123",
            guild_id="456",
            arguments=arguments,
        )

    search = await run("discovery-viewer", "search", query="ZZTEST", scope="all")
    assert {item["title"] for item in search["items"]} == {
        "ZZTEST public document",
        "ZZTEST public announcement",
        "ZZTEST targeted announcement",
    }
    assert {item.get("subtitle") for item in search["items"] if item["type"] == "document"} == {
        "ZZTEST-PUBLIC"
    }

    browse = await run("discovery-viewer", "browse_announcements")
    assert {item["title"] for item in browse["items"]} == {
        "ZZTEST public announcement",
        "ZZTEST targeted announcement",
    }

    author_search = await run("discovery-author", "search", query="ZZTEST", scope="document")
    assert {item["title"] for item in author_search["items"]} == {
        "ZZTEST public document",
        "ZZTEST private document",
        "ZZTEST secret document",
    }
