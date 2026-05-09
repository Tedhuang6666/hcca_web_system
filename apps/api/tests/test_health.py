"""健康檢查端點測試"""

import pytest
from httpx import ASGITransport, AsyncClient

from api import app


@pytest.mark.asyncio
async def test_health_check() -> None:
    """測試 /health 端點回傳正確格式"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data
