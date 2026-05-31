"""Feature flag service 測試。Phase D3。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.feature_flag import FeatureFlag
from api.models.user import User
from api.services import feature_flag as ff


def _make_user(*, email: str = "test@hcca.local") -> User:
    return User(
        id=uuid.uuid4(),
        email=email,
        display_name="Test",
        is_active=True,
        is_verified=True,
    )


def test_bucket_is_stable():
    uid = str(uuid.uuid4())
    b1 = ff._bucket_for(uid, "my_flag")
    b2 = ff._bucket_for(uid, "my_flag")
    assert b1 == b2
    assert 0 <= b1 < 100


def test_bucket_differs_by_flag():
    uid = str(uuid.uuid4())
    buckets = {ff._bucket_for(uid, f"flag_{i}") for i in range(20)}
    # 至少有兩個不同（碰撞極小機率）
    assert len(buckets) > 1


@pytest.mark.asyncio
async def test_disabled_when_flag_missing(db_session: AsyncSession):
    user = _make_user()
    db_session.add(user)
    await db_session.flush()
    assert await ff.is_enabled(db_session, "nonexistent", user) is False


@pytest.mark.asyncio
async def test_global_enabled_returns_true_for_anyone(db_session: AsyncSession):
    flag = FeatureFlag(key="globally_on", is_globally_enabled=True)
    db_session.add(flag)
    user = _make_user()
    db_session.add(user)
    await db_session.flush()
    assert await ff.is_enabled(db_session, "globally_on", user) is True


@pytest.mark.asyncio
async def test_unauthenticated_user_only_sees_global(db_session: AsyncSession):
    flag = FeatureFlag(
        key="needs_user",
        is_globally_enabled=False,
        percentage_rollout=100,
    )
    db_session.add(flag)
    await db_session.flush()
    # user=None → False（不灰度）
    assert await ff.is_enabled(db_session, "needs_user", None) is False


@pytest.mark.asyncio
async def test_explicit_user_list_match(db_session: AsyncSession):
    user = _make_user()
    db_session.add(user)
    await db_session.flush()
    flag = FeatureFlag(
        key="vip_only",
        is_globally_enabled=False,
        enabled_user_ids=[str(user.id)],
    )
    db_session.add(flag)
    await db_session.flush()
    assert await ff.is_enabled(db_session, "vip_only", user) is True


@pytest.mark.asyncio
async def test_percentage_zero_means_no_one(db_session: AsyncSession):
    user = _make_user()
    db_session.add(user)
    flag = FeatureFlag(key="ramp", percentage_rollout=0)
    db_session.add(flag)
    await db_session.flush()
    assert await ff.is_enabled(db_session, "ramp", user) is False


@pytest.mark.asyncio
async def test_archived_flag_returns_false(db_session: AsyncSession):
    from datetime import UTC
    from datetime import datetime as _dt

    user = _make_user()
    db_session.add(user)
    flag = FeatureFlag(
        key="archived",
        is_globally_enabled=True,
        archived_at=_dt.now(UTC),
    )
    db_session.add(flag)
    await db_session.flush()
    assert await ff.is_enabled(db_session, "archived", user) is False


@pytest.mark.asyncio
async def test_create_then_update_then_archive(db_session: AsyncSession):
    row = await ff.create_flag(db_session, key="dynamic", description="x")
    await db_session.flush()

    updated = await ff.update_flag(
        db_session, row.id, is_globally_enabled=True, percentage_rollout=50
    )
    assert updated.is_globally_enabled is True
    assert updated.percentage_rollout == 50

    archived = await ff.archive_flag(db_session, row.id)
    assert archived.archived_at is not None
