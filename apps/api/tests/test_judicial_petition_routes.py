"""評議委員會訴訟路由測試。"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.user import User

PETITION_BODY = {
    "petitioner_name": "測試聲請人",
    "petitioner_email": "petitioner@school.edu",
    "petition_type": "constitutional_norm_review",
    "title": "測試聲請",
    "challenged_norm": "受挑戰規範",
    "constitutional_provisions": "上位規範依據",
    "petition_claim": "聲請事項",
    "facts_and_reasons": "事實及理由",
}


@pytest.mark.asyncio
async def test_create_judicial_petition_without_auth_returns_401(
    client: AsyncClient,
) -> None:
    response = await client.post("/judicial-petitions", json=PETITION_BODY)

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_judicial_petition_by_external_user_returns_403(
    client: AsyncClient,
) -> None:
    external_user = User(
        email="external@example.com",
        display_name="校外使用者",
        is_active=True,
        is_verified=True,
    )

    async def override_user() -> User:
        return external_user

    app.dependency_overrides[get_current_active_user] = override_user

    response = await client.post("/judicial-petitions", json=PETITION_BODY)

    assert response.status_code == 403
    assert response.json()["detail"] == "僅限校內成員使用"
