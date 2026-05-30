"""Per-module maintenance + 自動斷路器。"""

from __future__ import annotations

import contextlib

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api import app
from api.core import maintenance as maint
from api.core import module_health
from api.core.config import settings
from api.core.load_shed import _can_bypass_protection
from api.core.modules import MODULE_IDS, match_module
from api.core.security import create_access_token, redis_client
from api.dependencies.auth import get_current_active_user
from api.models.user import User


@pytest_asyncio.fixture(autouse=True)
async def _clean_module_state():
    """每個 test 後清掉所有模組維護 / 重置旗標與 per-worker 計數，避免跨 test 污染。"""
    yield
    for mid in MODULE_IDS:
        await maint.clear_module_maintenance(mid)
        with contextlib.suppress(Exception):
            await redis_client.delete(maint.MODULE_RESET_PREFIX + mid)
    maint.clear_cache()
    module_health._events.clear()
    module_health._tripped_until.clear()


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def _seed_users(db: AsyncSession) -> tuple[User, User]:
    admin = User(
        email="mod-admin@school.edu",
        display_name="模組管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    member = User(
        email="mod-member@school.edu",
        display_name="一般使用者",
        is_active=True,
        is_verified=True,
    )
    db.add_all([admin, member])
    await db.flush()
    return admin, member


def test_match_module_respects_segment_boundary() -> None:
    assert match_module("/documents") == "documents"
    assert match_module("/documents/abc") == "documents"
    # /documents-approve 是 documents 模組的獨立前綴，不被 /documents 邊界吃掉
    assert match_module("/documents-approve") == "documents"
    assert match_module("/documents-approve/5") == "documents"
    assert match_module("/shop") == "shop"
    assert match_module("/shop/cart") == "shop"
    # 邊界：非 segment 邊界不命中
    assert match_module("/shop-other") is None
    # 核心通道不屬於任何可維護模組
    assert match_module("/auth/me") is None
    assert match_module("/admin/system/status") is None


async def test_module_maintenance_blocks_target_module_returns_503(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await maint.set_module_maintenance("shop", on=True, source="manual", reason="資料修復中")
    maint.clear_cache()

    resp = await client.get("/shop")
    assert resp.status_code == 503
    body = resp.json()
    assert body["module_maintenance"] is True
    assert body["module"] == "shop"

    # 其他模組不受影響
    other = await client.get("/surveys")
    assert other.status_code != 503


async def test_module_maintenance_blocks_non_admin_but_admin_bypasses(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    # 非 admin（無 JWT）在模組維護時被擋
    await maint.set_module_maintenance("surveys", on=True, source="manual")
    maint.clear_cache()
    blocked = await client.get("/surveys")
    assert blocked.status_code == 503

    # middleware 以 JWT claim 判斷 bypass（純函式，不查 DB）：admin 放行、匿名被擋
    token = create_access_token("admin-subject", {"is_admin": True})
    admin_scope = {
        "type": "http",
        "headers": [(b"cookie", f"{settings.ACCESS_TOKEN_COOKIE_NAME}={token}".encode())],
    }
    anon_scope = {"type": "http", "headers": []}
    assert _can_bypass_protection(admin_scope) is True
    assert _can_bypass_protection(anon_scope) is False


async def test_set_module_maintenance_requires_superuser_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, member = await _seed_users(db_session)
    _override_user(member)

    resp = await client.put("/admin/system/modules/shop/maintenance", json={"on": True})
    assert resp.status_code == 403


async def test_set_module_maintenance_unknown_id_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, _ = await _seed_users(db_session)
    _override_user(admin)

    resp = await client.put("/admin/system/modules/does-not-exist/maintenance", json={"on": True})
    assert resp.status_code == 404


async def test_module_circuit_trips_after_threshold_5xx() -> None:
    mod = "petitions"
    threshold = settings.MODULE_CIRCUIT_5XX_THRESHOLD

    # 503 是保護性回應，不可計入（否則維護→503→再次跳閘的自我維持迴圈）
    for _ in range(threshold + 5):
        module_health.record_module_status(mod, 503)
    assert module_health.module_5xx_count(mod) == 0

    for _ in range(threshold):
        module_health.record_module_status(mod, 500)
    assert module_health.module_5xx_count(mod) == threshold

    await module_health.maybe_trip_module(mod)
    state = await maint.get_module_maintenance(mod)
    assert state is not None
    assert state["on"] is True
    assert state["source"] == "auto"


async def test_restart_module_clears_maintenance_and_resets_window(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, _ = await _seed_users(db_session)
    _override_user(admin)

    await maint.set_module_maintenance("meal", on=True, source="manual", reason="x")
    maint.clear_cache()

    resp = await client.post("/admin/system/modules/meal/restart")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    maint.clear_cache()
    assert await maint.get_module_maintenance("meal") is None
    assert await maint.get_module_reset("meal") > 0
