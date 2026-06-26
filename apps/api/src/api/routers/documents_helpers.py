"""公文 router 共用輔助函式 — 取/檢查公文、存取守衛、批次回應建構、WS 廣播。

從 [routers/documents.py](apps/api/src/api/routers/documents.py) 提取，
讓主 router 檔聚焦於 HTTP 端點本身。所有函式無業務邏輯耦合，可由 router 與
其後續可能拆分的 sub-router 共用。
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import suppress

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.permission_codes import PermissionCode
from api.core.ws_manager import manager as ws_manager
from api.models.document import Document
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User
from api.schemas.document import BatchDocumentOperationOut, BatchDocumentResult
from api.services import document as doc_svc
from api.services.permission import (
    active_tenure_filter,
    get_user_permission_codes,
    get_user_permission_codes_for_org,
    user_is_org_leader,
)


async def get_doc_or_404(doc_id: str, session: AsyncSession) -> Document:
    """接受 UUID 字串或字號（如 嶺代生字第1150000001號），查不到則 404。"""
    doc: Document | None = None
    with suppress(ValueError, AttributeError):
        doc = await doc_svc.get_document(session, uuid.UUID(doc_id))
    if doc is None:
        doc = await doc_svc.get_document_by_serial(session, doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文")
    return doc


async def assert_access(session: AsyncSession, doc: Document, user: User) -> None:
    """組織可見性守衛：無訪問權限時拋出 403"""
    if user.is_superuser:
        return
    codes = await get_user_permission_codes(session, user.id)
    if {
        str(PermissionCode.ADMIN_ALL),
        str(PermissionCode.DOCUMENT_VIEW_ALL),
        str(PermissionCode.DOCUMENT_ADMIN),
    } & set(codes):
        return
    ok = await doc_svc.check_document_access(session, doc, user.id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您無權查看此公文",
        )


async def get_user_positions_batch(
    session: AsyncSession,
    user_ids: list[uuid.UUID],
    org_id: uuid.UUID,
) -> dict[uuid.UUID, str]:
    """批量查詢多個用戶在組織中的最高職位（避免 N+1 查詢）"""
    if not user_ids:
        return {}

    today = local_today()
    result = await session.execute(
        select(UserPosition.user_id, Position.name)
        .join(Position, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id.in_(user_ids),
            UserPosition.start_date <= today,
            or_(UserPosition.end_date.is_(None), UserPosition.end_date >= today),
            Position.org_id == org_id,
        )
        .order_by(UserPosition.user_id, Position.weight.desc())
    )

    user_titles: dict[uuid.UUID, str] = {}
    for user_id, title in result.all():
        if user_id not in user_titles:
            user_titles[user_id] = title
    return user_titles


async def attach_approval_titles(session: AsyncSession, doc: Document) -> None:
    """為公文的審核步驟附加職位標題（批量查詢，避免 N+1）"""
    if not doc.approvals:
        return
    user_ids: set[uuid.UUID] = set()
    for approval in doc.approvals:
        user_ids.add(approval.approver_id)
        if approval.delegate_id:
            user_ids.add(approval.delegate_id)

    user_titles = await get_user_positions_batch(session, list(user_ids), doc.org_id)

    for approval in doc.approvals:
        approval.__dict__["approver_title"] = user_titles.get(approval.approver_id)
        if approval.delegate_id:
            approval.__dict__["delegate_title"] = user_titles.get(approval.delegate_id)


async def assert_can_edit(session: AsyncSession, doc: Document, user: User) -> None:
    if user.is_superuser or doc.created_by == user.id:
        return
    codes = await get_user_permission_codes_for_org(session, user.id, doc.org_id)
    if "document:admin" in codes or "document:edit" in codes:
        return
    if await user_is_org_leader(session, user.id, doc.org_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="您無權編輯此公文")


async def can_manage_delegation_for_org(
    session: AsyncSession, user: User, org_id: uuid.UUID
) -> bool:
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes_for_org(session, user.id, org_id)
    return "document:admin" in codes or "admin:all" in codes


async def org_ids_with_document_permissions(session: AsyncSession, user: User) -> list[uuid.UUID]:
    if user.is_superuser:
        return []
    today = local_today()
    doc_codes = {"document:draft", "document:create", "document:admin", "admin:all"}

    # Batch: (org_id, code) for all of user's active positions — single query
    rows = (
        await session.execute(
            select(Position.org_id, Permission.code)
            .join(Permission, Permission.position_id == Position.id)
            .join(UserPosition, UserPosition.position_id == Position.id)
            .where(UserPosition.user_id == user.id, *active_tenure_filter(today))
        )
    ).all()

    org_direct_codes: dict[uuid.UUID, set[str]] = {}
    for org_id, code in rows:
        org_direct_codes.setdefault(org_id, set()).add(code)

    qualified: set[uuid.UUID] = {oid for oid, codes in org_direct_codes.items() if doc_codes & codes}
    remaining = [oid for oid in org_direct_codes if oid not in qualified]

    if remaining:
        # Explicit org leaders inherit all org permissions
        explicit_leader_ids = list(
            (
                await session.execute(
                    select(Org.id).where(Org.id.in_(remaining), Org.leader_user_id == user.id)
                )
            ).scalars().all()
        )
        # Auto-leaders (no explicit leader_user_id set) — typically very few
        auto_candidates = [oid for oid in remaining if oid not in explicit_leader_ids]
        for org_id in auto_candidates:
            if await user_is_org_leader(session, user.id, org_id):
                explicit_leader_ids.append(org_id)

        if explicit_leader_ids:
            # Leader gets all org permissions — qualify if org has any doc codes
            leader_qualified = (
                await session.execute(
                    select(Position.org_id)
                    .join(Permission, Permission.position_id == Position.id)
                    .where(
                        Position.org_id.in_(explicit_leader_ids),
                        Permission.code.in_(doc_codes),
                    )
                    .distinct()
                )
            ).scalars().all()
            qualified.update(leader_qualified)

    return list(qualified)


async def require_document_template_manage(
    session: AsyncSession,
    user: User,
    org_id: uuid.UUID,
) -> None:
    if user.is_superuser:
        return
    codes = await get_user_permission_codes_for_org(session, user.id, org_id)
    if not ({"document:admin", "admin:all"} & set(codes)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您在此組織下無管理公文範本的權限（需 document:admin）",
        )


async def require_document_template_use(
    session: AsyncSession,
    user: User,
    org_id: uuid.UUID,
) -> None:
    if user.is_superuser:
        return
    codes = await get_user_permission_codes_for_org(session, user.id, org_id)
    if not ({"document:draft", "document:create", "document:admin", "admin:all"} & set(codes)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您在此組織下無使用公文範本草擬的權限（需 document:draft 或 document:create）",
        )


def ws_broadcast_bg(doc: Document) -> None:
    """向公文所屬房間廣播狀態更新（背景任務用）。"""
    msg = ws_manager.build_message(
        "document_status_changed",
        {"doc_id": str(doc.id), "serial": doc.serial_number, "status": doc.status.value},
        room=f"org:{doc.org_id}",
    )
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(ws_manager.broadcast_to_room(f"org:{doc.org_id}", msg))
    except RuntimeError:
        pass  # 無事件迴圈時靜默略過（背景執行緒環境）


def unique_doc_ids(document_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    seen: set[uuid.UUID] = set()
    unique: list[uuid.UUID] = []
    for doc_id in document_ids:
        if doc_id in seen:
            continue
        seen.add(doc_id)
        unique.append(doc_id)
    return unique


def batch_result(
    doc_id: uuid.UUID,
    *,
    ok: bool,
    doc: Document | None = None,
    detail: str | None = None,
) -> BatchDocumentResult:
    return BatchDocumentResult(
        document_id=doc_id,
        serial_number=doc.serial_number if doc else None,
        title=doc.title if doc else None,
        ok=ok,
        status=doc.status if doc else None,
        detail=detail,
    )


def batch_out(results: list[BatchDocumentResult]) -> BatchDocumentOperationOut:
    succeeded = sum(1 for item in results if item.ok)
    return BatchDocumentOperationOut(
        total=len(results),
        succeeded=succeeded,
        failed=len(results) - succeeded,
        results=results,
    )
