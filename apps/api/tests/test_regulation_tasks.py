"""法規巡檢背景任務測試（apps/api/src/api/services/regulation_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.regulation_consistency import audit_regulation_document_consistency
from api.services.regulation_tasks import audit_regulation_consistency


def _close_coro(coro, value=None, exc=None):  # noqa: ANN001
    coro.close()
    if exc is not None:
        raise exc
    return value


def test_audit_regulation_consistency_returns_result() -> None:
    fake_result = {"checked_at": "now", "problem_count": 0, "problems": []}
    with patch(
        "api.services.regulation_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, fake_result),
    ):
        result = audit_regulation_consistency()
    assert result == fake_result


def test_audit_regulation_consistency_retries_on_failure() -> None:
    with (
        patch.object(audit_regulation_consistency, "retry", side_effect=Exception("retry called")),
        patch(
            "api.services.regulation_tasks.asyncio.run",
            side_effect=lambda coro: _close_coro(coro, exc=RuntimeError("db down")),
        ),
        pytest.raises(Exception, match="retry called"),
    ):
        audit_regulation_consistency()


async def test_audit_regulation_document_consistency_no_regulations_returns_zero(
    db_session: AsyncSession,
) -> None:
    result = await audit_regulation_document_consistency(db_session)
    assert result["problem_count"] == 0
    assert result["problems"] == []
