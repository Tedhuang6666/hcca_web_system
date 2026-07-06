"""稽核日誌查詢 Router（需 admin:all 權限）"""

from __future__ import annotations

import csv
import json
from datetime import UTC, date, datetime, timedelta
from io import StringIO
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.models.audit_log import AuditLog
from api.models.org import Position, UserPosition
from api.models.user import User
from api.services.permission import get_user_permission_codes

router = APIRouter(prefix="/audit-logs", tags=["稽核日誌"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

SYSTEM_ENTITY_TYPES: dict[str, tuple[str, ...]] = {
    "admin": ("user", "user_position", "position", "permission"),
    "org": ("org", "position", "user_position", "permission"),
    "document": ("document", "document_attachment", "serial_template"),
    "serial": ("serial_template",),
    "regulation": ("regulation", "regulation_article"),
    "announcement": ("announcement", "announcement_media"),
    "shop": ("product", "order", "shop"),
    "meal": ("meal_vendor", "meal_schedule", "meal_item", "meal_order"),
    "survey": ("survey", "survey_question", "survey_response"),
}


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    entity_type: str
    entity_id: str
    action: str
    actor_id: str | None
    actor_email: str | None
    meta: dict
    ip_address: str | None
    created_at: str
    summary: str | None

    @classmethod
    def from_orm_obj(cls, obj: AuditLog) -> AuditLogOut:
        return cls(
            id=str(obj.id),
            entity_type=obj.entity_type,
            entity_id=obj.entity_id,
            action=obj.action,
            actor_id=obj.actor_id,
            actor_email=obj.actor_email,
            meta=obj.meta or {},
            ip_address=obj.ip_address,
            created_at=obj.created_at.isoformat(),
            summary=obj.summary,
        )


async def _get_current_org_ids(session: AsyncSession, user_id: object) -> list[str]:
    result = await session.execute(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            UserPosition.start_date <= local_today(),
            or_(UserPosition.end_date.is_(None), UserPosition.end_date >= local_today()),
        )
        .distinct()
    )
    return [str(org_id) for org_id in result.scalars().all()]


async def _list_filtered_audit_logs(
    *,
    session: AsyncSession,
    current_user: User,
    entity_type: str | None,
    entity_id: str | None,
    actor_id: str | None,
    action: str | None,
    system: str | None,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> list[AuditLog]:
    codes = await get_user_permission_codes(session, current_user.id)
    can_view_all = (
        current_user.is_superuser
        or PermissionCode.ADMIN_ALL in codes
        or PermissionCode.AUDIT_VIEW_ALL in codes
        or PermissionCode.AUDIT_VIEW in codes
    )
    can_view_org = can_view_all or PermissionCode.AUDIT_VIEW_ORG in codes
    if not can_view_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要權限：audit:view_org 或 audit:view_all",
        )

    q = select(AuditLog).order_by(AuditLog.created_at.desc())
    if system and system in SYSTEM_ENTITY_TYPES:
        q = q.where(AuditLog.entity_type.in_(SYSTEM_ENTITY_TYPES[system]))
    elif entity_type:
        q = q.where(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.where(AuditLog.entity_id == entity_id)
    if actor_id:
        q = q.where(AuditLog.actor_id == actor_id)
    if action:
        q = q.where(AuditLog.action == action)
    if date_from:
        q = q.where(
            AuditLog.created_at
            >= datetime(date_from.year, date_from.month, date_from.day, tzinfo=UTC)
        )
    if date_to:
        q = q.where(
            AuditLog.created_at
            < datetime(date_to.year, date_to.month, date_to.day, tzinfo=UTC) + timedelta(days=1)
        )
    if not can_view_all:
        org_ids = await _get_current_org_ids(session, current_user.id)
        if not org_ids:
            return []
        q = q.where(
            or_(
                AuditLog.meta["org_id"].as_string().in_(org_ids),
                AuditLog.meta["custom_permission_org_id"].as_string().in_(org_ids),
                (AuditLog.entity_type == "org") & AuditLog.entity_id.in_(org_ids),
            )
        )

    result = await session.execute(q.limit(limit).offset(offset))
    return list(result.scalars().all())


@router.get(
    "",
    response_model=list[AuditLogOut],
    summary="查詢稽核日誌（需 audit:view_org / audit:view_all / admin:all）",
)
async def list_audit_logs(
    session: DbDep,
    current_user: Annotated[User, Depends(get_current_active_user)],
    entity_type: str | None = Query(None, description="資源種類 document/regulation/user..."),
    entity_id: str | None = Query(None, description="資源 ID"),
    actor_id: str | None = Query(None, description="操作者 ID"),
    action: str | None = Query(None, description="操作動詞"),
    system: str | None = Query(None, description="系統代碼：admin/org/document/..."),
    date_from: date | None = Query(None, description="起始日期"),
    date_to: date | None = Query(None, description="結束日期"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[AuditLogOut]:
    rows = await _list_filtered_audit_logs(
        session=session,
        current_user=current_user,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor_id,
        action=action,
        system=system,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return [AuditLogOut.from_orm_obj(r) for r in rows]


@router.get(
    "/export.csv",
    response_class=Response,
    summary="匯出稽核日誌 CSV（套用同查詢條件）",
)
async def export_audit_logs_csv(
    session: DbDep,
    current_user: Annotated[User, Depends(get_current_active_user)],
    entity_type: str | None = Query(None, description="資源種類 document/regulation/user..."),
    entity_id: str | None = Query(None, description="資源 ID"),
    actor_id: str | None = Query(None, description="操作者 ID"),
    action: str | None = Query(None, description="操作動詞"),
    system: str | None = Query(None, description="系統代碼：admin/org/document/..."),
    date_from: date | None = Query(None, description="起始日期"),
    date_to: date | None = Query(None, description="結束日期"),
    limit: int = Query(5000, ge=1, le=10000),
) -> Response:
    rows = await _list_filtered_audit_logs(
        session=session,
        current_user=current_user,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor_id,
        action=action,
        system=system,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=0,
    )
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "created_at",
            "action",
            "entity_type",
            "entity_id",
            "actor_id",
            "actor_email",
            "ip_address",
            "summary",
            "meta_json",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.created_at.isoformat(),
                row.action,
                row.entity_type,
                row.entity_id,
                row.actor_id or "",
                row.actor_email or "",
                row.ip_address or "",
                row.summary or "",
                json.dumps(row.meta or {}, ensure_ascii=False, sort_keys=True),
            ]
        )

    filename = f"audit_logs_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
