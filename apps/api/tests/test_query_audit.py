"""SQL query audit counters and slow-query aggregation tests."""

from collections import deque

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from api.core import query_audit
from api.core.trace_context import reset_trace_id, set_trace_id


def test_slow_query_keys_retain_predicates_beyond_the_display_limit(monkeypatch) -> None:
    monkeypatch.setattr(query_audit, "_slow_samples", deque(maxlen=100))
    monkeypatch.setattr(query_audit, "_slow_index", {})
    prefix = "SELECT " + ", ".join(f"orders.column_{i}" for i in range(300)) + " FROM orders WHERE "
    query_audit._record_slow_sample(prefix + "class_id = 'private-class'", 70, "/shop/close-status")
    query_audit._record_slow_sample(prefix + "user_id = 'private-user'", 80, "/shop/orders")
    samples = query_audit.get_slow_queries()
    assert len(samples) == 2
    assert len({sample["fingerprint"] for sample in samples}) == 2
    assert all(sample["template_truncated"] for sample in samples)
    assert all(len(str(sample["template"])) <= 4_000 for sample in samples)
    assert "private-" not in str(samples)


def test_slow_query_samples_retain_where_clause_and_worst_request_trace(monkeypatch) -> None:
    monkeypatch.setattr(query_audit, "_slow_samples", deque(maxlen=100))
    monkeypatch.setattr(query_audit, "_slow_index", {})
    statement = "SELECT " + ", ".join(f"orders.column_{i}" for i in range(30))
    statement += " FROM orders WHERE orders.class_id = 'private-class'"
    token = set_trace_id("a" * 32)
    try:
        query_audit._record_slow_sample(statement, 70, "/shop/close-status")
        set_trace_id("b" * 32)
        query_audit._record_slow_sample(statement, 120, "/shop/orders")
        set_trace_id("c" * 32)
        query_audit._record_slow_sample(statement, 80, "/shop/close-status")
    finally:
        reset_trace_id(token)
    sample = query_audit.get_slow_queries()[0]
    assert "FROM orders WHERE orders.class_id = ?" in sample["template"]
    assert sample["template_truncated"] is False
    assert sample["occurrences"] == 3
    assert sample["max_ms"] == 120
    assert sample["max_trace_id"] == "b" * 32
    assert sample["max_request_path"] == "/shop/orders"
    assert sample["measurement"] == "sqlalchemy_cursor_wall_time"


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


def test_readiness_probe_select_is_not_a_slow_query_sample() -> None:
    assert query_audit._is_noise_statement("SELECT 1") is True
    assert query_audit._is_noise_statement("SELECT ?") is True
    assert query_audit._is_noise_statement("SELECT id FROM users") is False
