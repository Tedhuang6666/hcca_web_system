"""Discord 成員角色定期對帳任務測試（apps/api/src/api/services/discord_sync_tasks.py）。

_reconcile_members 走 task_session()（獨立於 db_session 的真實連線），故無法用
本檔其他測試常見的「未 seed 資料即應為 0」假設 —— 共用測試資料庫可能有其他
並行 session 真實 commit 的 DiscordAccountLink（見專案已知的併發 session 現象）。
僅驗證回傳結構與型別，不驗證確切數值。
"""

from __future__ import annotations

from api.services.discord_sync_tasks import _reconcile_members


async def test_reconcile_members_returns_queued_count() -> None:
    result = await _reconcile_members()
    assert set(result.keys()) == {"queued"}
    assert isinstance(result["queued"], int)
    assert result["queued"] >= 0
