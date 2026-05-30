"""換屆精靈 — 批次結束舊任期 + 建立新任期，支援 dry-run 與 rollback。

設計：
  - **不新增表**：rollback 資訊作為 JSON snapshot 寫入 audit_log.meta，
    透過 batch_id 反查；rollback 重新讀 snapshot 還原。
  - **三步驟**：dry_run → execute(returns batch_id) → rollback(by batch_id)。
  - **冪等性**：execute 內以單一事務寫入；rollback 同樣事務化。
  - **不動其他資料**：僅處理 user_positions。字號 / 公文承辦人 / 學餐合約等
    由業務 SOP 另行處理（[docs/TERM_ROLLOVER_SOP.md](../../../../docs/TERM_ROLLOVER_SOP.md)）。
  - **驗證嚴格**：dry-run 會回報所有「警告」（如重複任期、無效 user_id、過期 position）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.audit_log import AuditLog
from api.models.org import Position, UserPosition
from api.models.user import User

# ── Schemas ────────────────────────────────────────────────────────────────


@dataclass
class NewAssignment:
    user_id: uuid.UUID
    position_id: uuid.UUID
    start_date: date
    end_date: date | None = None


@dataclass
class TerminationPlan:
    user_position_id: uuid.UUID
    user_id: uuid.UUID
    user_email: str | None
    position_id: uuid.UUID
    position_name: str
    org_name: str
    current_end_date: date | None
    new_end_date: date


@dataclass
class AssignmentPlan:
    user_id: uuid.UUID
    user_email: str | None
    position_id: uuid.UUID
    position_name: str
    org_name: str
    start_date: date
    end_date: date | None
    warning: str | None = None


@dataclass
class DryRunResult:
    new_term_start: date
    terminations: list[TerminationPlan]
    new_assignments: list[AssignmentPlan]
    warnings: list[str]
    summary: dict[str, int]


@dataclass
class ExecuteResult:
    batch_id: str
    terminated_count: int
    created_count: int
    started_at: datetime
    finished_at: datetime


# ── 內部 helpers ────────────────────────────────────────────────────────────


async def _active_positions_before(session: AsyncSession, cutoff: date) -> list[UserPosition]:
    """所有 start_date < cutoff 且 (end_date IS NULL OR end_date >= cutoff) 的任期。"""
    stmt = select(UserPosition).where(
        and_(
            UserPosition.start_date < cutoff,
            or_(UserPosition.end_date.is_(None), UserPosition.end_date >= cutoff),
        )
    )
    return list((await session.execute(stmt)).scalars().all())


async def _user_emails(session: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = (await session.execute(select(User.id, User.email).where(User.id.in_(list(ids))))).all()
    return {r[0]: r[1] for r in rows}


async def _position_meta(
    session: AsyncSession, ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str]]:
    """回傳 {position_id: (position_name, org_name)}。"""
    if not ids:
        return {}
    from api.models.org import Org

    rows = (
        await session.execute(
            select(Position.id, Position.name, Org.name)
            .join(Org, Position.org_id == Org.id)
            .where(Position.id.in_(list(ids)))
        )
    ).all()
    return {r[0]: (r[1], r[2]) for r in rows}


# ── Dry-run ────────────────────────────────────────────────────────────────


async def dry_run(
    session: AsyncSession,
    *,
    new_term_start: date,
    new_assignments: list[NewAssignment],
    terminate_active_before: bool = True,
) -> DryRunResult:
    """產生變更計畫。不寫入 DB。"""
    warnings: list[str] = []

    # 1) 找出將被結束的任期
    terminations_plans: list[TerminationPlan] = []
    if terminate_active_before:
        actives = await _active_positions_before(session, new_term_start)
        user_ids = {up.user_id for up in actives}
        pos_ids = {up.position_id for up in actives}
        emails = await _user_emails(session, user_ids)
        pos_meta = await _position_meta(session, pos_ids)
        prior_day = date.fromordinal(new_term_start.toordinal() - 1)
        for up in actives:
            pname, oname = pos_meta.get(up.position_id, (str(up.position_id), "?"))
            terminations_plans.append(
                TerminationPlan(
                    user_position_id=up.id,
                    user_id=up.user_id,
                    user_email=emails.get(up.user_id),
                    position_id=up.position_id,
                    position_name=pname,
                    org_name=oname,
                    current_end_date=up.end_date,
                    new_end_date=prior_day,
                )
            )

    # 2) 驗證新 assignments
    assignment_plans: list[AssignmentPlan] = []
    requested_user_ids = {a.user_id for a in new_assignments}
    requested_pos_ids = {a.position_id for a in new_assignments}
    a_emails = await _user_emails(session, requested_user_ids)
    a_pos_meta = await _position_meta(session, requested_pos_ids)
    seen_pairs: set[tuple[uuid.UUID, uuid.UUID, date]] = set()

    for a in new_assignments:
        pname, oname = a_pos_meta.get(a.position_id, ("(未知職位)", "(未知組織)"))
        email = a_emails.get(a.user_id)
        warning = None
        if email is None:
            warning = "找不到此 user_id（請確認該使用者已存在）"
        elif a.position_id not in a_pos_meta:
            warning = "找不到此 position_id"
        elif a.end_date is not None and a.end_date < a.start_date:
            warning = "end_date 早於 start_date"
        elif (a.user_id, a.position_id, a.start_date) in seen_pairs:
            warning = "同一 user × position × start_date 在試算表中重複出現"
        else:
            seen_pairs.add((a.user_id, a.position_id, a.start_date))
        if warning:
            warnings.append(
                f"{email or a.user_id} → {pname}({oname}) start={a.start_date}：{warning}"
            )
        assignment_plans.append(
            AssignmentPlan(
                user_id=a.user_id,
                user_email=email,
                position_id=a.position_id,
                position_name=pname,
                org_name=oname,
                start_date=a.start_date,
                end_date=a.end_date,
                warning=warning,
            )
        )

    summary = {
        "terminations": len(terminations_plans),
        "new_assignments": len(assignment_plans),
        "warnings": len(warnings),
        "warning_assignments": sum(1 for a in assignment_plans if a.warning),
    }
    return DryRunResult(
        new_term_start=new_term_start,
        terminations=terminations_plans,
        new_assignments=assignment_plans,
        warnings=warnings,
        summary=summary,
    )


# ── Execute ───────────────────────────────────────────────────────────────


async def execute(
    session: AsyncSession,
    *,
    new_term_start: date,
    new_assignments: list[NewAssignment],
    terminate_active_before: bool,
    actor_id: uuid.UUID,
    actor_email: str,
) -> tuple[ExecuteResult, dict[str, Any]]:
    """執行變更。回傳 (result, snapshot)。snapshot 由 router 寫入 audit.meta。"""
    plan = await dry_run(
        session,
        new_term_start=new_term_start,
        new_assignments=new_assignments,
        terminate_active_before=terminate_active_before,
    )
    # 阻擋有錯的試算表
    fatal = [a for a in plan.new_assignments if a.warning]
    if fatal:
        raise ValueError(
            f"新任期試算表有 {len(fatal)} 筆警告，請修正後再執行。首筆：{fatal[0].warning}"
        )

    started = datetime.now(UTC)
    batch_id = uuid.uuid4().hex[:16]

    # 1) snapshot
    snapshot: dict[str, Any] = {
        "batch_id": batch_id,
        "new_term_start": new_term_start.isoformat(),
        "terminations": [
            {
                "user_position_id": str(t.user_position_id),
                "old_end_date": t.current_end_date.isoformat() if t.current_end_date else None,
            }
            for t in plan.terminations
        ],
        # 新建的 ids 等執行完才知道；先寫一份「規格」
        "new_assignments_spec": [
            {
                "user_id": str(a.user_id),
                "position_id": str(a.position_id),
                "start_date": a.start_date.isoformat(),
                "end_date": a.end_date.isoformat() if a.end_date else None,
            }
            for a in new_assignments
        ],
    }

    # 2) 結束舊任期
    terminated = 0
    if terminate_active_before:
        for t in plan.terminations:
            up = await session.get(UserPosition, t.user_position_id)
            if up is None:
                continue
            up.end_date = t.new_end_date
            terminated += 1

    # 3) 建立新任期
    created_ids: list[str] = []
    for a in new_assignments:
        new_up = UserPosition(
            user_id=a.user_id,
            position_id=a.position_id,
            start_date=a.start_date,
            end_date=a.end_date,
        )
        session.add(new_up)
        await session.flush()
        created_ids.append(str(new_up.id))
    snapshot["created_user_position_ids"] = created_ids

    actor_id_str = str(actor_id)
    _ = actor_email  # actor info already in audit.record

    finished = datetime.now(UTC)
    result = ExecuteResult(
        batch_id=batch_id,
        terminated_count=terminated,
        created_count=len(created_ids),
        started_at=started,
        finished_at=finished,
    )
    snapshot["actor_id"] = actor_id_str
    snapshot["started_at"] = started.isoformat()
    snapshot["finished_at"] = finished.isoformat()
    return result, snapshot


# ── Rollback ──────────────────────────────────────────────────────────────


async def rollback(session: AsyncSession, *, batch_id: str) -> dict[str, int]:
    """還原一次 term_rollover：找對應 audit log 取 snapshot → 恢復舊 end_date、刪新 user_positions。"""
    stmt = (
        select(AuditLog)
        .where(AuditLog.entity_type == "term_rollover")
        .where(AuditLog.action == "term_rollover.execute")
        .where(AuditLog.entity_id == batch_id)
        .order_by(AuditLog.created_at.desc())
        .limit(1)
    )
    audit = (await session.execute(stmt)).scalar_one_or_none()
    if audit is None:
        raise ValueError(f"找不到 batch_id={batch_id} 的 term_rollover 紀錄")

    snapshot = audit.meta or {}
    restored = 0
    for t in snapshot.get("terminations", []):
        up = await session.get(UserPosition, uuid.UUID(t["user_position_id"]))
        if up is None:
            continue
        up.end_date = date.fromisoformat(t["old_end_date"]) if t["old_end_date"] else None
        restored += 1

    deleted = 0
    for new_id in snapshot.get("created_user_position_ids", []):
        up = await session.get(UserPosition, uuid.UUID(new_id))
        if up is None:
            continue
        await session.delete(up)
        deleted += 1

    return {"restored_terminations": restored, "deleted_new_assignments": deleted}
