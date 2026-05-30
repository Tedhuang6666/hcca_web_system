"""模組註冊表 — 提供 staged startup 機制。

每個業務模組可選擇性註冊一個 startup_check（async 函式，失敗即拋例外）。
api/__init__.py lifespan 在核心服務（DB / Redis / WS broker）就緒後，
併發跑所有模組的 startup_check；任何模組失敗 → 該模組自動進入維護狀態，
但其他模組仍可正常啟動，避免單一模組故障炸掉整個 app。

注意：每個 check 必須使用獨立的 AsyncSession — SQLAlchemy AsyncSession
不允許併發操作（多個 coroutine 同時在同一個 session 上跑 SQL 會炸
"Session is already flushing" 或 "concurrent operations are not permitted"）。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


StartupCheck = Callable[[AsyncSession], Awaitable[None]]


@dataclass
class ModuleRegistration:
    module_id: str
    startup_check: StartupCheck | None = None


_REGISTRATIONS: dict[str, ModuleRegistration] = {}


def register(module_id: str, *, startup_check: StartupCheck | None = None) -> None:
    """登錄一個模組與其自檢函式。重複註冊以最後一次為準。"""
    _REGISTRATIONS[module_id] = ModuleRegistration(module_id=module_id, startup_check=startup_check)


def registered_ids() -> tuple[str, ...]:
    return tuple(_REGISTRATIONS.keys())


async def run_startup_checks() -> dict[str, str | None]:
    """併發執行所有已登錄的 startup_check（每個 check 開獨立 session）。

    回傳 {module_id: error_message or None}；error_message=None 代表通過。
    任一檢查失敗只記錄該模組，不拋例外，讓其他模組可繼續啟動。
    """
    results: dict[str, str | None] = {}
    if not _REGISTRATIONS:
        return results

    from api.core.database import AsyncSessionLocal

    async def _run(reg: ModuleRegistration) -> tuple[str, str | None]:
        if reg.startup_check is None:
            return reg.module_id, None
        # 每個模組獨立 session — 避免在同一個 AsyncSession 上併發跑 SQL
        try:
            async with AsyncSessionLocal() as session:
                await reg.startup_check(session)
            return reg.module_id, None
        except Exception as exc:
            logger.warning("Module startup_check failed module=%s exc=%s", reg.module_id, exc)
            return reg.module_id, f"{type(exc).__name__}: {exc}"

    pairs = await asyncio.gather(
        *(_run(reg) for reg in _REGISTRATIONS.values()), return_exceptions=False
    )
    for mid, err in pairs:
        results[mid] = err
    return results


async def apply_startup_results(results: dict[str, str | None]) -> None:
    """將檢查結果反映到 module_maintenance（失敗者進入 5min auto 維護）。"""
    from api.core.maintenance import set_module_maintenance

    for mid, err in results.items():
        if err is None:
            continue
        try:
            await set_module_maintenance(
                mid,
                on=True,
                source="auto",
                reason=f"啟動自檢失敗：{err}",
                ttl=300,
            )
        except Exception:
            logger.exception("apply_startup_results failed mid=%s", mid)
