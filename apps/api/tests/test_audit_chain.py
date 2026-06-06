"""稽核日誌雜湊鏈 service 測試（ADR-004）。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.audit_log import AuditLog
from api.services import audit_chain


def _make_row(
    *,
    action: str = "create",
    entity_type: str = "document",
    entity_id: str | None = None,
    actor_id: str | None = None,
    meta: dict | None = None,
    created_at: datetime | None = None,
) -> AuditLog:
    return AuditLog(
        id=uuid.uuid4(),
        entity_type=entity_type,
        entity_id=entity_id or str(uuid.uuid4()),
        action=action,
        actor_id=actor_id,
        meta=meta or {},
        created_at=created_at or datetime.now(UTC),
    )


def test_compute_self_hash_deterministic():
    row = _make_row(action="approve", meta={"reason": "ok"})
    h1 = audit_chain.compute_self_hash(row, "PREV_HASH_A")
    h2 = audit_chain.compute_self_hash(row, "PREV_HASH_A")
    assert h1 == h2
    assert len(h1) == 64  # sha256 hex


def test_compute_self_hash_changes_when_prev_hash_changes():
    row = _make_row()
    h1 = audit_chain.compute_self_hash(row, "PREV_A")
    h2 = audit_chain.compute_self_hash(row, "PREV_B")
    assert h1 != h2


def test_compute_self_hash_changes_when_content_changes():
    row1 = _make_row(action="create")
    row2 = _make_row(action="delete", entity_id=row1.entity_id, created_at=row1.created_at)
    h1 = audit_chain.compute_self_hash(row1, "PREV")
    h2 = audit_chain.compute_self_hash(row2, "PREV")
    assert h1 != h2


@pytest.mark.asyncio
async def test_get_last_hash_empty_returns_genesis(db_session: AsyncSession):
    h = await audit_chain.get_last_hash(db_session)
    assert h == audit_chain.GENESIS_HASH


@pytest.mark.asyncio
async def test_write_audit_log_with_chain_first_row_uses_genesis(db_session: AsyncSession):
    row = await audit_chain.write_audit_log_with_chain(
        db_session,
        entity_type="document",
        entity_id="doc-1",
        action="create",
        actor_id="user-1",
        meta={"title": "test"},
    )
    await db_session.commit()
    assert row.prev_hash == audit_chain.GENESIS_HASH
    assert row.self_hash is not None
    assert len(row.self_hash) == 64


@pytest.mark.asyncio
async def test_write_audit_log_with_chain_links_to_previous(db_session: AsyncSession):
    row1 = await audit_chain.write_audit_log_with_chain(
        db_session,
        entity_type="document",
        entity_id="doc-1",
        action="create",
    )
    await db_session.commit()

    row2 = await audit_chain.write_audit_log_with_chain(
        db_session,
        entity_type="document",
        entity_id="doc-1",
        action="approve",
    )
    await db_session.commit()

    assert row2.prev_hash == row1.self_hash
    assert row2.self_hash != row1.self_hash


@pytest.mark.asyncio
async def test_verify_integrity_range_clean_chain(db_session: AsyncSession):
    for i in range(5):
        await audit_chain.write_audit_log_with_chain(
            db_session,
            entity_type="document",
            entity_id=f"doc-{i}",
            action="create",
        )
    await db_session.commit()

    issues = await audit_chain.verify_integrity_range(db_session)
    assert issues == []


@pytest.mark.asyncio
async def test_verify_integrity_detects_tampered_content(db_session: AsyncSession):
    row1 = await audit_chain.write_audit_log_with_chain(
        db_session,
        entity_type="document",
        entity_id="doc-1",
        action="create",
    )
    await audit_chain.write_audit_log_with_chain(
        db_session,
        entity_type="document",
        entity_id="doc-2",
        action="approve",
    )
    await db_session.commit()

    # 篡改第一筆
    row1.action = "delete"
    await db_session.flush()

    issues = await audit_chain.verify_integrity_range(db_session)
    assert len(issues) >= 1
    assert str(row1.id) in {i["audit_log_id"] for i in issues}
