"""公開官網 service。"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.org import Position, UserPosition
from api.models.site import (
    PublicLink,
    PublicLinkCategory,
    PublicOfficerProfile,
    PublicSitePage,
    PublicSiteSettings,
)
from api.models.user import User
from api.schemas.site import (
    PublicLinkCategoryCreate,
    PublicLinkCategoryUpdate,
    PublicLinkCreate,
    PublicLinkUpdate,
    PublicOfficerCandidateOut,
    PublicOfficerOut,
    PublicOfficerProfileCreate,
    PublicOfficerProfileUpdate,
    PublicSitePageCreate,
    PublicSitePageUpdate,
    PublicSiteSettingsUpdate,
)

DEFAULT_SETTINGS = {
    "site_title": "新竹高中班聯會",
    "site_description": "國立新竹高級中學班級聯合自治會公開網站",
    "site_logo_url": None,
    "site_logo_alt": None,
    "hero_title": "新竹高中班聯會",
    "hero_subtitle": "連結學生、整理公共資訊，讓校園自治被更多人看見。",
    "hero_image_url": None,
    "hero_image_alt": None,
    "about_title": "關於班聯會",
    "about_body_md": "新竹高中班聯會是由學生組成的自治組織，負責整合班級意見、推動公共服務，並維護校園公共參與。",
    "mission_md": "我們希望讓學生的聲音被聽見，也讓制度、活動與公共資訊更透明。",
    "history_md": None,
    "cta_label": "查看平台連結",
    "cta_href": "/links",
    "public_database_label": "公開資料庫",
    "public_database_description": "查詢公開法規、公文與治理資料。",
    "theme_config": {},
    "homepage_blocks": {},
    "custom_css": None,
    "seo_title": None,
    "seo_description": None,
}


async def get_settings(db: AsyncSession) -> PublicSiteSettings:
    result = await db.execute(select(PublicSiteSettings).order_by(PublicSiteSettings.created_at))
    settings = result.scalars().first()
    if settings:
        return settings
    settings = PublicSiteSettings(**DEFAULT_SETTINGS)
    db.add(settings)
    await db.flush()
    return settings


async def update_settings(db: AsyncSession, data: PublicSiteSettingsUpdate) -> PublicSiteSettings:
    settings = await get_settings(db)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(settings, key, value)
    await db.flush()
    return settings


async def list_link_categories(
    db: AsyncSession, active_only: bool = False
) -> list[PublicLinkCategory]:
    stmt = select(PublicLinkCategory).order_by(
        PublicLinkCategory.sort_order, PublicLinkCategory.title
    )
    if active_only:
        stmt = stmt.where(PublicLinkCategory.is_active.is_(True))
    return list((await db.execute(stmt)).scalars().all())


async def create_link_category(
    db: AsyncSession, data: PublicLinkCategoryCreate
) -> PublicLinkCategory:
    category = PublicLinkCategory(**data.model_dump())
    db.add(category)
    await db.flush()
    return category


async def update_link_category(
    db: AsyncSession, category: PublicLinkCategory, data: PublicLinkCategoryUpdate
) -> PublicLinkCategory:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(category, key, value)
    await db.flush()
    return category


async def list_links(db: AsyncSession, active_only: bool = False) -> list[PublicLink]:
    stmt = (
        select(PublicLink)
        .options(selectinload(PublicLink.category))
        .order_by(PublicLink.sort_order, PublicLink.title)
    )
    if active_only:
        stmt = stmt.where(PublicLink.is_active.is_(True))
    return list((await db.execute(stmt)).scalars().all())


async def get_link(db: AsyncSession, link_id: uuid.UUID) -> PublicLink | None:
    result = await db.execute(
        select(PublicLink)
        .where(PublicLink.id == link_id)
        .options(selectinload(PublicLink.category))
    )
    return result.scalar_one_or_none()


async def create_link(db: AsyncSession, data: PublicLinkCreate) -> PublicLink:
    link = PublicLink(**data.model_dump())
    db.add(link)
    await db.flush()
    return await get_link(db, link.id) or link


async def update_link(db: AsyncSession, link: PublicLink, data: PublicLinkUpdate) -> PublicLink:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(link, key, value)
    await db.flush()
    return await get_link(db, link.id) or link


def _active_term_filter(stmt: Select[Any], on_date: date) -> Select[Any]:
    return stmt.where(
        UserPosition.start_date <= on_date,
        (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= on_date),
    )


async def list_officers(
    db: AsyncSession, active_only: bool = True, featured_only: bool = False
) -> list[PublicOfficerOut]:
    """公開幹部名單（混合模式）。

    預設自動列出所有「目前任期有效」的幹部；若該任期建有 PublicOfficerProfile，
    則套用覆寫（顯示名稱、稱謂、簡介、排序、精選），並可透過 is_visible=False 隱藏。
    尚未建立覆寫設定的幹部仍會以使用者/職位的預設值自動顯示。
    """
    today = date.today()
    stmt = (
        select(UserPosition)
        .join(UserPosition.user)
        .join(UserPosition.position)
        .join(Position.org)
        .options(
            selectinload(UserPosition.user),
            selectinload(UserPosition.position).selectinload(Position.org),
        )
        .order_by(Position.weight.desc(), Position.name, User.display_name)
    )
    if active_only:
        stmt = _active_term_filter(stmt, today)
    tenures = (await db.execute(stmt)).scalars().all()

    profiles_by_position = {
        profile.user_position_id: profile
        for profile in (await db.execute(select(PublicOfficerProfile))).scalars().all()
    }

    officers: list[PublicOfficerOut] = []
    for tenure in tenures:
        profile = profiles_by_position.get(tenure.id)
        if profile is not None and not profile.is_visible:
            continue  # 管理員手動隱藏
        if featured_only and not (profile.is_featured if profile else False):
            continue
        officers.append(_tenure_to_public_officer(tenure, profile))

    # 依覆寫排序值排序；同值時維持查詢順序（職位權重 desc → 名稱）
    officers.sort(key=lambda officer: officer.sort_order)
    return officers


async def list_officer_profiles(db: AsyncSession) -> list[PublicOfficerProfile]:
    result = await db.execute(
        select(PublicOfficerProfile)
        .options(
            selectinload(PublicOfficerProfile.user_position).selectinload(UserPosition.user),
            selectinload(PublicOfficerProfile.user_position)
            .selectinload(UserPosition.position)
            .selectinload(Position.org),
        )
        .order_by(PublicOfficerProfile.sort_order, PublicOfficerProfile.created_at)
    )
    return list(result.scalars().all())


async def get_officer_profile(
    db: AsyncSession, profile_id: uuid.UUID
) -> PublicOfficerProfile | None:
    return await db.get(PublicOfficerProfile, profile_id)


async def create_officer_profile(
    db: AsyncSession, data: PublicOfficerProfileCreate
) -> PublicOfficerProfile:
    profile = PublicOfficerProfile(**data.model_dump())
    db.add(profile)
    await db.flush()
    return profile


async def update_officer_profile(
    db: AsyncSession, profile: PublicOfficerProfile, data: PublicOfficerProfileUpdate
) -> PublicOfficerProfile:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    await db.flush()
    return profile


async def list_officer_candidates(
    db: AsyncSession, active_only: bool = True
) -> list[PublicOfficerCandidateOut]:
    today = date.today()
    existing_result = await db.execute(select(PublicOfficerProfile.user_position_id))
    existing_ids = set(existing_result.scalars().all())
    stmt = (
        select(UserPosition)
        .join(UserPosition.user)
        .join(UserPosition.position)
        .join(Position.org)
        .options(
            selectinload(UserPosition.user),
            selectinload(UserPosition.position).selectinload(Position.org),
        )
        .order_by(Position.weight.desc(), Position.name, User.display_name)
    )
    if active_only:
        stmt = _active_term_filter(stmt, today)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        PublicOfficerCandidateOut(
            user_position_id=row.id,
            user_id=row.user_id,
            display_name=row.user.display_name,
            email=row.user.email,
            show_email=row.user.show_email,
            avatar_url=row.user.avatar_url,
            org_id=row.position.org_id,
            org_name=row.position.org.name if row.position.org else "",
            position_id=row.position_id,
            position_name=row.position.name,
            start_date=row.start_date,
            end_date=row.end_date,
            has_public_profile=row.id in existing_ids,
        )
        for row in rows
    ]


def _tenure_to_public_officer(
    user_position: UserPosition, profile: PublicOfficerProfile | None
) -> PublicOfficerOut:
    user = user_position.user
    position = user_position.position
    org = position.org
    # Email 對外顯示一律以使用者 show_email 為前提；有覆寫則優先用覆寫值。
    public_email = None
    if user.show_email:
        public_email = (profile.public_email if profile else None) or user.email
    return PublicOfficerOut(
        id=user_position.id,
        profile_id=profile.id if profile else None,
        user_position_id=user_position.id,
        user_id=user.id,
        display_name=(profile.display_name_override if profile else None) or user.display_name,
        title=(profile.title_override if profile else None) or position.name,
        org_name=org.name if org else "",
        position_name=position.name,
        avatar_url=user.avatar_url,
        public_email=public_email,
        bio=profile.bio if profile else None,
        external_links=profile.external_links if profile else {},
        start_date=user_position.start_date,
        end_date=user_position.end_date,
        sort_order=profile.sort_order if profile else 0,
        is_featured=profile.is_featured if profile else False,
    )


async def list_pages(
    db: AsyncSession, published_only: bool = False, nav_only: bool = False
) -> list[PublicSitePage]:
    stmt = select(PublicSitePage).order_by(PublicSitePage.sort_order, PublicSitePage.title)
    if published_only:
        stmt = stmt.where(PublicSitePage.is_published.is_(True))
    if nav_only:
        stmt = stmt.where(PublicSitePage.show_in_nav.is_(True)).order_by(
            PublicSitePage.nav_order, PublicSitePage.title
        )
    return list((await db.execute(stmt)).scalars().all())


async def get_page_by_slug(db: AsyncSession, slug: str) -> PublicSitePage | None:
    result = await db.execute(select(PublicSitePage).where(PublicSitePage.slug == slug))
    return result.scalar_one_or_none()


async def create_page(db: AsyncSession, data: PublicSitePageCreate) -> PublicSitePage:
    page = PublicSitePage(**data.model_dump())
    db.add(page)
    await db.flush()
    return page


async def update_page(
    db: AsyncSession, page: PublicSitePage, data: PublicSitePageUpdate
) -> PublicSitePage:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(page, key, value)
    await db.flush()
    return page
