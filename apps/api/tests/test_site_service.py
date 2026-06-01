"""公開官網 service 測試。"""

from __future__ import annotations

import os
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Org, Position, UserPosition
from api.models.site import PublicOfficerProfile
from api.models.user import User
from api.services import site as site_svc

pytestmark = pytest.mark.skipif(
    "postgresql" not in os.getenv("TEST_DATABASE_URL", ""),
    reason="site service tests require PostgreSQL because the full model metadata includes PG JSONB tables",
)


@pytest.mark.asyncio
async def test_public_officers_only_return_visible_active_profiles(db_session: AsyncSession):
    org = Org(name="行政部門", is_active=True)
    position = Position(org=org, name="主席", weight=100)
    active_user = User(
        email="active@example.test",
        display_name="Active",
        show_email=True,
        is_active=True,
        is_verified=True,
    )
    hidden_user = User(
        email="hidden@example.test",
        display_name="Hidden",
        show_email=True,
        is_active=True,
        is_verified=True,
    )
    expired_user = User(
        email="expired@example.test",
        display_name="Expired",
        show_email=True,
        is_active=True,
        is_verified=True,
    )
    active_up = UserPosition(
        user=active_user,
        position=position,
        start_date=date.today() - timedelta(days=1),
    )
    hidden_up = UserPosition(
        user=hidden_user,
        position=position,
        start_date=date.today() - timedelta(days=1),
    )
    expired_up = UserPosition(
        user=expired_user,
        position=position,
        start_date=date.today() - timedelta(days=10),
        end_date=date.today() - timedelta(days=1),
    )
    db_session.add_all(
        [
            PublicOfficerProfile(
                user_position=active_up,
                public_email="public@example.test",
                is_visible=True,
                sort_order=1,
            ),
            PublicOfficerProfile(user_position=hidden_up, is_visible=False, sort_order=2),
            PublicOfficerProfile(user_position=expired_up, is_visible=True, sort_order=3),
        ]
    )
    await db_session.flush()

    officers = await site_svc.list_officers(db_session, active_only=True)

    assert [officer.display_name for officer in officers] == ["Active"]
    assert officers[0].public_email == "public@example.test"


@pytest.mark.asyncio
async def test_officer_candidates_mark_existing_profiles(db_session: AsyncSession):
    org = Org(name="行政部門", is_active=True)
    position = Position(org=org, name="副主席", weight=90)
    user = User(
        id=uuid.uuid4(),
        email="candidate@example.test",
        display_name="Candidate",
        is_active=True,
        is_verified=True,
    )
    user_position = UserPosition(
        user=user,
        position=position,
        start_date=date.today() - timedelta(days=1),
    )
    db_session.add(PublicOfficerProfile(user_position=user_position, is_visible=True))
    await db_session.flush()

    candidates = await site_svc.list_officer_candidates(db_session, active_only=True)

    assert len(candidates) == 1
    assert candidates[0].user_position_id == user_position.id
    assert candidates[0].has_public_profile is True
