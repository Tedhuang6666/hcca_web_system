"""公告對象可見性守護測試（純邏輯，無需資料庫）。"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

from api.models.announcement import Announcement, AnnouncementAudience
from api.services.announcement import ViewerScope, is_visible_to


def _ann(
    audience: AnnouncementAudience,
    *,
    author_id: uuid.UUID | None = None,
    org_ids: list[uuid.UUID] | None = None,
    user_ids: list[uuid.UUID] | None = None,
) -> Announcement:
    ann = Announcement(
        title="測試公告",
        content={},
        author_id=author_id or uuid.uuid4(),
        audience_type=audience.value,
    )
    ann.audience_orgs = [SimpleNamespace(id=oid) for oid in (org_ids or [])]
    ann.audience_users = [SimpleNamespace(id=uid) for uid in (user_ids or [])]
    return ann


def test_all_audience_visible_to_anonymous_visitor() -> None:
    assert is_visible_to(_ann(AnnouncementAudience.ALL), ViewerScope()) is True


def test_school_audience_visible_to_school_user() -> None:
    scope = ViewerScope(user_id=uuid.uuid4(), is_school=True)
    assert is_visible_to(_ann(AnnouncementAudience.SCHOOL), scope) is True


def test_school_audience_hidden_from_external_user() -> None:
    scope = ViewerScope(user_id=uuid.uuid4(), is_school=False)
    assert is_visible_to(_ann(AnnouncementAudience.SCHOOL), scope) is False


def test_school_audience_hidden_from_anonymous_visitor() -> None:
    assert is_visible_to(_ann(AnnouncementAudience.SCHOOL), ViewerScope()) is False


def test_orgs_audience_visible_to_member_of_target_org() -> None:
    org_id = uuid.uuid4()
    ann = _ann(AnnouncementAudience.ORGS, org_ids=[org_id])
    scope = ViewerScope(user_id=uuid.uuid4(), org_ids=frozenset({org_id}))
    assert is_visible_to(ann, scope) is True


def test_orgs_audience_hidden_from_non_member() -> None:
    ann = _ann(AnnouncementAudience.ORGS, org_ids=[uuid.uuid4()])
    scope = ViewerScope(user_id=uuid.uuid4(), org_ids=frozenset({uuid.uuid4()}))
    assert is_visible_to(ann, scope) is False


def test_members_audience_visible_to_targeted_user() -> None:
    user_id = uuid.uuid4()
    ann = _ann(AnnouncementAudience.MEMBERS, user_ids=[user_id])
    assert is_visible_to(ann, ViewerScope(user_id=user_id)) is True


def test_members_audience_hidden_from_other_user() -> None:
    ann = _ann(AnnouncementAudience.MEMBERS, user_ids=[uuid.uuid4()])
    assert is_visible_to(ann, ViewerScope(user_id=uuid.uuid4())) is False


def test_members_audience_hidden_from_anonymous_visitor() -> None:
    ann = _ann(AnnouncementAudience.MEMBERS, user_ids=[uuid.uuid4()])
    assert is_visible_to(ann, ViewerScope()) is False


def test_author_always_sees_own_targeted_announcement() -> None:
    author_id = uuid.uuid4()
    ann = _ann(AnnouncementAudience.ORGS, author_id=author_id, org_ids=[uuid.uuid4()])
    # 作者不屬於對象組織，仍能看見自己發布的公告
    assert is_visible_to(ann, ViewerScope(user_id=author_id)) is True
