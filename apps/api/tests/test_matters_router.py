"""事項整合工作台 router 權限測試。"""


async def test_list_matters_without_manager_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    response = await authed_client_factory(member_user).get("/matters")

    assert response.status_code == 403


async def test_list_matters_as_admin_returns_200(admin_user, authed_client_factory) -> None:
    response = await authed_client_factory(admin_user).get("/matters")

    assert response.status_code == 200
