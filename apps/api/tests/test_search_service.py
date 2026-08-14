from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

from api.services.document._access import decode_document_cursor, encode_document_cursor
from api.services.search import _meili_visibility_filter


def test_meili_visibility_filter_requires_document_audience_match() -> None:
    viewer_id = uuid.uuid4()
    org_id = uuid.uuid4()
    class_id = uuid.uuid4()
    expression = _meili_visibility_filter(
        viewer_id=viewer_id,
        org_ids={org_id},
        subject_org_ids=set(),
        class_ids={class_id},
        email="student@example.edu",
    )

    assert '(kind = "document"' in expression
    assert f'created_by = "{viewer_id}"' in expression
    assert f'org_id IN ["{org_id}"]' in expression
    assert f'recipient_class_ids IN ["{class_id}"]' in expression
    assert 'kind = "regulation" AND is_published = true' in expression
    assert 'kind = "announcement" AND is_published = true AND audience_type = "all"' in expression


def test_document_cursor_round_trip() -> None:
    document_id = uuid.uuid4()
    created_at = datetime(2026, 8, 15, 12, 30, tzinfo=UTC)
    cursor = encode_document_cursor(SimpleNamespace(id=document_id, created_at=created_at))

    assert decode_document_cursor(cursor) == (created_at, document_id)


def test_document_cursor_rejects_tampering() -> None:
    try:
        decode_document_cursor("not-a-cursor")
    except ValueError as exc:
        assert str(exc) == "無效的公文 cursor"
    else:  # pragma: no cover - assertion guard
        raise AssertionError("invalid cursor should fail")
