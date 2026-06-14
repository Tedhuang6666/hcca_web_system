"""功能模組登錄 — per-module 維護模式的單一事實來源。

純資料，不相依其他 core 模組（避免循環 import）。後端 middleware / admin router /
斷路器與前端 lib/modules.ts 皆以此為對齊基準。

刻意排除 /auth、/admin、/system、/users、/ws、/notifications 等核心通道：
這些若被維護模式關掉就無法自救。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModuleSpec:
    label: str
    api_prefixes: tuple[str, ...]


# id → 規格。api_prefixes 採 segment 邊界比對（見 match_module）。
MODULES: dict[str, ModuleSpec] = {
    "documents": ModuleSpec(
        "公文系統",
        (
            "/documents",
            "/documents-approve",
            "/attachments",
            "/document-templates",
            "/document-serials",
        ),
    ),
    "regulations": ModuleSpec("法規系統", ("/regulations",)),
    "meetings": ModuleSpec(
        "議事系統",
        ("/meetings", "/calendar", "/council-proposals", "/judicial-petitions"),
    ),
    "announcements": ModuleSpec("校內公告", ("/announcements",)),
    "shop": ModuleSpec("校商訂購", ("/shop",)),
    "meal": ModuleSpec("學餐訂購", ("/meal",)),
    "surveys": ModuleSpec("問卷系統", ("/surveys",)),
    "petitions": ModuleSpec("陳情中心", ("/petitions",)),
    "examPapers": ModuleSpec("段考題庫", ("/exam-papers",)),
    "partnerMap": ModuleSpec("特約地圖", ("/partner-map",)),
    "activities": ModuleSpec("活動管理", ("/activities",)),
    "elections": ModuleSpec("選舉開票", ("/elections",)),
    "seating": ModuleSpec("票務劃位", ("/seating",)),
}

MODULE_IDS: tuple[str, ...] = tuple(MODULES.keys())

# 比對用：(prefix, module_id)，較長的前綴排前面以確保最精確匹配優先。
_PREFIX_INDEX: tuple[tuple[str, str], ...] = tuple(
    sorted(
        ((prefix, mid) for mid, spec in MODULES.items() for prefix in spec.api_prefixes),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
)


def match_module(path: str) -> str | None:
    """以 segment 邊界比對 path，回傳所屬 module_id；無對應回 None。

    `path == prefix` 或 `path` 以 `prefix + "/"` 開頭才算命中，
    因此 `/documents` 不會誤吃 `/documents-approve`。
    """
    for prefix, mid in _PREFIX_INDEX:
        if path == prefix or path.startswith(prefix + "/"):
            return mid
    return None
