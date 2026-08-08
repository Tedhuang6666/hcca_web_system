"""SQL query audit counters and slow-query aggregation tests."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from api.core import query_audit


async def test_query_counters_are_visible_after_async_sqlalchemy_execution() -> None:
    query_audit.reset_request_counters()
    query_audit.install_listeners()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        query_count, slow_count, total_ms = query_audit.get_request_counters()
    finally:
        await engine.dispose()

    assert query_count == 1
    assert slow_count == 0
    assert total_ms >= 0


async def test_install_listeners_is_idempotent() -> None:
    query_audit.reset_request_counters()
    query_audit.install_listeners()
    query_audit.install_listeners()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        query_count, _, _ = query_audit.get_request_counters()
    finally:
        await engine.dispose()

    assert query_count == 1
