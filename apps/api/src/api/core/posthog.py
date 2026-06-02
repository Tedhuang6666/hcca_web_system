"""PostHog 產品分析 — 啟動時呼叫 init_posthog()，關閉時呼叫 shutdown_posthog()。

僅在 POSTHOG_API_KEY 有設定時啟用；未設定則完全 no-op。
使用 get_posthog_client() 取得已初始化的客戶端；路由處理器中呼叫
client.capture(distinct_id, event, properties={...}) 以記錄事件。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from api.core.config import settings

if TYPE_CHECKING:
    from posthog import Posthog

logger = logging.getLogger(__name__)

_client: Posthog | None = None


def init_posthog() -> bool:
    """初始化 PostHog 客戶端；回傳 True 表示有啟用。"""
    global _client

    if not settings.POSTHOG_API_KEY:
        return False

    try:
        from posthog import Posthog
    except ImportError:
        logger.warning("POSTHOG_API_KEY is set but posthog package not installed; skipping init.")
        return False

    _client = Posthog(
        project_api_key=settings.POSTHOG_API_KEY,
        host=settings.POSTHOG_HOST,
        enable_exception_autocapture=True,
    )
    # Posthog.__init__ 內部會把 `posthog` logger 等級設成 WARNING（見 posthog/client.py
    # 第 358 行），這會洗版 `[FEATURE FLAGS] You have to specify a personal_api_key...`
    # 我們沒有 personal_api_key（只用 project_api_key 做事件回報），把這個 logger
    # 拉到 ERROR 才能蓋掉它對我們無用的警告。
    logging.getLogger("posthog").setLevel(logging.ERROR)
    logger.info("PostHog initialized host=%s", settings.POSTHOG_HOST)
    return True


def shutdown_posthog() -> None:
    """關閉 PostHog 客戶端，確保待傳送的事件都被 flush。"""
    if _client is not None:
        _client.shutdown()


def get_posthog_client() -> Posthog | None:
    """回傳已初始化的 PostHog 客戶端，未啟用時回傳 None。"""
    return _client
