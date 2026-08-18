from __future__ import annotations

from api.core.trusted_proxy import TrustedProxyMiddleware


async def _capture_scope(scope: dict, _receive: object, _send: object) -> None:
    _capture_scope.client = scope.get("client")


async def _run_middleware(headers: list[tuple[bytes, bytes]]) -> tuple[str, int]:
    middleware = TrustedProxyMiddleware(
        _capture_scope,
        enabled=True,
        extra_cidrs=["172.19.0.0/16"],
    )
    await middleware(
        {
            "type": "http",
            "client": ("172.19.0.13", 12345),
            "headers": headers,
        },
        None,
        None,
    )
    return _capture_scope.client


async def test_cf_connecting_ip_takes_precedence() -> None:
    assert await _run_middleware(
        [(b"cf-connecting-ip", b"203.0.113.10"), (b"x-forwarded-for", b"198.51.100.10")]
    ) == ("203.0.113.10", 12345)


async def test_x_forwarded_for_is_fallback() -> None:
    assert await _run_middleware([(b"x-forwarded-for", b"203.0.113.11, 104.22.17.211")]) == (
        "203.0.113.11",
        12345,
    )
