"""角色視角導覽設定服務。"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.navigation_profile import NavigationProfile, NavigationProfilePosition
from api.models.org import Position, UserPosition
from api.models.user import User
from api.schemas.navigation_profile import (
    NavigationProfileCreate,
    NavigationProfileOut,
    NavigationProfileResolveOut,
    NavigationProfileSection,
    NavigationProfileUpdate,
)
from api.services.permission import get_user_permission_codes


def _section_dump(sections: list[NavigationProfileSection]) -> list[dict]:
    return [section.model_dump() for section in sections]


def _profile_out(profile: NavigationProfile) -> NavigationProfileOut:
    return NavigationProfileOut(
        id=profile.id,
        key=profile.key,
        label=profile.label,
        description=profile.description,
        audience=profile.audience,
        priority=profile.priority,
        is_active=profile.is_active,
        is_system=profile.is_system,
        match_any_permissions=profile.match_any_permissions or [],
        match_any_prefixes=profile.match_any_prefixes or [],
        exclude_permissions=profile.exclude_permissions or [],
        exclude_prefixes=profile.exclude_prefixes or [],
        desktop_sections=[
            NavigationProfileSection.model_validate(section)
            for section in (profile.desktop_sections or [])
        ],
        mobile_order=profile.mobile_order or [],
        position_ids=[link.position_id for link in profile.positions],
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


async def list_profiles(db: AsyncSession, include_inactive: bool = True) -> list[NavigationProfileOut]:
    stmt = (
        select(NavigationProfile)
        .options(selectinload(NavigationProfile.positions))
        .order_by(NavigationProfile.priority, NavigationProfile.label)
    )
    if not include_inactive:
        stmt = stmt.where(NavigationProfile.is_active.is_(True))
    result = await db.execute(stmt)
    return [_profile_out(profile) for profile in result.scalars().all()]


async def get_profile(db: AsyncSession, profile_id: uuid.UUID) -> NavigationProfile | None:
    return await db.scalar(
        select(NavigationProfile)
        .options(selectinload(NavigationProfile.positions))
        .where(NavigationProfile.id == profile_id)
    )


async def create_profile(db: AsyncSession, body: NavigationProfileCreate) -> NavigationProfileOut:
    profile = NavigationProfile(
        key=body.key,
        label=body.label,
        description=body.description,
        audience=body.audience,
        priority=body.priority,
        is_active=body.is_active,
        is_system=False,
        match_any_permissions=body.match_any_permissions,
        match_any_prefixes=body.match_any_prefixes,
        exclude_permissions=body.exclude_permissions,
        exclude_prefixes=body.exclude_prefixes,
        desktop_sections=_section_dump(body.desktop_sections),
        mobile_order=body.mobile_order,
    )
    db.add(profile)
    await db.flush()
    await _replace_positions(db, profile.id, body.position_ids)
    await db.commit()
    refreshed = await get_profile(db, profile.id)
    assert refreshed is not None
    return _profile_out(refreshed)


async def update_profile(
    db: AsyncSession,
    profile: NavigationProfile,
    body: NavigationProfileUpdate,
) -> NavigationProfileOut:
    data = body.model_dump(exclude_unset=True)
    position_ids = data.pop("position_ids", None)
    if "desktop_sections" in data and data["desktop_sections"] is not None:
        data["desktop_sections"] = _section_dump(body.desktop_sections or [])
    for key, value in data.items():
        setattr(profile, key, value)
    if position_ids is not None:
        await _replace_positions(db, profile.id, position_ids)
    await db.commit()
    refreshed = await get_profile(db, profile.id)
    assert refreshed is not None
    return _profile_out(refreshed)


async def delete_profile(db: AsyncSession, profile: NavigationProfile) -> None:
    await db.delete(profile)
    await db.commit()


async def resolve_for_user(db: AsyncSession, user: User) -> NavigationProfileResolveOut:
    profiles_result = await db.execute(
        select(NavigationProfile)
        .options(selectinload(NavigationProfile.positions))
        .where(NavigationProfile.is_active.is_(True))
        .order_by(NavigationProfile.priority, NavigationProfile.label)
    )
    profiles = list(profiles_result.scalars().all())
    if not profiles:
        return NavigationProfileResolveOut(profile=None, source="none")

    user_position_ids = set(
        await db.scalars(select(UserPosition.position_id).where(UserPosition.user_id == user.id))
    )
    permissions = await get_user_permission_codes(db, user.id)

    default_profile = next((profile for profile in profiles if profile.key == "default"), profiles[-1])
    for profile in profiles:
        if profile.key == "default":
            continue
        excluded = _has_match(permissions, profile.exclude_permissions, profile.exclude_prefixes)
        if excluded:
            continue
        profile_position_ids = {link.position_id for link in profile.positions}
        matched_positions = user_position_ids & profile_position_ids
        if matched_positions:
            names = await _position_names(db, matched_positions)
            return NavigationProfileResolveOut(
                profile=_profile_out(profile),
                source="position",
                matched={"position_ids": [str(pid) for pid in matched_positions], "positions": names},
            )
        if _has_match(permissions, profile.match_any_permissions, profile.match_any_prefixes):
            return NavigationProfileResolveOut(
                profile=_profile_out(profile),
                source="permission",
                matched={
                    "permissions": sorted(permissions),
                    "match_any_permissions": profile.match_any_permissions or [],
                    "match_any_prefixes": profile.match_any_prefixes or [],
                },
            )

    return NavigationProfileResolveOut(profile=_profile_out(default_profile), source="default")


async def _replace_positions(
    db: AsyncSession,
    profile_id: uuid.UUID,
    position_ids: list[uuid.UUID],
) -> None:
    unique_ids = list(dict.fromkeys(position_ids))
    if unique_ids:
        existing = set(await db.scalars(select(Position.id).where(Position.id.in_(unique_ids))))
        missing = set(unique_ids) - existing
        if missing:
            raise ValueError("指定的職位不存在")
    await db.execute(
        delete(NavigationProfilePosition).where(NavigationProfilePosition.profile_id == profile_id)
    )
    db.add_all(
        NavigationProfilePosition(profile_id=profile_id, position_id=position_id)
        for position_id in unique_ids
    )


async def _position_names(db: AsyncSession, position_ids: set[uuid.UUID]) -> list[str]:
    if not position_ids:
        return []
    result = await db.scalars(select(Position.name).where(Position.id.in_(position_ids)))
    return list(result)


def _has_match(
    permissions: frozenset[str],
    codes: list[str] | None,
    prefixes: list[str] | None,
) -> bool:
    if any(code in permissions for code in (codes or [])):
        return True
    return any(permission.startswith(prefix) for prefix in (prefixes or []) for permission in permissions)
