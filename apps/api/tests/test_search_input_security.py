"""資料庫文字查詢應拒絕 PostgreSQL 無法儲存的空字元。"""

from datetime import UTC, datetime

import pytest

from api.core.config import settings
from api.models.org import Org
from api.models.regulation import (
    Regulation,
    RegulationCategory,
    RegulationWorkflowStatus,
)


@pytest.fixture(autouse=True)
def _exercise_application_validation(monkeypatch):
    # WAF 已有獨立回歸；本案例必須到達 query validation，不能被 WAF 擋住。
    monkeypatch.setattr(settings, "WAF_ENABLED", False)


@pytest.mark.parametrize(
    ("path", "parameter"),
    [
        ("/regulations/search", "keyword"),
        ("/regulations", "keyword"),
        ("/documents", "keyword"),
        ("/documents", "serial_prefix"),
        ("/documents", "handler_keyword"),
        ("/documents", "recipient_keyword"),
    ],
)
async def test_search_rejects_null_byte_before_database(client, path, parameter):
    rejected = await client.get(path, params={parameter: "security\x00"})
    assert rejected.status_code == 422
    assert any(item["loc"] == ["query", parameter] for item in rejected.json()["errors"])
    valid = await client.get(path, params={parameter: "安全性 ' 測試"})
    assert valid.status_code == 200


@pytest.mark.parametrize("keyword", ["alpha beta", "alpha ' beta", "alpha ) beta", "alpha | beta"])
async def test_plain_text_search_keeps_all_terms(
    db_session, make_user, authed_client_factory, keyword
):
    owner = await make_user()
    org = Org(name="Search controls")
    db_session.add(org)
    await db_session.flush()
    rows = [
        Regulation(
            title=title,
            category=RegulationCategory.ORDINANCE,
            org_id=org.id,
            created_by=owner.id,
        )
        for title in ["alpha beta", "alpha only", "beta only"]
    ]
    db_session.add_all(rows)
    await db_session.flush()
    response = await authed_client_factory(owner).get("/regulations", params={"keyword": keyword})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(rows[0].id)]


@pytest.mark.parametrize(
    "keyword",
    ["missing' OR '1'='1'--", "missing' UNION SELECT NULL--"],
)
async def test_regulations_search_treats_sql_payload_as_plain_text(
    db_session, client, make_user, keyword
):
    owner = await make_user()
    org = Org(name="SQL injection search isolation")
    db_session.add(org)
    await db_session.flush()
    regulation = Regulation(
        title="search-isolation-sentinel",
        category=RegulationCategory.ORDINANCE,
        org_id=org.id,
        created_by=owner.id,
        content="search-isolation-sentinel",
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )
    db_session.add(regulation)
    await db_session.flush()

    control = await client.get("/regulations/search", params={"keyword": regulation.title})
    assert control.status_code == 200, control.text
    assert [row["id"] for row in control.json()] == [str(regulation.id)]

    response = await client.get("/regulations/search", params={"keyword": keyword})
    assert response.status_code == 200, response.text
    assert response.json() == []
