"""段考題下載資格：校友不沿用校內學生的校內成員資格。"""

from collections.abc import Callable

import pytest

from api.core.config import settings
from api.models.user import User
from api.services.exam_paper import can_download_exam_papers


@pytest.mark.parametrize(
    ("email", "student_id", "expected"),
    [
        ("g0110001@hchs.hc.edu.tw", "110001", False),
        ("g0510001@hchs.hc.edu.tw", "510001", True),
        ("teacher@hchs.hc.edu.tw", None, True),
        ("outside@example.test", None, False),
    ],
)
async def test_exam_paper_download_access_by_school_identity(
    db_session,
    make_user: Callable[..., User],
    monkeypatch: pytest.MonkeyPatch,
    email: str,
    student_id: str | None,
    expected: bool,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOWED_EMAIL_DOMAINS", ["hchs.hc.edu.tw"])
    user = await make_user(email=email, student_id=student_id)

    assert await can_download_exam_papers(db_session, user) is expected
