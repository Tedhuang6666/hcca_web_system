"""模組健康端點 helper — 統一註冊 /__module_health__。

每個業務模組 router 在自己檔案末尾呼叫 attach_module_health(router, check)；
check 是輕量 async 函式，回 None=ok 或 raise=失敗。
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db

logger = logging.getLogger(__name__)

DbDep = Annotated[AsyncSession, Depends(get_db)]

# check 簽名：async (db) -> None。失敗請 raise 任何 Exception；
# 端點會包成 503，避免把錯誤訊息洩漏給外部探測者。
ModuleHealthCheck = Callable[[AsyncSession], Awaitable[None]]


async def _default_check(db: AsyncSession) -> None:
    """預設健康檢查：DB 連線 + SELECT 1。"""
    await db.execute(text("SELECT 1"))


def attach_module_health(
    router: APIRouter,
    *,
    module_id: str,
    check: ModuleHealthCheck | None = None,
) -> None:
    """掛 /__module_health__ 到指定 router。

    Args:
        router: 業務模組 router（含 prefix）
        module_id: 用於 log 與回應 body
        check: 可選的自訂 check；預設只 ping DB
    """
    real_check = check or _default_check

    async def health(db: DbDep) -> dict[str, str]:
        try:
            await real_check(db)
        except Exception as exc:
            logger.warning("Module health failed id=%s exc=%s", module_id, exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"module": module_id, "ok": False, "reason": type(exc).__name__},
            ) from exc
        return {"module": module_id, "ok": "true"}

    # 直接 add_api_route 比 @router.get 更乾淨（不污染原 router 的 decorator chain）。
    # 加上 idempotent 檢查：若已掛過（例如 create_app 在測試中被多次呼叫）就跳過。
    route_name = f"{module_id}_module_health"
    if any(getattr(r, "name", None) == route_name for r in router.routes):
        return
    router.add_api_route(
        "/__module_health__",
        health,
        methods=["GET"],
        include_in_schema=False,
        name=route_name,
    )
    # add_api_route 會把路由 append 到尾端，但業務 router 多半已有貪婪的
    # `/{id}` 動態路由（如 GET /petitions/{case_id}），會搶先匹配
    # `/__module_health__` 並因 UUID 驗證失敗回 422/401 → 健康探測永遠拿不到 200，
    # 半開探測式自動恢復因此失效。把健康路由移到最前面，確保靜態路徑優先匹配。
    router.routes.insert(0, router.routes.pop())
