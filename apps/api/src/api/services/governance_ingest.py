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
from api.models.user import User
from api.models.work_item import WorkItem, WorkItemStatus
from api.services import governance as governance_svc
from api.services import governance_events
from api.services import work_item as work_item_svc
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
    "order": "商品訂單",
    "meal_order": "學餐訂單",
    "meal_schedule": "學餐結單",
    "org": "組織",
    "publication": "發布",
    "calendar_event": "行事曆",
    "exam_paper": "試卷",
    "receivable": "收款",
    "vote": "投票",
    "ticket": "售票",
    "user": "使用者",
    "person": "人員",
    "position": "職位",
    "school_class": "班級",
    "product": "商品",
    "meal_vendor": "餐商",
    "partner_business": "特約商家",
    "email_message": "郵件",
    "document_template": "公文範本",
    "serial_template": "字號模板",
    "webhook": "Webhook",
    "api_key": "API Key",
    "feature_flag": "功能旗標",
    "policy": "政策文件",
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
    "create_relation": "建立跨模組關聯",
    "create_calendar_event": "建立行事曆事件",
    "create_document_draft": "建立公文草稿",
    "create_meeting": "建立會議",
    "create_announcement": "建立公告草稿",
    "create_survey": "建立問卷",
    "set_matter_status": "變更事情狀態",
    "notify_admins": "通知管理員",
}


def _as_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


async def _link_created_artifact(
    db: AsyncSession,
    *,
    matter: Matter,
    actor_id: uuid.UUID | None,
    target_type: str,
    target_id: uuid.UUID,
    title: str,
    href: str,
    context: dict,
) -> None:
    db.add(
        EntityRelation(
            matter_id=matter.id,
            source_type=str(context.get("source_type") or "matter"),
            source_id=(
                uuid.UUID(str(context["source_id"])) if context.get("source_id") else matter.id
            ),
            target_type=target_type,
            target_id=target_id,
            relation="produces",
            title=title,
            href=href,
            note="由跨模組自動化建立",
            created_by_id=actor_id,
            meta={"origin": "automation", "trigger": context.get("event_type")},
        )
    )
    await db.flush()


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


async def create_meeting_decision_outputs(
    db: AsyncSession,
    *,
    meeting,
    decision,
    actor,
    create_follow_up: bool,
    follow_up_assignee_id: uuid.UUID | None,
    follow_up_due_at: datetime | None,
    create_document_draft: bool,
) -> uuid.UUID | None:
    """把正式會議決議轉成待辦、行事曆期限與可選的公文草稿。"""
    if create_follow_up:
        existing = await db.scalar(
            select(WorkItem.id).where(
                WorkItem.source_type == "meeting_decision",
                WorkItem.source_id == decision.id,
                WorkItem.is_active.is_(True),
            )
        )
        if existing is None:
            from api.schemas.work_item import WorkItemCreate

            await work_item_svc.create_work_item(
                db,
                data=WorkItemCreate(
                    title=f"執行決議：{decision.title}",
                    description=decision.content,
                    assigned_to_id=follow_up_assignee_id or actor.id,
                    source_type="meeting_decision",
                    source_id=decision.id,
                    due_at=follow_up_due_at,
                ),
                created_by_id=actor.id,
            )

    if not create_document_draft:
        return None

    from api.models.document import DocumentCategory
    from api.schemas.document import DocumentCreate
    from api.services import document as document_svc

    document = await document_svc.create_document(
        db,
        data=DocumentCreate(
            title=f"{decision.title}執行公文",
            org_id=meeting.org_id,
            category=DocumentCategory.LETTER,
            subject=f"檢送「{decision.title}」決議事項，請依決議內容辦理。",
            doc_description=(
                f"本案依「{meeting.title}」正式決議辦理。\n\n決議內容：{decision.content}"
            ),
            action_required="請承辦人確認受文者、完成公文內容並送交簽核。",
            content=f"## 決議依據\n\n{decision.content}",
            handler_name=actor.display_name,
            handler_email=actor.email,
            due_date=follow_up_due_at,
        ),
        created_by=actor.id,
    )

    matter_ids = await _linked_matter_ids(db, "meeting", meeting.id)
    for matter_id in matter_ids:
        db.add(
            EntityRelation(
                matter_id=matter_id,
                source_type="meeting_decision",
                source_id=decision.id,
                target_type="document",
                target_id=document.id,
                relation="produces",
                title=document.title,
                href=f"/documents/{document.id}",
                note="由會議決議自動建立的公文草稿",
                created_by_id=actor.id,
                meta={"origin": "meeting_decision"},
            )
        )
    await db.flush()
    return document.id


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
            if not await _has_decision_for_source(db, matter_id, "meeting_decision", source_uuid):
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
            source_id=(uuid.UUID(str(context["source_id"])) if context.get("source_id") else None),
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

    elif action_type == "create_relation":
        target_id = _render(action.get("target_id"), context)
        target_type = _render(action.get("target_type"), context)
        if target_id and target_type:
            db.add(
                EntityRelation(
                    matter_id=matter.id,
                    source_type=str(context.get("source_type") or "matter"),
                    source_id=(
                        uuid.UUID(str(context["source_id"]))
                        if context.get("source_id")
                        else matter.id
                    ),
                    target_type=target_type,
                    target_id=uuid.UUID(target_id),
                    relation=str(action.get("relation") or "related"),
                    title=_render(action.get("title"), context)
                    or context.get("title")
                    or target_type,
                    href=_render(action.get("href"), context),
                    note=_render(action.get("note"), context),
                    created_by_id=actor_id,
                    meta={"origin": "automation"},
                )
            )
            await db.flush()

    elif action_type == "create_calendar_event" and actor_id is not None:
        from api.models.calendar import (
            CalendarEvent,
            CalendarEventStatus,
            CalendarEventType,
            CalendarVisibility,
        )

        starts_at = _as_datetime(
            _render(action.get("starts_at"), context)
            or context.get("due_at")
            or context.get("starts_at")
        )
        if starts_at is not None:
            event = CalendarEvent(
                org_id=matter.org_id,
                title=_render(action.get("title"), context) or context.get("title") or "治理行程",
                description=_render(action.get("description"), context),
                event_type=CalendarEventType(
                    str(action.get("event_type") or CalendarEventType.DEADLINE)
                ),
                status=CalendarEventStatus.CONFIRMED,
                visibility=CalendarVisibility.ORG,
                starts_at=starts_at,
                ends_at=_as_datetime(_render(action.get("ends_at"), context)),
                href=f"/governance/{matter.id}",
                created_by=actor_id,
                updated_by=actor_id,
            )
            db.add(event)
            await db.flush()
            await _link_created_artifact(
                db,
                matter=matter,
                actor_id=actor_id,
                target_type="calendar_event",
                target_id=event.id,
                title=event.title,
                href="/calendar",
                context=context,
            )

    elif action_type in {
        "create_document_draft",
        "create_meeting",
        "create_announcement",
        "create_survey",
    }:
        actor = await db.get(User, actor_id) if actor_id else None
        if actor is None or matter.org_id is None:
            return matter
        artifact_title = (
            _render(action.get("title"), context) or context.get("title") or matter.title
        )
        if action_type == "create_document_draft":
            from api.models.document import DocumentCategory
            from api.schemas.document import DocumentCreate
            from api.services import document as document_svc

            artifact = await document_svc.create_document(
                db,
                data=DocumentCreate(
                    title=artifact_title,
                    org_id=matter.org_id,
                    category=DocumentCategory.LETTER,
                    subject=(
                        _render(action.get("subject"), context)
                        or f"檢送「{artifact_title}」相關事項，請查照辦理。"
                    ),
                    doc_description=_render(action.get("description"), context)
                    or context.get("summary"),
                    action_required=_render(action.get("action_required"), context)
                    or "請承辦人確認內容、受文者並送交簽核。",
                    content=_render(action.get("content"), context) or context.get("summary") or "",
                    handler_name=actor.display_name,
                    handler_email=actor.email,
                    due_date=_as_datetime(context.get("due_at")),
                ),
                created_by=actor.id,
            )
            target_type, href = "document", f"/documents/{artifact.id}"
        elif action_type == "create_meeting":
            from api.schemas.meeting import MeetingCreate
            from api.services import meeting as meeting_svc

            artifact = await meeting_svc.create_meeting(
                db,
                data=MeetingCreate(
                    title=artifact_title,
                    org_id=matter.org_id,
                    starts_at=_as_datetime(
                        _render(action.get("starts_at"), context) or context.get("starts_at")
                    ),
                ),
                created_by=actor.id,
            )
            target_type, href = "meeting", f"/meetings/{artifact.id}"
        elif action_type == "create_announcement":
            from api.schemas.announcement import AnnouncementCreate
            from api.services import announcement as announcement_svc

            artifact = await announcement_svc.create(
                db,
                author=actor,
                body=AnnouncementCreate(
                    title=artifact_title,
                    content={"body": _render(action.get("content"), context) or ""},
                    org_id=matter.org_id,
                ),
            )
            target_type, href = "announcement", f"/announcements/{artifact.id}"
        else:
            from api.schemas.survey import SurveyCreate
            from api.services import survey as survey_svc

            artifact = await survey_svc.create_survey(
                db,
                data=SurveyCreate(title=artifact_title, org_id=matter.org_id),
                created_by=actor.id,
            )
            target_type, href = "survey", f"/surveys/{artifact.id}"
        await _link_created_artifact(
            db,
            matter=matter,
            actor_id=actor.id,
            target_type=target_type,
            target_id=artifact.id,
            title=artifact_title,
            href=href,
            context=context,
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
        from api.services.governance_discord import emit_matter_event

        await emit_matter_event(
            db,
            matter_id=matter_id,
            event_type=event_type,
            title=event_title,
            body=summary,
            href=href,
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
