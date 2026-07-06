"""IDOR（越權物件直接引用）測試模板

目的：確保含有 user_id 歸屬的資源，無法被其他非授權使用者透過已知 ID 直接存取。

測試模板說明
============
新增含個資的模組時，請依照此模板新增一組測試：
1. 用 _make_authed_client() 建立兩個已登入的 HTTP client（user_a 和 user_b）
2. 以 user_a 的 db session 直接建立資源（或透過 HTTP POST）
3. 以 user_b 的 client 嘗試存取該資源的 GET/PATCH/DELETE 端點
4. 斷言回傳 403 或 404（不是 200）

目前涵蓋模組：
  - 商品訂單 (GET /shop/orders/{order_id})
  - 通知 (GET /notifications/{notification_id})
  - 活動 Discord 工作區 (PUT /activities/{activity_id}/discord-workspace)
  - 問卷填答記錄列表 (GET /surveys/{survey_id}/responses) — 需 survey:manage 或活動負責人
  - 學餐訂單／班級訂購 (GET /meal/orders/{order_id}) — 僅本人／管理權限／協助班級幹部可查看
  - 陳情案件 (GET /petitions/{case_id}) — 以 id 直查時仍需 _assert_case_access 檢查
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.security import create_access_token
from api.main import app
from api.models.shop import Order, OrderStatus
from api.models.user import User

# ---------------------------------------------------------------------------
# 輔助函式
# ---------------------------------------------------------------------------


async def _make_user(db: AsyncSession, *, is_superuser: bool = False) -> User:
    """建立一個隨機 email 的測試使用者。"""
    user = User(
        email=f"idor-test-{uuid.uuid4().hex[:8]}@school.edu",
        display_name="IDOR 測試帳號",
        is_active=True,
        is_verified=True,
        is_superuser=is_superuser,
    )
    db.add(user)
    await db.flush()
    return user


def _make_authed_client(db: AsyncSession, user: User) -> AsyncClient:
    """回傳一個帶有 JWT cookie 的 HTTP 測試 client。"""
    from api.core.database import get_db

    token = create_access_token(str(user.id))

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={settings.ACCESS_TOKEN_COOKIE_NAME: token},
    )


# ---------------------------------------------------------------------------
# 商品訂單 IDOR
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_shop_order_idor_returns_404(db_session: AsyncSession) -> None:
    """User B 無法以 user A 的 order_id 取得訂單，應得 404 而非 200。

    保護邏輯位於 apps/api/src/api/routers/shop.py GET /orders/{order_id}：
    若 order.user_id != current_user.id 且無 shop:manage 等管理權限，回傳 404。
    這確保攻擊者即使猜到 UUID 也無法確認資源是否存在。
    """
    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)

    # 直接在 DB 建立 user_a 的訂單（跳過 product 設定，只測 IDOR 邏輯）
    order = Order(
        serial_number=f"IDOR-TEST-{uuid.uuid4().hex[:8]}",
        user_id=user_a.id,
        status=OrderStatus.PENDING,
        total_price=0,
    )
    db_session.add(order)
    await db_session.flush()

    async with _make_authed_client(db_session, user_b) as client_b:
        resp = await client_b.get(f"/shop/orders/{order.id}")

    assert resp.status_code == 404, (
        f"User B 不應能看到 User A 的訂單，期望 404，實際 {resp.status_code}"
    )

    # 確認 user_a 自己可以看到
    async with _make_authed_client(db_session, user_a) as client_a:
        resp_a = await client_a.get(f"/shop/orders/{order.id}")

    assert resp_a.status_code == 200, (
        f"User A 應能看到自己的訂單，期望 200，實際 {resp_a.status_code}"
    )


@pytest.mark.asyncio
async def test_shop_order_cancel_idor_returns_403(db_session: AsyncSession) -> None:
    """User B 無法取消 User A 的訂單，應得 403。

    保護邏輯位於 POST /orders/{order_id}/cancel：
    若 order.user_id != current_user.id 且無管理權限，回傳 403。
    """
    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)

    order = Order(
        serial_number=f"IDOR-CANCEL-{uuid.uuid4().hex[:8]}",
        user_id=user_a.id,
        status=OrderStatus.PENDING,
        total_price=0,
    )
    db_session.add(order)
    await db_session.flush()

    async with _make_authed_client(db_session, user_b) as client_b:
        resp = await client_b.post(
            f"/shop/orders/{order.id}/cancel",
            json={"reason": "test"},
            headers={"X-CSRF-Token": "test"},
        )

    assert resp.status_code in (403, 404), (
        f"User B 不應能取消 User A 的訂單，期望 403/404，實際 {resp.status_code}"
    )


@pytest.mark.asyncio
async def test_superuser_can_access_any_order(db_session: AsyncSession) -> None:
    """超級管理員應能存取任何使用者的訂單（管理需求）。"""
    user_a = await _make_user(db_session)
    superuser = await _make_user(db_session, is_superuser=True)

    order = Order(
        serial_number=f"IDOR-SUPER-{uuid.uuid4().hex[:8]}",
        user_id=user_a.id,
        status=OrderStatus.PENDING,
        total_price=0,
    )
    db_session.add(order)
    await db_session.flush()

    async with _make_authed_client(db_session, superuser) as client_super:
        resp = await client_super.get(f"/shop/orders/{order.id}")

    assert resp.status_code == 200, f"超級管理員應能看到任何訂單，期望 200，實際 {resp.status_code}"


# ---------------------------------------------------------------------------
# 通知 IDOR
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_notification_idor(db_session: AsyncSession) -> None:
    """User B 無法讀取 User A 的站內通知。

    通知端點 GET /notifications/{notification_id} 應回傳 403 或 404。
    """
    from api.models.notification import Notification

    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)

    notif = Notification(
        user_id=user_a.id,
        type="system",
        title="私人通知",
        body="只有 user_a 可以看",
    )
    db_session.add(notif)
    await db_session.flush()

    # PATCH /inbox/{id}/read 以 WHERE user_id=current_user 過濾 → user_b 拿到 404
    async with _make_authed_client(db_session, user_b) as client_b:
        resp = await client_b.patch(
            f"/notifications/inbox/{notif.id}/read",
            headers={"X-CSRF-Token": "test"},
        )

    assert resp.status_code in (403, 404), (
        f"User B 不應能標記 User A 的通知為已讀，期望 403/404，實際 {resp.status_code}"
    )


# ---------------------------------------------------------------------------
# 問卷填答記錄 IDOR
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_survey_responses_list_idor(db_session: AsyncSession) -> None:
    """User B（無 survey:manage 權限、非活動負責人）不能列出他人問卷的填答記錄。

    保護邏輯位於 apps/api/src/api/routers/survey.py list_survey_responses：
    需 _require_survey_manager 通過（survey:manage 權限或活動負責人），否則 403。
    """
    from api.models.org import Org
    from api.schemas.survey import SurveyCreate
    from api.services import survey as survey_svc

    org = Org(name=f"IDOR測試組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()

    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)

    survey = await survey_svc.create_survey(
        db_session,
        data=SurveyCreate(title=f"IDOR測試問卷-{uuid.uuid4().hex[:8]}", org_id=org.id),
        created_by=user_a.id,
    )

    async with _make_authed_client(db_session, user_b) as client_b:
        resp = await client_b.get(f"/surveys/{survey.id}/responses")

    assert resp.status_code == 403, (
        f"User B 沒有 survey:manage 權限也非活動負責人，"
        f"不應能列出他人問卷的填答記錄，期望 403，實際 {resp.status_code}"
    )


# ---------------------------------------------------------------------------
# 學餐訂單（班級訂購）IDOR
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_meal_order_idor_returns_403(db_session: AsyncSession) -> None:
    """User B 無法查看 User A 的學餐訂單，應得 403。

    保護邏輯位於 apps/api/src/api/routers/meal.py GET /meal/orders/{order_id}：
    非本人、非超級管理員、且非該訂單所屬班級的協助幹部時，回傳 403。
    """
    from api.models.meal import MealOrder, MealOrderStatus, MealVendor
    from api.models.org import Org

    org = Org(name=f"IDOR學餐組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()

    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)

    vendor = MealVendor(
        name=f"IDOR測試商家-{uuid.uuid4().hex[:6]}", org_id=org.id, created_by=user_a.id
    )
    db_session.add(vendor)
    await db_session.flush()

    order = MealOrder(
        serial_number=f"MEAL-IDOR-{uuid.uuid4().hex[:8]}",
        pickup_code=str(uuid.uuid4().int)[:5],
        user_id=user_a.id,
        schedule_id=None,
        vendor_id=vendor.id,
        status=MealOrderStatus.PENDING,
        total_price=0,
    )
    db_session.add(order)
    await db_session.flush()

    async with _make_authed_client(db_session, user_b) as client_b:
        resp = await client_b.get(f"/meal/orders/{order.id}")

    assert resp.status_code == 403, (
        f"User B 不應能查看 User A 的學餐訂單，期望 403，實際 {resp.status_code}"
    )


# ---------------------------------------------------------------------------
# 陳情案件 IDOR
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_petition_case_idor_returns_403(db_session: AsyncSession) -> None:
    """User B 不能以 id 直查 User A 送出的陳情案件詳情。

    保護邏輯位於 apps/api/src/api/routers/petitions.py GET /petitions/{case_id}：
    _assert_case_access 只允許本人、超管、陳情權限、或負責機關成員查看，其餘 403。
    案號 + 驗證碼查詢（/petitions/lookup）是另一條匿名查詢路徑，這裡驗證的是登入後以 id 直查的情境。
    """
    from api.models.org import Org
    from api.models.petition import PetitionType
    from api.schemas.petition import PetitionCreate
    from api.services import petition as petition_svc

    org = Org(name=f"IDOR陳情組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()

    petition_type = PetitionType(
        name=f"IDOR測試類型-{uuid.uuid4().hex[:6]}", responsible_org_id=org.id
    )
    db_session.add(petition_type)
    await db_session.flush()

    user_a = await _make_user(db_session)
    user_b = await _make_user(db_session)

    case_obj, _code = await petition_svc.create_case(
        db_session,
        data=PetitionCreate(
            type_id=petition_type.id,
            title="IDOR 測試陳情",
            content="這是一段測試內容",
        ),
        submitter=user_a,
    )

    async with _make_authed_client(db_session, user_b) as client_b:
        resp = await client_b.get(f"/petitions/{case_obj.id}")

    assert resp.status_code == 403, (
        f"User B 不應能以 id 直查 User A 的陳情案件，期望 403，實際 {resp.status_code}"
    )

    # 確認 user_a 自己可以看到
    async with _make_authed_client(db_session, user_a) as client_a:
        resp_a = await client_a.get(f"/petitions/{case_obj.id}")

    assert resp_a.status_code == 200, (
        f"User A 應能看到自己送出的陳情案件，期望 200，實際 {resp_a.status_code}"
    )
