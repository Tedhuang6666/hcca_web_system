"""公文自動催辦 Celery 任務。Phase C1。

每日 08:00 跑：
  1. 找出 status = pending（待審核 / 簽核中）且 due_date < now 的公文
  2. 依 reminder_count 採不同行動：
        0 → 寄信給目前簽核人 + 站內通知
        1 → 加 cc 直屬主管
        2 → 升級給直屬主管 + 通知建立者
        ≥3 → 通知系統管理員（POLICY_ADMIN）
  3. document.reminder_count += 1、寫 AuditLog（雜湊鏈）

不直接寄 email：改用 outbox + email_tasks（既有 at-least-once 機制）。

Note：本檔故意不引用 document_service.notify_*，因為呼叫鏈太深；
而是寫 outbox 事件交給 [api.services.email_tasks] 處理。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select

from api.core.celery_app import celery_app
from api.models.document import (
    ApprovalStepStatus,
    Document,
    DocumentApproval,
    DocumentStatus,
)
from api.models.user import User
from api.services import audit_chain

logger = logging.getLogger(__name__)

# 公文催辦對應的 outbox event_type（既有 email_tasks 會看 event_type 派發）
EVENT_DOC_REMINDER = "document.reminder"
EVENT_DOC_ESCALATED = "document.escalated"
EVENT_DOC_ADMIN_ESCALATED = "document.admin_escalated"


async def _emit_event(db, *, event_type: str, payload: dict) -> None:
    """寫 outbox。失敗不阻斷主流程。"""
    try:
        from api.services import outbox

        await outbox.emit(db, event_type=event_type, payload=payload)
    except Exception:
        logger.exception("emit %s failed", event_type)


async def _process_overdue_async() -> dict:
    """主邏輯：掃描 overdue 公文 + 採取催辦行動。"""
    from api.core.database import task_session

    now = datetime.now(UTC)
    sent = 0
    escalated = 0
    admin_escalated = 0
    examined = 0

    async with task_session() as db:
        # 找待簽且過期的公文
        doc_stmt = (
            select(Document)
            .where(Document.status == DocumentStatus.PENDING.value)
            .where(Document.due_date.is_not(None))
            .where(Document.due_date < now)
            .order_by(Document.due_date)
            .limit(500)
        )
        docs = list((await db.execute(doc_stmt)).scalars().all())

        for doc in docs:
            examined += 1
            # 找目前 pending step（最小 step_order 且 status=pending）
            step_stmt = (
                select(DocumentApproval)
                .where(DocumentApproval.document_id == doc.id)
                .where(DocumentApproval.status == ApprovalStepStatus.PENDING.value)
                .order_by(DocumentApproval.step_order)
            )
            pending_steps = list((await db.execute(step_stmt)).scalars().all())
            if not pending_steps:
                continue

            n = doc.reminder_count
            actions = []

            if n == 0:
                actions = ["notify_approver"]
                sent += 1
            elif n == 1:
                actions = ["notify_approver", "cc_supervisor"]
                sent += 1
            elif n == 2:
                actions = ["notify_supervisor", "notify_creator"]
                escalated += 1
            else:
                actions = ["notify_admin"]
                admin_escalated += 1

            # 對每個 pending step 發事件（含並簽組所有人）
            for step in pending_steps:
                payload = {
                    "document_id": str(doc.id),
                    "document_title": doc.title,
                    "approver_id": str(step.approver_id),
                    "due_date": doc.due_date.isoformat(),
                    "actions": actions,
                    "reminder_count": n + 1,
                }
                event_type = (
                    EVENT_DOC_ADMIN_ESCALATED
                    if "notify_admin" in actions
                    else EVENT_DOC_ESCALATED
                    if any(a.startswith("notify_supervisor") for a in actions)
                    else EVENT_DOC_REMINDER
                )
                await _emit_event(db, event_type=event_type, payload=payload)

            # 更新文件
            doc.reminder_count = n + 1
            doc.last_reminded_at = now

            # 寫 audit log（with chain）
            actor_email = None
            try:
                actor = await db.get(User, doc.author_id) if doc.author_id else None
                actor_email = actor.email if actor else None
            except Exception:
                pass
            await audit_chain.write_audit_log_with_chain(
                db,
                entity_type="document",
                entity_id=str(doc.id),
                action="auto_reminder_sent",
                actor_id=None,
                actor_email=None,
                meta={
                    "reminder_count": n + 1,
                    "actions": actions,
                    "document_title": doc.title,
                    "document_creator_email": actor_email,
                },
                summary=f"公文 {doc.title} 第 {n + 1} 次自動催辦：{actions}",
            )

        await db.commit()

    return {
        "status": "ok",
        "examined": examined,
        "reminders_sent": sent,
        "escalated": escalated,
        "admin_escalated": admin_escalated,
        "now": now.isoformat(),
    }


@celery_app.task(name="api.services.document_reminder_tasks.send_document_reminders")
def send_document_reminders() -> dict:
    """每日 08:00 跑（建議）。對 overdue 公文催辦 + 視次數升級。"""
    return asyncio.run(_process_overdue_async())


__all__ = ["send_document_reminders"]
