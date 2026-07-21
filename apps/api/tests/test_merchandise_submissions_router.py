"""校商投稿 HTTP 流程測試。"""

from __future__ import annotations

from collections.abc import Callable
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Org
from api.models.user import User


async def test_merchandise_submission_portal_requires_login(client: AsyncClient) -> None:
    response = await client.get("/merchandise-submissions/portal")
    assert response.status_code == 401


async def test_merchandise_submission_flow_uses_school_account_and_notifies_submitter(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    admin = authed_client_factory(admin_user)
    student = authed_client_factory(member_user)
    settings_response = await admin.patch(
        "/merchandise-submissions/admin/settings",
        json={
            "is_open": True,
            "max_file_size_mb": 100,
            "require_school_email": False,
            "submission_intro": "請說明 **用色元素** 與設計理念。",
            "global_fields": [
                {
                    "key": "student_name",
                    "label": "姓名",
                    "field_type": "text",
                    "required": True,
                    "max_length": 50,
                },
                {
                    "key": "seat_number",
                    "label": "座號",
                    "field_type": "text",
                    "required": True,
                    "max_length": 10,
                },
            ],
        },
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
    assert portal_response.json()["settings"]["submission_intro"] == (
        "請說明 **用色元素** 與設計理念。"
    )
    assert [field["key"] for field in portal_response.json()["items"][0]["custom_fields"]] == [
        "student_name",
        "seat_number",
        "design_name",
    ]

    upload_response = await student.post(
        f"/merchandise-submissions/uploads?item_id={item_id}",
        files={"file": ("design.png", b"\x89PNG\r\n\x1a\nminimal", "image/png")},
    )
    assert upload_response.status_code == 200
    uploaded = upload_response.json()
    preview_response = await student.get(uploaded["url"])
    assert preview_response.status_code == 200

    draft_response = await student.post(
        "/merchandise-submissions/submissions?submit=false",
        json={"item_id": item_id, "field_values": {}, "files": []},
    )
    assert draft_response.status_code == 201
    draft = draft_response.json()
    assert draft["status"] == "draft"

    update_draft_response = await student.patch(
        f"/merchandise-submissions/submissions/{draft['id']}?submit=false",
        json={
            "item_id": item_id,
            "field_values": {"design_name": "草稿中的校園動能"},
            "files": [{**uploaded, "filename": "校園動能草稿.png"}],
        },
    )
    assert update_draft_response.status_code == 200
    assert update_draft_response.json()["files"][0]["filename"] == "校園動能草稿.png"

    submit_response = await student.patch(
        f"/merchandise-submissions/submissions/{draft['id']}?submit=true",
        json={
            "item_id": item_id,
            "field_values": {
                "student_name": "王小明",
                "seat_number": "12",
                "design_name": "校園動能",
            },
            "files": [uploaded],
        },
    )
    assert submit_response.status_code == 200
    submission = submit_response.json()
    assert submission["status"] == "submitted"
    assert submission["account_snapshot"]["email"] == member_user.email
    assert submission["files"][0]["filename"] == "design.png"

    student_forbidden_response = await student.post(
        f"/merchandise-submissions/admin/submissions/{submission['id']}/files",
        files={"file": ("forbidden.png", b"\x89PNG\r\n\x1a\nminimal", "image/png")},
    )
    assert student_forbidden_response.status_code == 403

    add_file_response = await admin.post(
        f"/merchandise-submissions/admin/submissions/{submission['id']}/files",
        files={"file": ("back.png", b"\x89PNG\r\n\x1a\nminimal", "image/png")},
    )
    assert add_file_response.status_code == 201
    assert len(add_file_response.json()["files"]) == 2
    added_file = next(
        file for file in add_file_response.json()["files"] if file["filename"] == "back.png"
    )

    replace_file_response = await admin.put(
        f"/merchandise-submissions/admin/submissions/{submission['id']}/files/{added_file['id']}",
        files={"file": ("back-revised.png", b"\x89PNG\r\n\x1a\nminimal", "image/png")},
    )
    assert replace_file_response.status_code == 200
    assert len(replace_file_response.json()["files"]) == 2
    assert any(
        file["filename"] == "back-revised.png" for file in replace_file_response.json()["files"]
    )

    with patch("api.email.sender.enqueue_email", return_value="task-id") as enqueue_email:
        review_response = await admin.patch(
            f"/merchandise-submissions/admin/submissions/{submission['id']}/review",
            json={"status": "revision_requested", "review_note": "請補上背面圖稿"},
        )
        assert review_response.status_code == 200
        assert review_response.json()["status"] == "revision_requested"
        assert review_response.json()["review_note"] == "請補上背面圖稿"

        resubmit_response = await student.patch(
            f"/merchandise-submissions/submissions/{submission['id']}?submit=true",
            json={
                "item_id": item_id,
                "field_values": {
                    "student_name": "王小明",
                    "seat_number": "12",
                    "design_name": "校園動能修正版",
                },
                "files": [uploaded],
            },
        )
        assert resubmit_response.status_code == 200
        assert resubmit_response.json()["status"] == "submitted"

        review_completed_response = await admin.patch(
            f"/merchandise-submissions/admin/submissions/{submission['id']}/review",
            json={"status": "review_completed"},
        )
        assert review_completed_response.status_code == 200
        assert review_completed_response.json()["status"] == "review_completed"

        voting_org = Org(name="校商投稿投票組織")
        db_session.add(voting_org)
        await db_session.flush()
        survey_response = await admin.post(
            "/merchandise-submissions/admin/voting-survey/prepare",
            json={"org_id": str(voting_org.id)},
        )
        assert survey_response.status_code == 201
        survey_id = survey_response.json()["id"]
        assert len(survey_response.json()["questions"]) == 1
        assert survey_response.json()["questions"][0]["question_type"] == "multiple"
        assert len(survey_response.json()["questions"][0]["option_image_sets"]) == 1
        open_survey_response = await admin.post(f"/surveys/{survey_id}/open")
        assert open_survey_response.status_code == 200
        voting_preview_response = await student.get(uploaded["url"])
        assert voting_preview_response.status_code == 200
        linked_response = await admin.get("/merchandise-submissions/admin/submissions")
        linked = next(row for row in linked_response.json() if row["id"] == submission["id"])
        assert linked["voting_survey_id"] == survey_id
        assert linked["voting_survey_title"] == "校商投稿全校票選"

        approve_response = await admin.patch(
            f"/merchandise-submissions/admin/submissions/{submission['id']}/review",
            json={"status": "approved"},
        )
        assert approve_response.status_code == 200
        assert approve_response.json()["status"] == "approved"

    assert enqueue_email.call_count == 3
    subjects = [call.args[1] for call in enqueue_email.call_args_list]
    assert "需要補件" in subjects[0]
    assert "審核完成" in subjects[1]
    assert "已採用" in subjects[2]

    mine_response = await student.get("/merchandise-submissions/submissions/me")
    assert mine_response.status_code == 200
    assert mine_response.json()[0]["status"] == "approved"
    assert mine_response.json()[0]["review_note"] is None


async def test_merchandise_submission_rejects_non_school_email_when_required(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
) -> None:
    admin = authed_client_factory(admin_user)
    student = authed_client_factory(member_user)
    settings_response = await admin.patch(
        "/merchandise-submissions/admin/settings",
        json={
            "is_open": False,
            "opens_at": "2020-01-01T00:00:00Z",
            "closes_at": "2099-01-01T00:00:00Z",
            "require_school_email": True,
            "announcement_title": "校商投稿已開放",
            "announcement": "請把握投稿時間。",
            "show_announcement_popup": True,
        },
    )
    assert settings_response.status_code == 200
    assert settings_response.json()["announcement_id"]
    assert settings_response.json()["show_announcement_popup"] is True
    announcement_id = settings_response.json()["announcement_id"]

    announcement_response = await admin.get(f"/announcements/{announcement_id}")
    assert announcement_response.status_code == 200
    assert announcement_response.json()["content"] == {
        "format": "markdown",
        "markdown": "請把握投稿時間。",
    }

    item_response = await admin.post(
        "/merchandise-submissions/admin/items",
        json={"name": "校務信箱限定品項"},
    )
    assert item_response.status_code == 201
    item_id = item_response.json()["id"]

    portal_response = await student.get("/merchandise-submissions/portal")
    assert portal_response.status_code == 200
    assert portal_response.json()["is_eligible_submitter"] is False
    assert portal_response.json()["items"][0]["is_accepting"] is True

    upload_response = await student.post(
        f"/merchandise-submissions/uploads?item_id={item_id}",
        files={"file": ("design.png", b"\x89PNG\r\n\x1a\nminimal", "image/png")},
    )
    assert upload_response.status_code == 403

    submit_response = await student.post(
        "/merchandise-submissions/submissions",
        json={"item_id": item_id, "field_values": {}, "files": []},
    )
    assert submit_response.status_code == 403
