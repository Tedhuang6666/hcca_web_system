"""治理事件登錄表：把既有 audit 事件對應到治理中樞的領域事件。

`audit_svc.record()` 已在全平台幾乎每個狀態變化被呼叫。與其在 20+ 個 router
手寫 `governance_ingest.safe_ingest()`，不如在 audit 這條既有「事件總線」末端做
一次橋接（見 audit.record）。本檔是該橋接的唯一設定來源：

* `GOVERNANCE_EVENT_MAP`：`(audit entity_type, audit action) -> EventSpec`，只收錄
  「治理中樞會關心的生命週期事件」（建立/送審/核准/公布/結案/決議/轉場/完成…），
  刻意排除純平台管理動作（discord/site/serial/permission/defense…）以免時間軸灌爆。
* `source_type`：正規化後的實體型別，必須與 `GovernanceLinkPanel` 建立 EntityRelation
  時用的 `target_type` 一致，否則反查連動事情會對不上（例：audit 的
  `petition_case` 要正規化成 `petition`）。
* `ENTITY_HREF`：由正規化 source_type 產生模組詳情頁連結。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import NamedTuple


class EventSpec(NamedTuple):
    event_type: str  # 治理領域事件型別，例如 "document.approved"
    source_type: str  # 正規化實體型別，需與 EntityRelation.target_type 一致
    label: str  # 人類可讀標籤（供觸發型別清單）


# (audit entity_type, audit action) -> EventSpec
GOVERNANCE_EVENT_MAP: dict[tuple[str, str], EventSpec] = {
    # ── 公文 ───────────────────────────────────────────────
    ("document", "create"): EventSpec("document.created", "document", "公文建立"),
    ("document", "document.create_from_template"): EventSpec(
        "document.created", "document", "公文建立"
    ),
    ("document", "approve"): EventSpec("document.approved", "document", "公文核准"),
    ("document", "reject"): EventSpec("document.rejected", "document", "公文退件"),
    ("document", "archive"): EventSpec("document.archived", "document", "公文歸檔"),
    ("document", "batch.approve"): EventSpec("document.approved", "document", "公文核准"),
    ("document", "batch.reject"): EventSpec("document.rejected", "document", "公文退件"),
    ("document", "batch.archive"): EventSpec("document.archived", "document", "公文歸檔"),
    # ── 會議 ───────────────────────────────────────────────
    ("meeting", "meeting.create"): EventSpec("meeting.created", "meeting", "會議建立"),
    ("meeting", "meeting.confirm"): EventSpec("meeting.confirmed", "meeting", "會議紀錄定案"),
    # ── 法規 ───────────────────────────────────────────────
    ("regulation", "regulation.create"): EventSpec("regulation.created", "regulation", "法規建立"),
    ("regulation", "regulation.publish"): EventSpec(
        "regulation.published", "regulation", "法規公布"
    ),
    ("regulation", "regulation.workflow_published"): EventSpec(
        "regulation.published", "regulation", "法規公布"
    ),
    ("regulation", "regulation.archive"): EventSpec(
        "regulation.archived", "regulation", "法規停用"
    ),
    ("regulation", "regulation.repeal"): EventSpec("regulation.repealed", "regulation", "法規廢止"),
    ("regulation", "regulation.advance_via_meeting"): EventSpec(
        "regulation.advanced", "regulation", "法規進度推進"
    ),
    # ── 問卷 ───────────────────────────────────────────────
    ("survey", "survey.create"): EventSpec("survey.created", "survey", "問卷建立"),
    ("survey", "survey.open"): EventSpec("survey.opened", "survey", "問卷開放"),
    ("survey", "survey.close"): EventSpec("survey.closed", "survey", "問卷結束"),
    # ── 陳情（audit entity_type=petition_case → 正規化 petition）──
    ("petition_case", "petition.create"): EventSpec("petition.created", "petition", "陳情建立"),
    # ── 評議 ───────────────────────────────────────────────
    ("judicial_petition", "judicial_petition.create"): EventSpec(
        "judicial.created", "judicial_petition", "評議提出"
    ),
    ("judicial_petition", "judicial_petition.status"): EventSpec(
        "judicial.status_changed", "judicial_petition", "評議狀態變更"
    ),
    # ── 議會提案 ───────────────────────────────────────────
    ("council_proposal", "council_proposal.create"): EventSpec(
        "proposal.created", "council_proposal", "提案提出"
    ),
    ("council_proposal", "council_proposal.schedule"): EventSpec(
        "proposal.scheduled", "council_proposal", "提案排入議程"
    ),
    ("council_proposal", "council_proposal.status"): EventSpec(
        "proposal.status_changed", "council_proposal", "提案狀態變更"
    ),
    # ── 活動 ───────────────────────────────────────────────
    ("activity", "activity.create"): EventSpec("activity.created", "activity", "活動建立"),
    ("activity", "activity.archive"): EventSpec("activity.archived", "activity", "活動歸檔"),
    # ── 公告 ───────────────────────────────────────────────
    ("announcement", "announcement.create"): EventSpec(
        "announcement.created", "announcement", "公告建立"
    ),
    ("announcement", "announcement.publish"): EventSpec(
        "announcement.published", "announcement", "公告發布"
    ),
    # ── 商品訂單 ───────────────────────────────────────────
    ("order", "shop.order_create"): EventSpec("order.created", "order", "訂單成立"),
    ("order", "shop.order_payment"): EventSpec("order.paid", "order", "訂單付款"),
    ("order", "shop.order_cancel"): EventSpec("order.canceled", "order", "訂單取消"),
    # ── 學餐 ───────────────────────────────────────────────
    ("meal_order", "meal.order_create"): EventSpec("order.created", "meal_order", "訂單成立"),
    ("meal_order", "meal.order_confirm"): EventSpec("order.confirmed", "meal_order", "訂單確認"),
    ("meal_order", "meal.order_complete"): EventSpec("order.completed", "meal_order", "訂單完成"),
    ("meal_schedule", "meal.schedule_close"): EventSpec(
        "meal.schedule_closed", "meal_schedule", "學餐結單"
    ),
    # ── 組織 / 發布 / 行事曆 / 試卷 / 收款 ──────────────────
    ("org", "org.create"): EventSpec("org.created", "org", "組織建立"),
    ("publication", "publication.send"): EventSpec("publication.sent", "publication", "發布送出"),
    ("calendar_event", "calendar.create"): EventSpec(
        "calendar.event_created", "calendar_event", "行事曆建立"
    ),
    ("exam_paper", "exam_paper.create"): EventSpec("exam.paper_created", "exam_paper", "試卷上傳"),
    ("receivable", "receivable.mark_paid"): EventSpec("receivable.paid", "receivable", "收款入帳"),
}


# 正規化 source_type → 模組詳情頁 href 產生器。list-only 模組連到列表頁。
ENTITY_HREF: dict[str, Callable[[str], str]] = {
    "document": lambda i: f"/documents/{i}",
    "meeting": lambda i: f"/meetings/{i}",
    "regulation": lambda i: f"/regulations/{i}",
    "survey": lambda i: f"/surveys/{i}",
    "petition": lambda i: f"/petitions/{i}",
    "judicial_petition": lambda i: "/judicial-petitions",
    "council_proposal": lambda i: "/council-proposals",
    "activity": lambda i: f"/activities/{i}",
    "announcement": lambda i: f"/announcements/{i}",
    "order": lambda i: f"/shop/orders/{i}",
    "meal_order": lambda i: "/meal/orders",
    "meal_schedule": lambda i: "/meal",
    "org": lambda i: f"/orgs/{i}",
    "publication": lambda i: "/publications",
    "calendar_event": lambda i: "/calendar",
    "exam_paper": lambda i: "/exam-papers",
    "receivable": lambda i: "/finance/receivables",
    "election": lambda i: f"/admin/elections/{i}/count",
    "vote": lambda i: "/meetings",
    "ticket": lambda i: "/shop",
    "work_item": lambda i: "/tasks",
    "email_message": lambda i: "/email/logs",
    "webhook": lambda i: "/admin/webhooks",
    "api_key": lambda i: "/admin/api-keys",
    "policy": lambda i: "/admin/policies",
    "user": lambda i: f"/admin/people?user={i}",
    "person": lambda i: f"/admin/people?person={i}",
    "position": lambda i: "/admin/permissions",
    "school_class": lambda i: "/admin/classes",
    "product": lambda i: "/shop/admin",
    "meal_vendor": lambda i: "/meal/vendor",
    "partner_business": lambda i: "/partner-map/admin",
    "document_template": lambda i: "/document-templates",
    "serial_template": lambda i: "/serial-templates",
    "feature_flag": lambda i: "/admin/feature-flags",
}

ENTITY_LABELS: dict[str, str] = {
    "document": "公文",
    "meeting": "會議",
    "regulation": "法規",
    "survey": "問卷",
    "petition": "陳情",
    "judicial_petition": "評議",
    "council_proposal": "議會提案",
    "activity": "活動",
    "announcement": "公告",
    "order": "商品訂單",
    "meal_order": "學餐訂單",
    "meal_schedule": "學餐排程",
    "org": "組織",
    "publication": "發布",
    "calendar_event": "行事曆",
    "exam_paper": "試卷",
    "receivable": "收款",
    "election": "選舉",
    "vote": "投票",
    "ticket": "售票",
    "work_item": "待辦",
    "email_message": "郵件",
    "webhook": "Webhook",
    "api_key": "API Key",
    "policy": "政策文件",
    "user": "使用者",
    "person": "人員",
    "position": "職位",
    "school_class": "班級",
    "product": "商品",
    "meal_vendor": "餐商",
    "partner_business": "特約商家",
    "document_template": "公文範本",
    "serial_template": "字號模板",
    "feature_flag": "功能旗標",
}

ENTITY_TYPE_ALIASES = {
    "petition_case": "petition",
    "shop_order": "order",
}


def lookup(entity_type: str, action: str) -> EventSpec | None:
    explicit = GOVERNANCE_EVENT_MAP.get((entity_type, action))
    if explicit is not None:
        return explicit
    source_type = ENTITY_TYPE_ALIASES.get(entity_type, entity_type)
    label = ENTITY_LABELS.get(source_type)
    if label is None:
        return None
    event_type = action if "." in action else f"{source_type}.{action}"
    return EventSpec(event_type, source_type, f"{label}：{action}")


def href_for(source_type: str, entity_id: str) -> str | None:
    builder = ENTITY_HREF.get(source_type)
    return builder(entity_id) if builder else None


def trigger_labels() -> dict[str, str]:
    """所有領域事件型別 → 標籤（供 governance_ingest.TRIGGER_TYPES 合併）。"""
    return {spec.event_type: spec.label for spec in GOVERNANCE_EVENT_MAP.values()}
