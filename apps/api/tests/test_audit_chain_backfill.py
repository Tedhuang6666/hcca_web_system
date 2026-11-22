"""一次性 audit hash backfill 的防重簽回歸測試。"""

from datetime import UTC, datetime

import pytest
from scripts.backfill_audit_hash_chain import _prepare_backfill

from api.models.audit_log import AuditLog
from api.services import audit_chain


def _row(action: str, *, created_at: datetime) -> AuditLog:
    return AuditLog(
        entity_type="document",
        entity_id=f"doc-{action}",
        action=action,
        meta={},
        created_at=created_at,
    )


def test_backfill_plans_only_unhashed_tail() -> None:
    first = _row("create", created_at=datetime(2026, 1, 1, tzinfo=UTC))
    first.prev_hash = audit_chain.GENESIS_HASH
    first.self_hash = audit_chain.compute_legacy_self_hash(first, first.prev_hash)
    second = _row("approve", created_at=datetime(2026, 1, 2, tzinfo=UTC))

    summary, updates = _prepare_backfill([first, second])

    assert summary == {"total": 2, "fixed": 1, "already_correct": 1}
    assert second.prev_hash is None
    assert second.self_hash is None
    assert updates == [
        (
            second,
            first.self_hash,
            audit_chain.compute_self_hash(second, first.self_hash),
        )
    ]


def test_backfill_refuses_to_resign_tampered_hash() -> None:
    row = _row("create", created_at=datetime(2026, 1, 1, tzinfo=UTC))
    row.prev_hash = audit_chain.GENESIS_HASH
    row.self_hash = audit_chain.compute_legacy_self_hash(row, row.prev_hash)
    original_hash = row.self_hash
    row.action = "delete"

    with pytest.raises(audit_chain.AuditChainIntegrityError, match="拒絕重簽"):
        _prepare_backfill([row])

    assert row.self_hash == original_hash


def test_backfill_refuses_hashed_rows_after_unhashed_gap() -> None:
    first = _row("create", created_at=datetime(2026, 1, 1, tzinfo=UTC))
    second = _row("approve", created_at=datetime(2026, 1, 2, tzinfo=UTC))
    third = _row("delete", created_at=datetime(2026, 1, 3, tzinfo=UTC))
    third.prev_hash = "some-existing-chain"
    third.self_hash = "f" * 64

    with pytest.raises(audit_chain.AuditChainIntegrityError, match="未簽章資料後"):
        _prepare_backfill([first, second, third])

    assert first.self_hash is None
    assert second.self_hash is None
