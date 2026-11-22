"""匯出試算表時，使用者文字不得被當成公式執行。"""

from __future__ import annotations

from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.spreadsheet import safe_cell, safe_mapping, safe_row
from api.models.user import User
from api.services import audit as audit_svc


def test_formula_like_text_is_neutralised() -> None:
    assert safe_cell('=HYPERLINK("https://evil.example","點我")').startswith("'=")
    assert safe_cell("+1+1") == "'+1+1"
    assert safe_cell("-2") == "'-2"
    assert safe_cell("@SUM(A1)") == "'@SUM(A1)"
    assert safe_cell("  =1") == "'  =1"


def test_plain_values_are_unchanged() -> None:
    assert safe_cell("活動費用") == "活動費用"
    assert safe_cell(-5) == -5
    assert safe_cell(None) is None
    assert safe_row(["a", "=b"]) == ["a", "'=b"]
    assert safe_mapping({"x": "=y", "n": 3}) == {"x": "'=y", "n": 3}


async def test_audit_csv_export_escapes_user_controlled_summary(
    db_session: AsyncSession,
    admin_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
) -> None:
    await audit_svc.record(
        db_session,
        entity_type="test",
        entity_id="1",
        action="test.formula",
        actor_id=str(admin_user.id),
        actor_email=admin_user.email,
        summary='=HYPERLINK("https://evil.example")',
    )
    await db_session.flush()

    response = await authed_client_factory(admin_user).get("/audit-logs/export.csv")

    assert response.status_code == 200
    assert "'=HYPERLINK" in response.text
    assert ",=HYPERLINK" not in response.text
