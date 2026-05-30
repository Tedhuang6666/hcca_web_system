"""活動總召權限服務測試"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity, ActivityConvener, ActivityStatus
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User
from api.schemas.activity import ActivityConvenerCreate
from api.services.activity import appoint_convener, can_manage_activity_resource


async def _seed_activity(db: AsyncSession) -> tuple[User, Activity, ActivityConvener]:
    user = User(email="convener@school.edu", display_name="活動總召", is_active=True)
    org = Org(name="活動部")
    activity = Activity(name="園遊會", org=org, status=ActivityStatus.ACTIVE)
    db.add_all([user, org, activity])
    await db.flush()
    convener = ActivityConvener(
        activity_id=activity.id,
        user_id=user.id,
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(days=1),
    )
    db.add(convener)
    await db.flush()
    return user, activity, convener


@pytest.mark.asyncio
async def test_active_convener_can_manage_activity_resource(db_session: AsyncSession) -> None:
    user, activity, _ = await _seed_activity(db_session)

    assert await can_manage_activity_resource(db_session, user, activity.id) is True


@pytest.mark.asyncio
async def test_archived_activity_disables_convener_authority(db_session: AsyncSession) -> None:
    user, activity, _ = await _seed_activity(db_session)
    activity.status = ActivityStatus.ARCHIVED
    activity.is_active = False
    await db_session.flush()

    assert await can_manage_activity_resource(db_session, user, activity.id) is False


@pytest.mark.asyncio
async def test_expired_convener_cannot_manage_activity_resource(db_session: AsyncSession) -> None:
    user, activity, convener = await _seed_activity(db_session)
    convener.end_date = date.today() - timedelta(days=1)
    await db_session.flush()

    assert await can_manage_activity_resource(db_session, user, activity.id) is False


@pytest.mark.asyncio
async def test_admin_all_can_manage_activity_resource(db_session: AsyncSession) -> None:
    user, activity, _ = await _seed_activity(db_session)
    org = Org(name="系統")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="管理員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code="admin:all"))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=date.today() - timedelta(days=1),
        )
    )
    await db_session.flush()

    assert await can_manage_activity_resource(db_session, user, activity.id) is True


@pytest.mark.asyncio
async def test_overlapping_convener_term_is_rejected(db_session: AsyncSession) -> None:
    user, activity, _ = await _seed_activity(db_session)

    with pytest.raises(ValueError, match="重疊"):
        await appoint_convener(
            db_session,
            activity,
            ActivityConvenerCreate(
                user_id=user.id,
                start_date=date.today(),
                end_date=date.today() + timedelta(days=3),
            ),
        )
