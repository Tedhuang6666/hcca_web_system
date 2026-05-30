"""使用者生命週期 — 凍結 / 校友歸檔 / 恢復。

設計：
  - **freeze**：所有 active user_positions 的 end_date 改為今天 + is_active = False。
    保留所有資料；可 unfreeze 復原（但不會重建任期）。
  - **archive_alumni**：等同 freeze + display_name 後綴「(校友)」標記。
    不假名化（要假名化請走 `/admin/privacy`）。
  - **restore**：is_active = True；不重建已結束的任期。

所有操作會把當下狀態 snapshot 寫進 audit_log meta，便於人工查驗。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import UserPosition
from api.models.user import User

_ALUMNI_SUFFIX = "（校友）"


@dataclass
class LifecycleResult:
    user_id: uuid.UUID
    action: str
    affected_positions: int
    was_active: bool
    snapshot: dict[str, Any]
    performed_at: datetime


async def _active_positions_for_user(
    session: AsyncSession, user_id: uuid.UUID, today: date
) -> list[UserPosition]:
    stmt = select(UserPosition).where(
        UserPosition.user_id == user_id,
        and_(
            UserPosition.start_date <= today,
            or_(UserPosition.end_date.is_(None), UserPosition.end_date >= today),
        ),
    )
    return list((await session.execute(stmt)).scalars().all())


async def _snapshot_user(session: AsyncSession, user: User) -> dict[str, Any]:
    today = datetime.now(UTC).date()
    positions = await _active_positions_for_user(session, user.id, today)
    return {
        "user_id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "is_active": user.is_active,
        "active_positions": [
            {
                "user_position_id": str(p.id),
                "position_id": str(p.position_id),
                "start_date": p.start_date.isoformat(),
                "end_date": p.end_date.isoformat() if p.end_date else None,
            }
            for p in positions
        ],
    }


async def get_status(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ValueError("找不到該使用者")
    return await _snapshot_user(session, user)


async def freeze(session: AsyncSession, *, user_id: uuid.UUID, reason: str = "") -> LifecycleResult:
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ValueError("找不到該使用者")
    today = datetime.now(UTC).date()
    snapshot = await _snapshot_user(session, user)
    snapshot["reason"] = reason

    positions = await _active_positions_for_user(session, user.id, today)
    for p in positions:
        p.end_date = today

    was_active = user.is_active
    user.is_active = False
    await session.flush()

    return LifecycleResult(
        user_id=user.id,
        action="freeze",
        affected_positions=len(positions),
        was_active=was_active,
        snapshot=snapshot,
        performed_at=datetime.now(UTC),
    )


async def archive_alumni(
    session: AsyncSession, *, user_id: uuid.UUID, reason: str = ""
) -> LifecycleResult:
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ValueError("找不到該使用者")
    today = datetime.now(UTC).date()
    snapshot = await _snapshot_user(session, user)
    snapshot["reason"] = reason

    positions = await _active_positions_for_user(session, user.id, today)
    for p in positions:
        p.end_date = today

    was_active = user.is_active
    if not user.display_name.endswith(_ALUMNI_SUFFIX):
        user.display_name = f"{user.display_name}{_ALUMNI_SUFFIX}"
    user.is_active = False
    await session.flush()

    return LifecycleResult(
        user_id=user.id,
        action="archive_alumni",
        affected_positions=len(positions),
        was_active=was_active,
        snapshot=snapshot,
        performed_at=datetime.now(UTC),
    )


async def restore(
    session: AsyncSession, *, user_id: uuid.UUID, reason: str = ""
) -> LifecycleResult:
    """恢復 is_active；不重建已結束的任期（請走 /admin/permissions 重新指派）。"""
    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise ValueError("找不到該使用者")
    snapshot = await _snapshot_user(session, user)
    snapshot["reason"] = reason

    was_active = user.is_active
    user.is_active = True
    if user.display_name.endswith(_ALUMNI_SUFFIX):
        user.display_name = user.display_name[: -len(_ALUMNI_SUFFIX)]
    await session.flush()

    return LifecycleResult(
        user_id=user.id,
        action="restore",
        affected_positions=0,
        was_active=was_active,
        snapshot=snapshot,
        performed_at=datetime.now(UTC),
    )
