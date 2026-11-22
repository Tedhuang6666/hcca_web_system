"""使用者姓名搜尋：校外帳號不能列舉校內成員。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from httpx import AsyncClient

from api.models.user import User


async def test_external_account_cannot_enumerate_users(
    make_user: Callable[..., Any], authed_client_factory: Callable[[User], AsyncClient]
) -> None:
    await make_user(email="wang@hchs.hc.edu.tw", display_name="王小明")
    outsider = await make_user(email="someone@gmail.com", display_name="校外訪客")
    student = await make_user(email="student@gmail.com", display_name="在校生", student_id="11501")

    outsider_result = await authed_client_factory(outsider).get("/users", params={"search": "王小"})
    student_result = await authed_client_factory(student).get("/users", params={"search": "王小"})

    assert outsider_result.status_code == 200
    assert outsider_result.json() == []
    assert [row["display_name"] for row in student_result.json()] == ["王小明"]


async def test_admin_search_is_unaffected(
    make_user: Callable[..., Any],
    admin_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
) -> None:
    await make_user(email="lin@hchs.hc.edu.tw", display_name="林小華")

    response = await authed_client_factory(admin_user).get("/users", params={"search": "林小"})

    assert [row["display_name"] for row in response.json()] == ["林小華"]
