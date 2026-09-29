"""班級歸戶更正申請。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.school_class import ClassCorrectionRequest, SchoolClass
from api.models.user import User


def _request_load_options():
    return (
        selectinload(ClassCorrectionRequest.user),
        selectinload(ClassCorrectionRequest.reported_class),
        selectinload(ClassCorrectionRequest.requested_class),
        selectinload(ClassCorrectionRequest.resolved_class),
    )


async def create_request(
    session: AsyncSession,
    *,
    user: User,
    reported_class: SchoolClass,
    requested_class_id: uuid.UUID,
    message: str | None,
) -> ClassCorrectionRequest:
    requested_class = await session.get(SchoolClass, requested_class_id)
    if requested_class is None or not requested_class.is_active:
        raise ValueError("請選擇目前有效的班級")
    if requested_class.id == reported_class.id:
        raise ValueError("請選擇與目前歸戶不同的班級")

    pending = await session.scalar(
        select(ClassCorrectionRequest.id).where(
            ClassCorrectionRequest.user_id == user.id,
            ClassCorrectionRequest.status == "pending",
        )
    )
    if pending is not None:
        raise ValueError("你已有一筆待審核的班級更正申請")

    request = ClassCorrectionRequest(
        user_id=user.id,
        reported_class_id=reported_class.id,
        requested_class_id=requested_class.id,
        message=message.strip() if message and message.strip() else None,
    )
    session.add(request)
    await session.flush()
    created = await get_request(session, request.id)
    if created is None:
        raise RuntimeError("班級更正申請建立後無法讀取")
    return created


async def get_request(
    session: AsyncSession, request_id: uuid.UUID
) -> ClassCorrectionRequest | None:
    result = await session.execute(
        select(ClassCorrectionRequest)
        .options(*_request_load_options())
        .where(ClassCorrectionRequest.id == request_id)
    )
    return result.scalar_one_or_none()


async def list_user_requests(
    session: AsyncSession, user_id: uuid.UUID
) -> list[ClassCorrectionRequest]:
    result = await session.execute(
        select(ClassCorrectionRequest)
        .options(*_request_load_options())
        .where(ClassCorrectionRequest.user_id == user_id)
        .order_by(ClassCorrectionRequest.created_at.desc())
        .limit(20)
    )
    return list(result.scalars().all())


async def list_pending_requests(session: AsyncSession) -> list[ClassCorrectionRequest]:
    result = await session.execute(
        select(ClassCorrectionRequest)
        .options(*_request_load_options())
        .where(ClassCorrectionRequest.status == "pending")
        .order_by(ClassCorrectionRequest.created_at.asc())
        .limit(200)
    )
    return list(result.scalars().all())


async def resolve_request(
    session: AsyncSession,
    request: ClassCorrectionRequest,
    *,
    status: str,
    resolved_class_id: uuid.UUID | None,
    reviewer_id: uuid.UUID,
    review_note: str | None,
) -> ClassCorrectionRequest:
    if request.status != "pending":
        raise ValueError("此申請已經處理")
    request.status = status
    request.resolved_class_id = resolved_class_id
    request.reviewed_by_id = reviewer_id
    request.reviewed_at = datetime.now(UTC)
    request.review_note = review_note.strip() if review_note and review_note.strip() else None
    await session.flush()
    refreshed = await get_request(session, request.id)
    if refreshed is None:
        raise ValueError("找不到此申請")
    return refreshed
