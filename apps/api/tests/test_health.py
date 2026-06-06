"""健康檢查端點測試"""

import pytest
from httpx import ASGITransport, AsyncClient

import api
from api.main import app


@pytest.mark.asyncio
async def test_health_check() -> None:
    """測試 /health 端點回傳正確格式"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


@pytest.mark.asyncio
async def test_liveness_check() -> None:
    """測試 /live 不依賴外部服務。"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/live")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_readiness_check_returns_503_when_dependency_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """測試 /ready 會在 DB 或 Redis 不可用時回報 degraded。"""

    async def db_ok() -> tuple[bool, str | None]:
        return True, None

    async def redis_failed() -> tuple[bool, str | None]:
        return False, "ConnectionError"

    monkeypatch.setattr(api, "_check_database", db_ok)
    monkeypatch.setattr(api, "_check_redis", redis_failed)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/ready")

    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "degraded"
    assert data["checks"]["database"]["ok"] is True
    assert data["checks"]["redis"]["ok"] is False
