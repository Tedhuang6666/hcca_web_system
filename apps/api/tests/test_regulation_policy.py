from __future__ import annotations

import uuid

import pytest

from api.models.regulation import RegulationWorkflowStatus
from api.services.regulation_consistency import audit_regulation_document_consistency
from api.schemas.regulation import RegulationArticleCreate, RegulationPublishRequest
from api.services import regulation as reg_svc


def test_create_article_with_legacy_type_rejected() -> None:
    with pytest.raises(ValueError):
        RegulationArticleCreate(
            sort_index=10,
            article_type="clause",
            title="第一條",
            content="測試",
        )


@pytest.mark.asyncio
async def test_publish_regulation_disabled_requires_president_publish() -> None:
    with pytest.raises(ValueError, match="president_publish"):
        await reg_svc.publish_regulation(
            session=None,  # type: ignore[arg-type]
            reg=None,  # type: ignore[arg-type]
            data=RegulationPublishRequest(change_brief="test"),
            published_by=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_transition_reject_requires_note() -> None:
    from api.models.regulation import Regulation, RegulationCategory

    class FakeSession:
        def add(self, _obj) -> None:
            return None

        async def flush(self) -> None:
            return None

    reg = Regulation(
        title="測試法規",
        category=RegulationCategory.EXECUTIVE_DEPT,
        content="",
        org_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        workflow_status=RegulationWorkflowStatus.UNDER_REVIEW,
    )

    with pytest.raises(ValueError, match="退回法規必須填寫退回原因"):
        await reg_svc.transition_workflow(
            FakeSession(),  # type: ignore[arg-type]
            reg,
            to_status=RegulationWorkflowStatus.REJECTED,
            actor_id=uuid.uuid4(),
            note="",
        )


@pytest.mark.asyncio
async def test_consistency_audit_flags_missing_published_document() -> None:
    from api.models.regulation import Regulation, RegulationCategory

    class _ScalarResult:
        def __init__(self, items):
            self._items = items

        def scalars(self):
            return self

        def all(self):
            return self._items

    class FakeSession:
        def __init__(self, regs):
            self._regs = regs
            self._exec_calls = 0

        async def execute(self, _stmt):
            self._exec_calls += 1
            if self._exec_calls == 1:
                return _ScalarResult(self._regs)
            return _ScalarResult([])

        async def get(self, _model, _id):
            return None

    reg = Regulation(
        title="測試法規",
        category=RegulationCategory.EXECUTIVE_DEPT,
        content="",
        org_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
    )
    reg.published_document_id = None
    result = await audit_regulation_document_consistency(FakeSession([reg]))  # type: ignore[arg-type]
    assert result["problem_count"] >= 1
    assert any(p["type"] == "published_regulation_missing_document" for p in result["problems"])
