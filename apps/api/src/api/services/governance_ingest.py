"""治理中樞事件匯流與自動化引擎。

設計原則（與 memory 對齊）：

* **同事務同步匯流**：模組（會議/陳情/公告/活動…）發生事件時，於 *同一個* DB
  事務內把資料「長進」對應的 Matter，使治理中樞成為真實狀態的鏡子，而非要人手動
  再抄一遍的平行副本。即時、原子，不依賴常駐 celery（4GB VPS celery 非常駐）。
* **失敗隔離（fail-soft）**：治理匯流是「附帶效果」，絕不可拖垮宿主動作（建立會議
  決議不能因為治理出錯而失敗）。呼叫端一律用 :func:`safe_ingest`，內部以 savepoint
  包住，治理錯誤只回滾治理部分並記 log。
* **通知走 outbox**：重量級/外部通知（email/discord/inbox fan-out）emit 到既有
  outbox，由 celery beat 非同步派送，治理引擎本身只做便宜的 DB 寫入。
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.governance import (
    AutomationRule,
    AutomationRuleStatus,
    CaseStatus,
    Decision,
    DecisionStatus,
    EntityRelation,
    GovernanceCase,
    Matter,
    MatterStatus,
    MatterType,
)
from api.models.work_item import WorkItem, WorkItemStatus
from api.services import governance as governance_svc
from api.services import governance_events
from api.services.outbox import emit

logger = logging.getLogger(__name__)

# 平台各模組對應的關聯實體型別（與前端 GovernanceLinkPanel 的 ENTITY_LABEL 對齊）。
ENTITY_LABEL: dict[str, str] = {
    "matter": "事情",
    "case": "案件",
    "document": "公文",
    "meeting": "會議",
    "meeting_decision": "會議決議",
    "announcement": "公告",
    "survey": "問卷",
    "activity": "活動",
    "regulation": "法規",
    "petition": "陳情",
    "judicial_petition": "評議",
    "council_proposal": "議會提案",
    "order": "校商訂單",
    "meal_order": "學餐訂單",
    "meal_schedule": "學餐結單",
    "org": "組織",
    "publication": "發布",
    "calendar_event": "行事曆",
    "exam_paper": "試卷",
    "receivable": "收款",
    "vote": "投票",
    "ticket": "售票",
}

# 可作為自動化觸發點的事件型別（trigger_type）。前端規則編輯器也使用此清單。
# 基礎事件 + 由 governance_events 登錄表自動衍生的全模組事件。
TRIGGER_TYPES: dict[str, str] = {
    "manual": "手動",
    "petition.created": "陳情建立",
    "meeting.decision_created": "會議產生決議",
    "announcement.published": "公告發布",
    "activity.created": "活動建立",
    "activity.completed": "活動結束",
    "matter.status_changed": "事情狀態變更",
    **governance_events.trigger_labels(),
}

# 自動化動作型別（action.type）。
ACTION_TYPES: dict[str, str] = {
    "create_matter": "建立事情",
    "create_case": "建立案件",
    "create_task": "建立任務",
    "create_decision": "建立決議",
    "create_timeline_event": "新增時間軸紀錄",
    "set_matter_status": "變更事情狀態",
    "notify_admins": "通知管理員",
}


def _render(template: str | None, context: dict) -> str | None:
    """以 ``{key}`` 樣板套用 context；缺鍵時保留原樣，永不丟例外。"""
    if not template:
        return template
    try:
        return template.format_map(_SafeDict(context))
    except Exception:  # pragma: no cover - 樣板永遠 fail-soft
        return template


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:  # noqa: D401 - 樣板缺鍵保留原樣
        return "{" + key + "}"


async def _linked_matter_ids(
    db: AsyncSession, source_type: str, source_id: uuid.UUID
) -> list[uuid.UUID]:
    """找出已把某模組資源（target_type/target_id）納入的所有 Matter。"""
    rows = await db.execute(
        select(EntityRelation.matter_id).where(
            EntityRelation.target_type == source_type,
            EntityRelation.target_id == source_id,
            EntityRelation.matter_id.is_not(None),
        )
    )
    seen: list[uuid.UUID] = []
    for (matter_id,) in rows.all():
        if matter_id is not None and matter_id not in seen:
            seen.append(matter_id)
    return seen


async def _has_decision_for_source(
    db: AsyncSession, matter_id: uuid.UUID, source_type: str, source_id: uuid.UUID
) -> bool:
    existing = await db.scalar(
        select(Decision.id).where(
            Decision.matter_id == matter_id,
            Decision.source_type == source_type,
            Decision.source_id == source_id,
        )
    )
    return existing is not None


async def _materialize_for_matter(
    db: AsyncSession,
    *,
    matter_id: uuid.UUID,
    event_type: str,
    actor_id: uuid.UUID | None,
    actor_email: str | None,
    title: str,
    href: str | None,
    summary: str | None,
    payload: dict,
) -> None:
    """把模組事件「長成」Matter 內的衍生資料（決議/時間軸）。"""
    # 1) 一律寫入時間軸，讓治理中樞反映真實模組活動。
    await governance_svc.record_event(
        db,
        matter_id=matter_id,
        event_type=event_type,
        title=title,
        actor_id=actor_id,
        actor_email=actor_email,
        body=summary,
        payload=payload,
    )

    # 2) 會議決議 → 自動在事情的「決議追蹤」長出一筆（避免重複）。
    if event_type == "meeting.decision_created":
        source_id = payload.get("decision_id")
        if source_id:
            source_uuid = uuid.UUID(str(source_id))
            if not await _has_decision_for_source(
                db, matter_id, "meeting_decision", source_uuid
            ):
                decision = Decision(
                    matter_id=matter_id,
                    source_type="meeting_decision",
                    source_id=source_uuid,
                    title=payload.get("title") or title,
                    content=summary or payload.get("content") or title,
                    status=DecisionStatus.PENDING,
                    created_by_id=actor_id,
                    meta={"meeting_id": payload.get("meeting_id"), "origin": "ingest"},
                )
                db.add(decision)
                await db.flush()


def _conditions_match(conditions: dict, payload: dict, matter: Matter | None) -> bool:
    """規則條件比對：conditions 內每個鍵都需與 payload/matter 相符（簡單等值）。"""
    if not conditions:
        return True
    for key, expected in conditions.items():
        if key == "matter_type":
            if matter is None or str(matter.matter_type) != str(expected):
                return False
            continue
        if str(payload.get(key)) != str(expected):
            return False
    return True


async def _exec_action(
    db: AsyncSession,
    *,
    action: dict,
    matter: Matter | None,
    actor_id: uuid.UUID | None,
    actor_email: str | None,
    context: dict,
) -> Matter | None:
    """執行單一自動化動作。回傳（可能新建的）Matter 以供後續動作接續使用。"""
    action_type = str(action.get("type") or "").strip()

    if action_type == "create_matter":
        matter = Matter(
            title=_render(action.get("title"), context) or context.get("title") or "自動建立事情",
            matter_type=str(action.get("matter_type") or MatterType.ADMINISTRATION),
            description=_render(action.get("description"), context),
            priority=str(action.get("priority") or "normal"),
            status=MatterStatus.ACTIVE,
            created_by_id=actor_id,
            meta={"origin": "automation", "trigger": context.get("event_type")},
        )
        db.add(matter)
        await db.flush()
        await governance_svc.record_event(
            db,
            matter_id=matter.id,
            event_type="automation",
            title=f"自動建立事情：{matter.title}",
            actor_id=actor_id,
            actor_email=actor_email,
            payload={"source_type": context.get("source_type")},
        )
        # 把來源模組資源關聯進新事情，維持單一真實來源。
        if context.get("source_type") and context.get("source_id"):
            db.add(
                EntityRelation(
                    matter_id=matter.id,
                    source_type="matter",
                    source_id=matter.id,
                    target_type=str(context["source_type"]),
                    target_id=uuid.UUID(str(context["source_id"])),
                    relation="includes",
                    title=context.get("title") or matter.title,
                    href=context.get("href"),
                    note="由自動化規則建立關聯",
                    created_by_id=actor_id,
                    meta={"origin": "automation"},
                )
            )
            await db.flush()
        return matter

    if matter is None:
        # 其餘動作都需要一個目標事情，沒有就略過（fail-soft）。
        return matter

    if action_type == "create_case":
        case = GovernanceCase(
            matter_id=matter.id,
            title=_render(action.get("title"), context) or "自動建立案件",
            case_type=str(action.get("case_type") or "general"),
            description=_render(action.get("description"), context),
            status=CaseStatus.TODO,
        )
        db.add(case)
        await db.flush()
        await governance_svc.record_event(
            db,
            matter_id=matter.id,
            case_id=case.id,
            event_type="automation",
            title=f"自動建立案件：{case.title}",
            actor_id=actor_id,
            actor_email=actor_email,
        )

    elif action_type == "create_task":
        item = WorkItem(
            title=_render(action.get("title"), context) or "自動建立任務",
            description=_render(action.get("description"), context),
            source_type="matter",
            source_id=matter.id,
            status=WorkItemStatus.OPEN,
            created_by_id=actor_id,
        )
        db.add(item)
        await db.flush()
        await governance_svc.record_event(
            db,
            matter_id=matter.id,
            event_type="automation",
            title=f"自動建立任務：{item.title}",
            actor_id=actor_id,
            actor_email=actor_email,
            payload={"work_item_id": str(item.id)},
        )

    elif action_type == "create_decision":
        decision = Decision(
            matter_id=matter.id,
            title=_render(action.get("title"), context) or "自動建立決議",
            content=_render(action.get("content"), context) or context.get("title") or "—",
            status=DecisionStatus.PENDING,
            source_type=context.get("source_type"),
            source_id=(
                uuid.UUID(str(context["source_id"])) if context.get("source_id") else None
            ),
            created_by_id=actor_id,
            meta={"origin": "automation"},
        )
        db.add(decision)
        await db.flush()

    elif action_type == "create_timeline_event":
        await governance_svc.record_event(
            db,
            matter_id=matter.id,
            event_type="automation",
            title=_render(action.get("title"), context) or "自動化紀錄",
            body=_render(action.get("body"), context),
            actor_id=actor_id,
            actor_email=actor_email,
        )

    elif action_type == "set_matter_status":
        new_status = str(action.get("status") or "")
        if new_status in set(MatterStatus):
            matter.status = new_status

    elif action_type == "notify_admins":
        await emit(
            db,
            event_type="admin.notification",
            payload={
                "title": _render(action.get("title"), context) or "治理自動化通知",
                "body": _render(action.get("body"), context) or context.get("title") or "",
                "link": context.get("href") or f"/governance/{matter.id}",
            },
        )

    return matter


async def run_automation(
    db: AsyncSession,
    *,
    event_type: str,
    actor_id: uuid.UUID | None,
    actor_email: str | None,
    matter_ids: list[uuid.UUID],
    context: dict,
) -> int:
    """比對並執行符合此事件的自動化規則，回傳觸發的規則數。"""
    rows = await db.execute(
        select(AutomationRule).where(
            AutomationRule.status == AutomationRuleStatus.ACTIVE,
            AutomationRule.trigger_type == event_type,
        )
    )
    rules = list(rows.scalars().all())
    if not rules:
        return 0

    fired = 0
    for rule in rules:
        # 規則綁定特定事情時只對該事情生效；未綁定（全域）規則對所有連動事情生效，
        # 若事件沒有連動任何事情則允許新建（matter=None，由 create_matter 動作補上）。
        if rule.matter_id is not None:
            targets: list[uuid.UUID | None] = [rule.matter_id]
        elif matter_ids:
            targets = list(matter_ids)
        else:
            targets = [None]

        rule_fired = False
        for target_id in targets:
            matter = await db.get(Matter, target_id) if target_id else None
            if not _conditions_match(rule.conditions or {}, context, matter):
                continue
            for action in rule.actions or []:
                matter = await _exec_action(
                    db,
                    action=action,
                    matter=matter,
                    actor_id=actor_id,
                    actor_email=actor_email,
                    context=context,
                )
            rule_fired = True

        if rule_fired:
            rule.last_triggered_at = datetime.now(UTC)
            rule.trigger_count = (rule.trigger_count or 0) + 1
            fired += 1

    if fired:
        await db.flush()
    return fired


async def ingest(
    db: AsyncSession,
    *,
    event_type: str,
    actor_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    source_type: str | None = None,
    source_id: uuid.UUID | None = None,
    title: str = "",
    href: str | None = None,
    summary: str | None = None,
    payload: dict | None = None,
) -> None:
    """治理匯流主入口：把模組事件灌入連動的 Matter，並觸發自動化規則。"""
    payload = dict(payload or {})
    matter_ids: list[uuid.UUID] = []
    if source_type and source_id:
        matter_ids = await _linked_matter_ids(db, source_type, source_id)

    label = ENTITY_LABEL.get(source_type or "", source_type or "事件")
    event_title = title or f"{label}事件"

    for matter_id in matter_ids:
        await _materialize_for_matter(
            db,
            matter_id=matter_id,
            event_type=event_type,
            actor_id=actor_id,
            actor_email=actor_email,
            title=event_title,
            href=href,
            summary=summary,
            payload={**payload, "source_type": source_type, "source_id": str(source_id)},
        )

    context = {
        "event_type": event_type,
        "source_type": source_type,
        "source_id": str(source_id) if source_id else None,
        "title": title,
        "href": href,
        "summary": summary,
        **payload,
    }
    await run_automation(
        db,
        event_type=event_type,
        actor_id=actor_id,
        actor_email=actor_email,
        matter_ids=matter_ids,
        context=context,
    )


async def safe_ingest(db: AsyncSession, **kwargs) -> None:
    """以 savepoint 包住 :func:`ingest`，治理錯誤絕不拖垮宿主動作。"""
    try:
        async with db.begin_nested():
            await ingest(db, **kwargs)
    except Exception as exc:  # pragma: no cover - fail-soft 防護
        logger.warning("governance ingest failed for %s: %s", kwargs.get("event_type"), exc)
