import time
from unittest.mock import AsyncMock

import pytest
from fastapi import APIRouter, FastAPI
from httpx import ASGITransport, AsyncClient

from api.core import rate_limit
from api.core.rate_limit import SimpleRateLimitMiddleware


def test_rate_limit_uses_registered_route_templates() -> None:
    app = FastAPI()

    @app.get("/shop/orders/summary")
    async def order_summary() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/shop/close-status")
    async def close_status() -> dict[str, bool]:
        return {"ok": True}

    @app.patch("/shop/orders/classes/{class_id}/payment")
    async def update_class_payment(class_id: str) -> dict[str, str]:
        return {"class_id": class_id}

    middleware = SimpleRateLimitMiddleware(
        app,
        enabled=True,
        requests=120,
        window_seconds=60,
    )

    assert middleware._route_template("/shop/orders/summary", app) == "/shop/orders/summary"
    assert middleware._route_template("/shop/close-status", app) == "/shop/close-status"
    assert (
        middleware._route_template(
            "/shop/orders/classes/11111111-1111-4111-8111-111111111111/payment",
            app,
        )
        == "/shop/orders/classes/{class_id}/payment"
    )
    assert (
        middleware._route_template(
            "/shop/orders/classes/22222222-2222-4222-8222-222222222222/payment",
            app,
        )
        == "/shop/orders/classes/{class_id}/payment"
    )


def test_rate_limit_keeps_unknown_paths_in_a_bounded_fallback_bucket() -> None:
    app = FastAPI()
    middleware = SimpleRateLimitMiddleware(
        app,
        enabled=True,
        requests=120,
        window_seconds=60,
    )

    assert middleware._route_template("/shop/unknown/one", app) == "/shop/{route}"
    assert middleware._route_template("/shop/unknown/two", app) == "/shop/{route}"


def test_rate_limit_resolves_nested_included_routers_with_effective_prefixes() -> None:
    app = FastAPI()
    orders = APIRouter(prefix="/orders")

    @orders.get("/summary")
    async def summary() -> dict[str, bool]:
        return {"ok": True}

    @orders.get("/{order_id:uuid}", include_in_schema=False)
    async def detail() -> dict[str, bool]:
        return {"ok": True}

    shop = APIRouter(prefix="/shop")
    shop.include_router(orders)
    app.include_router(shop)
    app.include_router(shop, prefix="/internal")
    middleware = SimpleRateLimitMiddleware(app, enabled=True, requests=120, window_seconds=60)

    for prefix in ("/shop", "/internal/shop"):
        assert (
            middleware._route_template(f"{prefix}/orders/summary", app)
            == f"{prefix}/orders/summary"
        )
        for order_id in (
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
        ):
            assert (
                middleware._route_template(f"{prefix}/orders/{order_id}", app)
                == f"{prefix}/orders/{{order_id:uuid}}"
            )


@pytest.mark.parametrize("redis_available", [True, False])
async def test_included_endpoints_have_independent_quotas(monkeypatch, redis_available) -> None:
    app = FastAPI()
    shop = APIRouter(prefix="/shop")

    @shop.get("/close-status")
    async def close_status() -> dict[str, bool]:
        return {"ok": True}

    @shop.get("/orders/{order_id}")
    async def order_detail(order_id: str) -> dict[str, str]:
        return {"id": order_id}

    app.include_router(shop)
    app.add_middleware(SimpleRateLimitMiddleware, enabled=True, requests=2, window_seconds=60)
    monkeypatch.setattr(
        rate_limit,
        "get_rate_limit_config",
        AsyncMock(
            return_value={"enabled": True, "global_requests": 2, "global_window_seconds": 60}
        ),
    )
    monkeypatch.setattr(rate_limit, "_redis_backoff_until", 0 if redis_available else float("inf"))
    monkeypatch.setattr(rate_limit, "_memory_buckets", rate_limit._BoundedMemoryBuckets())
    # Redis 的計數使用同樣的記憶體桶模擬，驗證 middleware 實際送出的分桶 key。
    if redis_available:
        counts: dict[str, int] = {}

        class Pipeline:
            def incr(self, key: str) -> None:
                self.key = key

            def expire(self, key: str, seconds: int) -> None:
                pass

            async def execute(self) -> tuple[int, bool]:
                counts[self.key] = counts.get(self.key, 0) + 1
                return counts[self.key], True

        monkeypatch.setattr(rate_limit.redis_client, "pipeline", Pipeline)
    # 避免測試剛好跨固定視窗邊界。
    monkeypatch.setattr(time, "time", lambda: 120)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for _ in range(2):
            assert (await client.get("/shop/close-status")).status_code == 200
        assert (await client.get("/shop/orders/one")).status_code == 200
        assert (await client.get("/shop/orders/two")).status_code == 200
        for path in ("/shop/close-status", "/shop/orders/three"):
            response = await client.get(path)
            assert response.status_code == 429
            assert response.headers["Retry-After"] == "60"
