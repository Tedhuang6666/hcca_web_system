"""通知偏好正規化 — 將舊/新/空格式統一為 {type: {inapp, email}} 巢狀結構。

歷史背景：notification_preferences JSONB 欄位原為扁平 {type: bool}，
升級為多管道後改為 {type: {inapp: bool, email: bool}}。本模組讓讀取端
相容所有存量格式，PUT 時整包存回標準格式以漸進修復舊資料。
"""

from __future__ import annotations

# 通知類型清單（順序對齊前端設定頁）
NOTIFICATION_TYPES: tuple[str, ...] = (
    "document_pending",
    "document_approved",
    "document_rejected",
    "document_recalled",
    "announcement",
    "system",
)

# email 管道預設開啟的類型；其餘預設只開站內，避免一上線就大量寄信
_EMAIL_DEFAULT_ON: frozenset[str] = frozenset({"document_pending"})

# 各通知類型的中文標籤（email 主旨前綴、退訂頁顯示用）
TYPE_LABELS: dict[str, str] = {
    "document_pending": "公文待審",
    "document_approved": "公文核准",
    "document_rejected": "公文退回",
    "document_recalled": "公文撤回",
    "announcement": "公告通知",
    "system": "系統通知",
}


def default_channel(notification_type: str) -> dict[str, bool]:
    """取得某通知類型的預設管道設定。"""
    return {"inapp": True, "email": notification_type in _EMAIL_DEFAULT_ON}


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
            }
        elif isinstance(value, bool):
            out[ntype] = {"inapp": value, "email": value and (ntype in _EMAIL_DEFAULT_ON)}
        else:
            out[ntype] = default_channel(ntype)
    return out
