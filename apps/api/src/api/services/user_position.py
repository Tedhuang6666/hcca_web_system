"""任期異動與人員歸屬、權限及登入工作階段的一致生命週期。"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.cache import cache_invalidate_user_permissions
from api.core.clock import local_today
from api.models.org import Position, UserPosition
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationSource,
    PersonAffiliationStatus,
)
from api.models.user import User
from api.services import user_session
from api.services.discord_bot import enqueue_role_sync


async def _access_changed(db: AsyncSession, user_id: uuid.UUID, *, revoke_sessions: bool) -> None:
    await cache_invalidate_user_permissions(str(user_id))
    if revoke_sessions:
        await user_session.revoke_all(db, user_id, reason="permission_changed")
    await enqueue_role_sync(db, user_id)


def _validate_dates(start_date: date, end_date: date | None) -> None:
    if end_date is not None and end_date < start_date:
        raise HTTPException(422, "任期結束日不可早於開始日")


async def _mirror_affiliation(db: AsyncSession, up: UserPosition) -> None:
    linked = select(PersonAffiliation).where(PersonAffiliation.synced_user_position_id == up.id)
    affiliations = list((await db.scalars(linked)).all())
    if not affiliations:
        from api.services.person import ensure_person_for_user

        user = await db.get(User, up.user_id)
        position = await db.get(Position, up.position_id)
        if user is None or position is None:
            raise HTTPException(404, "使用者或職位不存在")
        person = await ensure_person_for_user(db, user, source=PersonAffiliationSource.RBAC_SYNC)
        # Linking a previously unclaimed person can reconcile a pending affiliation
        # to this exact assignment. Reuse it instead of creating a second mirror.
        affiliations = list((await db.scalars(linked)).all())
        if not affiliations:
            affiliation = PersonAffiliation(
                person_id=person.id,
                kind=PersonAffiliationKind.ORG_POSITION,
                org_id=position.org_id,
                position_id=position.id,
                title=position.name,
                source=PersonAffiliationSource.RBAC_SYNC,
                synced_user_position_id=up.id,
            )
            db.add(affiliation)
            affiliations.append(affiliation)
    for affiliation in affiliations:
        affiliation.start_date = up.start_date
        affiliation.end_date = up.end_date
        # An explicit scheduled end is still an active tenure until that date.
        affiliation.status = (
            PersonAffiliationStatus.ENDED
            if up.end_date is not None and up.end_date < local_today()
            else PersonAffiliationStatus.ACTIVE
        )
    await db.flush()


async def assign(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    position_id: uuid.UUID,
    start_date: date,
    end_date: date | None,
) -> UserPosition:
    _validate_dates(start_date, end_date)
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "使用者不存在")
    position = await db.scalar(
        select(Position).options(selectinload(Position.org)).where(Position.id == position_id)
    )
    if position is None:
        raise HTTPException(404, "職位不存在")
    if position.org is not None and not position.org.is_active:
        raise HTTPException(409, "此職位所屬組織已停用，無法新增任期")
    up = UserPosition(user=user, position=position, start_date=start_date, end_date=end_date)
    db.add(up)
    await db.flush()
    await _mirror_affiliation(db, up)
    await _access_changed(db, user_id, revoke_sessions=True)
    return up


async def update_term(
    db: AsyncSession, up: UserPosition, changes: Mapping[str, date | None]
) -> UserPosition:
    start_date = changes.get("start_date") or up.start_date
    end_date = changes.get("end_date", up.end_date)
    _validate_dates(start_date, end_date)
    up.start_date = start_date
    up.end_date = end_date
    await db.flush()
    await _mirror_affiliation(db, up)
    await _access_changed(db, up.user_id, revoke_sessions=True)
    return up


async def remove(db: AsyncSession, up: UserPosition) -> None:
    user_id = up.user_id
    affiliations = (
        await db.scalars(
            select(PersonAffiliation).where(PersonAffiliation.synced_user_position_id == up.id)
        )
    ).all()
    for affiliation in affiliations:
        affiliation.status = PersonAffiliationStatus.ENDED
        affiliation.end_date = max(min(up.end_date or local_today(), local_today()), up.start_date)
        affiliation.synced_user_position_id = None
    await db.delete(up)
    await db.flush()
    await _access_changed(db, user_id, revoke_sessions=True)


async def reconcile_affiliation(
    db: AsyncSession, affiliation: PersonAffiliation
) -> UserPosition | None:
    """Reconcile existing person data without revoking the session being established at login."""
    if (
        affiliation.kind
        not in {
            PersonAffiliationKind.CLASS_ROLE,
            PersonAffiliationKind.ORG_POSITION,
        }
        or affiliation.position_id is None
    ):
        return None
    if (
        affiliation.status == PersonAffiliationStatus.ENDED
        and affiliation.synced_user_position_id is None
    ):
        return None
    person = await db.get(Person, affiliation.person_id)
    if person is None or person.user_id is None:
        affiliation.status = PersonAffiliationStatus.PENDING_USER
        await db.flush()
        return None

    up = (
        await db.get(UserPosition, affiliation.synced_user_position_id)
        if affiliation.synced_user_position_id is not None
        else None
    )
    changed = False
    if up is not None:
        changed = up.start_date != affiliation.start_date or up.end_date != affiliation.end_date
        up.start_date = affiliation.start_date
        up.end_date = affiliation.end_date
    else:
        up = await db.scalar(
            select(UserPosition).where(
                UserPosition.user_id == person.user_id,
                UserPosition.position_id == affiliation.position_id,
                UserPosition.start_date == affiliation.start_date,
                UserPosition.end_date.is_(None)
                if affiliation.end_date is None
                else UserPosition.end_date == affiliation.end_date,
            )
        )
        if up is None:
            up = UserPosition(
                user_id=person.user_id,
                position_id=affiliation.position_id,
                start_date=affiliation.start_date,
                end_date=affiliation.end_date,
            )
            db.add(up)
            await db.flush()
            changed = True
    affiliation.synced_user_position_id = up.id
    if affiliation.status == PersonAffiliationStatus.PENDING_USER:
        affiliation.status = PersonAffiliationStatus.ACTIVE
    await db.flush()
    if changed:
        await _access_changed(db, person.user_id, revoke_sessions=False)
    return up
