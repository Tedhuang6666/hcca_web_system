"""公開閱讀契約的純資料回歸。"""

import uuid
from datetime import UTC, datetime

from api.schemas.regulation import RegulationOut


def test_article_count_serializes_only_non_deleted_article_nodes() -> None:
    regulation_id, creator_id = uuid.uuid4(), uuid.uuid4()
    now = datetime.now(UTC)
    kinds = ["article"] * 23 + ["chapter"] * 6 + ["subparagraph"] * 23
    kinds += ["volume", "section", "paragraph", "item", "article"]
    articles = [
        dict(
            id=uuid.uuid4(),
            regulation_id=regulation_id,
            lineage_id=uuid.uuid4(),
            sort_index=index,
            order_index=index,
            parent_id=None,
            article_type=kind,
            title="原始節點",
            subtitle="",
            legal_number=None,
            content="原始條文",
            is_deleted=index == len(kinds) - 1,
            frozen_by=None,
            created_at=now,
            updated_at=now,
        )
        for index, kind in enumerate(kinds)
    ]
    regulation = RegulationOut.model_validate(
        dict(
            id=regulation_id,
            title="學生會組織條例",
            category="ordinance",
            content="",
            preface=None,
            version=1,
            is_active=True,
            workflow_status="published",
            workflow_note=None,
            org_id=uuid.uuid4(),
            created_by=creator_id,
            published_at=now,
            created_at=now,
            updated_at=now,
            articles=articles,
        )
    )
    assert regulation.model_dump(mode="json")["article_count"] == 23
    assert len(regulation.articles) == 57
    regulation.articles = []
    assert regulation.model_dump(mode="json")["article_count"] == 0
