"""通知偏好正規化 — 將舊/新/空格式統一為 {type: {inapp, email}} 巢狀結構。

歷史背景：notification_preferences JSONB 欄位原為扁平 {type: bool}，
升級為多管道後改為 {type: {inapp: bool, email: bool}}。本模組讓讀取端
相容所有存量格式，PUT 時整包存回標準格式以漸進修復舊資料。
"""

from __future__ import annotations

# 通知類型清單（順序對齊前端設定頁）
NOTIFICATION_TYPES: tuple[str, ...] = (
    # 公文
    "document_pending",
    "document_approved",
    "document_rejected",
    "document_recalled",
    # 議事
    "meeting_invited",
    "meeting_today",
    "meeting_minutes_ready",
    # 法規
    "regulation_review_assigned",
    "regulation_publish_ready",
    "regulation_published",
    # 陳情
    "petition_assigned",
    "petition_replied",
    "petition_status_updated",
    # 學餐 / 商品
    "meal_class_collecting",
    "meal_pickup_ready",
    "shop_order_paid",
    # 問卷 / 公告
    "survey_invitation",
    "announcement",
    # 行事曆 / 工作
    "calendar_event_invited",
    "calendar_event_updated",
    "work_item_assigned",
    "work_item_due",
    # 系統
    "system",
)

# email 管道預設開啟的類型；其餘預設只開站內，避免一上線就大量寄信
_EMAIL_DEFAULT_ON: frozenset[str] = frozenset(
    {
        "document_pending",
        "meeting_invited",
        "regulation_publish_ready",
        "petition_assigned",
    }
)

# 各通知類型的中文標籤（email 主旨前綴、退訂頁顯示用）
TYPE_LABELS: dict[str, str] = {
    "document_pending": "公文待審",
    "document_approved": "公文核准",
    "document_rejected": "公文退回",
    "document_recalled": "公文撤回",
    "meeting_invited": "會議邀請",
    "meeting_today": "今日會議提醒",
    "meeting_minutes_ready": "會議紀錄發布",
    "regulation_review_assigned": "法規排入議程",
    "regulation_publish_ready": "法規待公布",
    "regulation_published": "法規已公布",
    "petition_assigned": "陳情指派",
    "petition_replied": "陳情回覆",
    "petition_status_updated": "陳情狀態更新",
    "meal_class_collecting": "班級開始收單",
    "meal_pickup_ready": "取餐通知",
    "shop_order_paid": "商品訂單付款",
    "survey_invitation": "問卷邀請",
    "announcement": "公告通知",
    "calendar_event_invited": "行事曆邀請",
    "calendar_event_updated": "行事曆異動",
    "work_item_assigned": "工作指派",
    "work_item_due": "工作期限",
    "system": "系統通知",
}


def default_channel(notification_type: str) -> dict[str, bool]:
    """取得某通知類型的預設管道設定。"""
    return {
        "inapp": True,
        "email": notification_type in _EMAIL_DEFAULT_ON,
        "line": False,
        "discord": False,
    }


def normalize_preferences(raw: dict | None) -> dict[str, dict[str, bool]]:
    """把空 / 舊 {type: bool} / 新 {type: {inapp, email}} 任一格式統一為標準巢狀結構。

    - 舊格式 bool v → {inapp: v, email: v and (type in _EMAIL_DEFAULT_ON)}
    - 新格式 dict → 補齊缺漏的 inapp/email 子鍵
    - 缺漏的 type → 補預設
    """
    raw = raw or {}
    out: dict[str, dict[str, bool]] = {}
    for ntype in NOTIFICATION_TYPES:
        value = raw.get(ntype)
        if isinstance(value, dict):
            out[ntype] = {
                "inapp": bool(value.get("inapp", True)),
                "email": bool(value.get("email", ntype in _EMAIL_DEFAULT_ON)),
                "line": bool(value.get("line", False)),
                "discord": bool(value.get("discord", False)),
            }
        elif isinstance(value, bool):
            out[ntype] = {
                "inapp": value,
                "email": value and (ntype in _EMAIL_DEFAULT_ON),
                "line": False,
                "discord": False,
            }
        else:
            out[ntype] = default_channel(ntype)
    return out


# ── Email 摘要頻率（每日/每週聚合通知） ──────────────────────────────────────

DIGEST_FREQUENCIES = ("off", "daily", "weekly")

# 將摘要頻率存於 notification_preferences JSON 的特殊保留鍵；
# 雙底線開頭以避免與 NOTIFICATION_TYPES 衝突，免做 DB schema 變更。
_DIGEST_KEY = "__digest_frequency"


def get_digest_frequency(prefs: dict | None) -> str:
    """從原始 JSON 取出摘要頻率；未設定回 "off"。"""
    raw = (prefs or {}).get(_DIGEST_KEY)
    if isinstance(raw, str) and raw in DIGEST_FREQUENCIES:
        return raw
    return "off"


def set_digest_frequency(prefs: dict | None, frequency: str) -> dict:
    """回傳寫入新摘要頻率後的完整 prefs dict（保留其他欄位）。"""
    if frequency not in DIGEST_FREQUENCIES:
        raise ValueError(f"unsupported digest frequency: {frequency}")
    next_prefs = dict(prefs or {})
    next_prefs[_DIGEST_KEY] = frequency
    return next_prefs


# ── 模組靜音（一鍵關閉整個模組的所有通知）────────────────────────────────────

# 通知類型 → 所屬模組（供靜音時批次關閉同模組所有類型）
TYPE_MODULE_MAP: dict[str, str] = {
    "document_pending": "document",
    "document_approved": "document",
    "document_rejected": "document",
    "document_recalled": "document",
    "meeting_invited": "meeting",
    "meeting_today": "meeting",
    "meeting_minutes_ready": "meeting",
    "regulation_review_assigned": "regulation",
    "regulation_publish_ready": "regulation",
    "regulation_published": "regulation",
    "petition_assigned": "petition",
    "petition_replied": "petition",
    "petition_status_updated": "petition",
    "meal_class_collecting": "meal",
    "meal_pickup_ready": "meal",
    "shop_order_paid": "shop",
    "survey_invitation": "survey",
    "announcement": "announcement",
    "calendar_event_invited": "calendar",
    "calendar_event_updated": "calendar",
    "work_item_assigned": "work",
    "work_item_due": "work",
    "system": "system",
}

MODULE_LABELS: dict[str, str] = {
    "document": "公文",
    "meeting": "會議",
    "regulation": "法規",
    "petition": "陳情",
    "meal": "學餐",
    "shop": "購票",
    "survey": "問卷",
    "announcement": "公告",
    "calendar": "行事曆",
    "work": "工作",
    "system": "系統",
}

KNOWN_MODULES: frozenset[str] = frozenset(MODULE_LABELS)

# 存於 notification_preferences JSON 的保留鍵（雙底線開頭）
_MUTED_MODULES_KEY = "__muted_modules"


def get_muted_modules(prefs: dict | None) -> list[str]:
    """從原始 prefs JSON 取出已靜音的模組清單；未設定回空列表。"""
    raw = (prefs or {}).get(_MUTED_MODULES_KEY)
    if isinstance(raw, list):
        return [m for m in raw if isinstance(m, str) and m in KNOWN_MODULES]
    return []


def set_muted_modules(prefs: dict | None, modules: list[str]) -> dict:
    """回傳寫入新靜音模組清單後的完整 prefs dict（保留其他欄位）。

    同時把被靜音模組的所有通知類型的 inapp/email/line/discord 全關；
    取消靜音時不自動恢復（避免覆蓋使用者之前的細部設定）。
    """
    invalid = [m for m in modules if m not in KNOWN_MODULES]
    if invalid:
        raise ValueError(f"未知的模組名稱：{', '.join(invalid)}")
    next_prefs = normalize_preferences(prefs)
    mute_set = frozenset(modules)
    for ntype, module in TYPE_MODULE_MAP.items():
        if module in mute_set:
            next_prefs[ntype] = {"inapp": False, "email": False, "line": False, "discord": False}
    # 寫回保留鍵，在 JSONB 最外層
    result: dict = {**next_prefs, _MUTED_MODULES_KEY: sorted(mute_set)}
    # 保留其他保留鍵（如 __digest_frequency）
    for key, val in (prefs or {}).items():
        if key.startswith("__") and key != _MUTED_MODULES_KEY:
            result[key] = val
    return result


def is_module_muted(prefs: dict | None, notification_type: str) -> bool:
    """快速判斷某通知類型的所屬模組是否被靜音（供發送前 gate 用）。"""
    module = TYPE_MODULE_MAP.get(notification_type)
    if module is None:
        return False
    return module in get_muted_modules(prefs)
