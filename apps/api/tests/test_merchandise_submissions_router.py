"""校商投稿 HTTP 流程測試。"""

from __future__ import annotations

from collections.abc import Callable

from httpx import AsyncClient

from api.models.user import User


async def test_merchandise_submission_portal_requires_login(client: AsyncClient) -> None:
    response = await client.get("/merchandise-submissions/portal")
    assert response.status_code == 401


async def test_merchandise_submission_flow_uses_school_account_and_notifies_submitter(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
) -> None:
    admin = authed_client_factory(admin_user)
    student = authed_client_factory(member_user)
    settings_response = await admin.patch(
        "/merchandise-submissions/admin/settings",
        json={"is_open": True, "max_file_size_mb": 100},
    )
    assert settings_response.status_code == 200

    item_response = await admin.post(
        "/merchandise-submissions/admin/items",
        json={
            "name": "運動衫",
            "specification": "請交正面圖稿",
            "template_images": [{"url": "/uploads/template.png", "label": "正面範本"}],
            "custom_fields": [
                {
                    "key": "design_name",
                    "label": "設計名稱",
                    "field_type": "text",
                    "required": True,
                    "max_length": 50,
                }
            ],
        },
    )
    assert item_response.status_code == 201
    item_id = item_response.json()["id"]

    portal_response = await student.get("/merchandise-submissions/portal")
    assert portal_response.status_code == 200
    assert portal_response.json()["items"][0]["is_accepting"] is True
    assert portal_response.json()["items"][0]["effective_max_file_size_mb"] == 100

    upload_response = await student.post(
        f"/merchandise-submissions/uploads?item_id={item_id}",
        files={"file": ("design.png", b"\x89PNG\r\n\x1a\nminimal", "image/png")},
    )
    assert upload_response.status_code == 200
    uploaded = upload_response.json()

    submit_response = await student.post(
        "/merchandise-submissions/submissions",
        json={
            "item_id": item_id,
            "field_values": {"design_name": "校園動能"},
            "files": [uploaded],
        },
    )
    assert submit_response.status_code == 201
    submission = submit_response.json()
    assert submission["status"] == "submitted"
    assert submission["account_snapshot"]["email"] == member_user.email
    assert submission["files"][0]["filename"] == "design.png"

    review_response = await admin.patch(
        f"/merchandise-submissions/admin/submissions/{submission['id']}/review",
        json={"status": "revision_requested", "review_note": "請補上背面圖稿"},
    )
    assert review_response.status_code == 200
    assert review_response.json()["status"] == "revision_requested"

    mine_response = await student.get("/merchandise-submissions/submissions/me")
    assert mine_response.status_code == 200
    assert mine_response.json()[0]["review_note"] == "請補上背面圖稿"
