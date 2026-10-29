from fastapi import FastAPI

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
