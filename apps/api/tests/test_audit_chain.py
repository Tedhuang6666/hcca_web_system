"""稽核日誌雜湊鏈 service 測試（ADR-004）。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.audit_log import AuditLog
from api.services import audit as audit_svc
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
    assert h1.startswith("hmac-sha256:v1:")
    assert len(h1.rsplit(":", maxsplit=1)[-1]) == 64


def test_compute_self_hash_is_keyed(monkeypatch: pytest.MonkeyPatch):
    row = _make_row(action="approve", meta={"reason": "ok"})
    monkeypatch.setattr(audit_chain, "_audit_chain_keys", lambda: {"test": "a" * 32})
    monkeypatch.setattr(audit_chain.settings, "AUDIT_CHAIN_ACTIVE_KID", "test")
    signed = audit_chain.compute_self_hash(row, "PREV_HASH_A")

    monkeypatch.setattr(audit_chain, "_audit_chain_keys", lambda: {"test": "b" * 32})
    assert audit_chain.compute_self_hash(row, "PREV_HASH_A") != signed


def test_legacy_sha256_rows_remain_verifiable():
    row = _make_row(action="approve", meta={"reason": "ok"})
    legacy_hash = audit_chain.compute_legacy_self_hash(row, "PREV_HASH_A")

    assert audit_chain.compute_expected_self_hash(row, "PREV_HASH_A", legacy_hash) == legacy_hash


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
async def test_get_last_hash_rejects_legacy_rows_without_hashes(db_session: AsyncSession):
    rows = [
        _make_row(created_at=datetime(2026, 1, 1, 0, 0, tzinfo=UTC)),
        _make_row(created_at=datetime(2026, 1, 1, 0, 1, tzinfo=UTC)),
    ]
    db_session.add_all(rows)
    await db_session.commit()

    with pytest.raises(audit_chain.AuditChainIntegrityError, match="missing chain hash"):
        await audit_chain.get_last_hash(db_session)

    assert rows[0].prev_hash is None
    assert rows[0].self_hash is None
    assert rows[1].prev_hash is None
    assert rows[1].self_hash is None


@pytest.mark.asyncio
async def test_audit_record_writes_hash_chain(db_session: AsyncSession):
    row = await audit_svc.record(
        db_session,
        entity_type="document",
        entity_id="doc-1",
        action="create",
    )
    await db_session.commit()

    assert row.prev_hash == audit_chain.GENESIS_HASH
    assert row.self_hash is not None


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
    assert row.self_hash.startswith("hmac-sha256:v1:")


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
async def test_hmac_chain_can_continue_legacy_sha_rows(db_session: AsyncSession):
    legacy_row = _make_row(created_at=datetime(2026, 1, 1, tzinfo=UTC))
    legacy_row.prev_hash = audit_chain.GENESIS_HASH
    legacy_row.self_hash = audit_chain.compute_legacy_self_hash(
        legacy_row,
        legacy_row.prev_hash,
    )
    db_session.add(legacy_row)
    await db_session.commit()

    hmac_row = await audit_chain.write_audit_log_with_chain(
        db_session,
        entity_type="document",
        entity_id="doc-new",
        action="approve",
    )
    await db_session.commit()

    assert hmac_row.prev_hash == legacy_row.self_hash
    assert hmac_row.self_hash.startswith("hmac-sha256:v1:")
    assert await audit_chain.verify_integrity_range(db_session) == []


@pytest.mark.asyncio
async def test_writer_and_verifier_support_audit_key_rotation(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    old_key = "o" * 64
    new_key = "n" * 64
    monkeypatch.setattr(audit_chain.settings, "AUDIT_CHAIN_ACTIVE_KID", "old")
    monkeypatch.setattr(audit_chain.settings, "AUDIT_CHAIN_SIGNING_KEY", old_key)
    monkeypatch.setattr(audit_chain.settings, "AUDIT_CHAIN_PREVIOUS_SIGNING_KEYS", [])
    first = await audit_chain.write_audit_log_with_chain(
        db_session,
        entity_type="document",
        entity_id="doc-1",
        action="create",
    )
    await db_session.commit()

    monkeypatch.setattr(audit_chain.settings, "AUDIT_CHAIN_ACTIVE_KID", "new")
    monkeypatch.setattr(audit_chain.settings, "AUDIT_CHAIN_SIGNING_KEY", new_key)
    monkeypatch.setattr(
        audit_chain.settings,
        "AUDIT_CHAIN_PREVIOUS_SIGNING_KEYS",
        [f"old:{old_key}"],
    )
    second = await audit_chain.write_audit_log_with_chain(
        db_session,
        entity_type="document",
        entity_id="doc-2",
        action="approve",
    )
    await db_session.commit()

    assert second.prev_hash == first.self_hash
    assert second.self_hash.startswith("hmac-sha256:v1:new:")
    assert await audit_chain.verify_integrity_range(db_session) == []


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


@pytest.mark.asyncio
async def test_get_last_hash_rejects_tampered_latest_row(db_session: AsyncSession):
    row = await audit_chain.write_audit_log_with_chain(
        db_session,
        entity_type="document",
        entity_id="doc-1",
        action="create",
    )
    await db_session.commit()
    row.action = "delete"
    await db_session.flush()

    with pytest.raises(audit_chain.AuditChainIntegrityError, match="verification failed"):
        await audit_chain.get_last_hash(db_session)
