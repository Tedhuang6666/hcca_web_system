"""待辦與儀表板優先級演算法。

此模組只做即時計分，不保存個人化狀態；分數設計偏保守，讓時間壓力與流程阻塞
永遠高於使用偏好類因素。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

from api.schemas.dashboard import DashboardWidget
from api.schemas.task import TaskItem


class PrioritizedItem(Protocol):
    priority_score: int
    priority_reasons: list[str]
    recommended_action: str | None


MODULE_IMPACT_WEIGHT = {
    "document": 20,
    "regulation": 24,
    "petition": 18,
    "meeting": 18,
    "announcement": 14,
    "calendar": 12,
    "work_item": 12,
    "meal": 16,
    "shop": 16,
    "survey": 10,
}

ACTION_BLOCKING_WEIGHT = {
    "publish": 36,
    "approve": 32,
    "review": 24,
    "reply": 22,
    "manage": 20,
    "prepare": 16,
    "attend": 14,
    "complete": 12,
    "fill": 8,
}

ACTION_LABEL = {
    "approve": "請優先完成簽核，避免流程停在您這一關",
    "publish": "請確認並公布，讓已核定事項正式生效",
    "review": "請檢視審議狀態並推進下一步",
    "reply": "請回覆或更新承辦進度",
    "attend": "請確認出席並準備會議資料",
    "fill": "請趁開放期間完成填答",
    "prepare": "請完成準備事項",
    "manage": "請檢查設定並完成管理動作",
    "complete": "請完成指派工作",
}


def _hours_until(due_at: datetime | None, now: datetime) -> float | None:
    if due_at is None:
        return None
    due = due_at if due_at.tzinfo else due_at.replace(tzinfo=UTC)
    return (due - now).total_seconds() / 3600


def _hours_since(created_at: datetime, now: datetime) -> float:
    created = created_at if created_at.tzinfo else created_at.replace(tzinfo=UTC)
    return max(0.0, (now - created).total_seconds() / 3600)


def score_task(item: TaskItem, *, now: datetime | None = None) -> TaskItem:
    """依時間壓力、流程阻塞、角色責任與影響範圍回填優先級。"""
    now = now or datetime.now(UTC)
    score = 0
    reasons: list[str] = []

    hours_left = _hours_until(item.due_at, now)
    if hours_left is not None:
        if hours_left < 0:
            score += 45
            reasons.append("已逾期")
        elif hours_left <= 2:
            score += 38
            reasons.append("2 小時內到期")
        elif hours_left <= 24:
            score += 30
            reasons.append("24 小時內到期")
        elif hours_left <= 72:
            score += 18
            reasons.append("72 小時內到期")

    age_hours = _hours_since(item.created_at, now)
    if item.due_at is None:
        if age_hours >= 72:
            score += 26
            reasons.append("已等待超過 3 天")
        elif age_hours >= 48:
            score += 18
            reasons.append("已等待超過 48 小時")
        elif age_hours >= 24:
            score += 10
            reasons.append("已等待超過 24 小時")

    action_score = ACTION_BLOCKING_WEIGHT.get(item.action, 8)
    if action_score >= 24:
        reasons.append("會阻塞後續流程")
    score += action_score

    module_score = MODULE_IMPACT_WEIGHT.get(item.module, 8)
    if item.module in {"regulation", "announcement", "meal", "shop"}:
        reasons.append("影響多人可見或服務時程")
    score += module_score

    if item.severity == "critical":
        score += 24
        reasons.append("系統已標示為緊急")
    elif item.severity == "warning":
        score += 12

    if item.action in {"approve", "publish", "reply"}:
        score += 12
        reasons.append("需要您本人作成決定")

    item.priority_score = min(score, 100)
    item.priority_reasons = list(dict.fromkeys(reasons))[:4]
    item.recommended_action = ACTION_LABEL.get(item.action, "請開啟項目查看下一步")
    if item.priority_score >= 85:
        item.severity = "critical"
    elif item.priority_score >= 55 and item.severity == "info":
        item.severity = "warning"
    return item


def prioritize_tasks(items: list[TaskItem]) -> list[TaskItem]:
    now = datetime.now(UTC)
    scored = [score_task(item, now=now) for item in items]
    scored.sort(
        key=lambda item: (
            -item.priority_score,
            item.due_at.timestamp() if item.due_at else float("inf"),
            -item.created_at.timestamp(),
        )
    )
    return scored


def score_dashboard_widget(widget: DashboardWidget, *, role_rank: int = 0) -> DashboardWidget:
    """讓 dashboard widgets 使用與待辦相同的分數語意。"""
    base = {"critical": 70, "warning": 45, "info": 20}.get(widget.severity, 20)
    volume = min((widget.count or 0) * 4, 20)
    item_score = max((item.priority_score for item in widget.items), default=0)
    widget.priority_score = min(base + volume + item_score // 3 + role_rank, 100)

    reasons: list[str] = []
    if widget.severity == "critical":
        reasons.append("含緊急或高影響項目")
    if widget.count:
        reasons.append(f"共有 {widget.count} 件相關事項")
    if item_score:
        reasons.append("內含高優先級待辦")
    widget.priority_reasons = reasons[:3]
    widget.recommended_action = "先處理分數最高的項目" if widget.items else "查看完整列表"
    return widget


def prioritize_dashboard_widgets(
    widgets: list[DashboardWidget], *, preferred_keys: tuple[str, ...]
) -> list[DashboardWidget]:
    rank = {key: max(0, 12 - index * 3) for index, key in enumerate(preferred_keys)}
    scored = [score_dashboard_widget(w, role_rank=rank.get(w.key, 0)) for w in widgets]
    scored.sort(key=lambda widget: (-widget.priority_score, -(widget.count or 0), widget.title))
    return scored
