"""學生首次登入班級確認：使用真實 DB session 驗證資格、歸戶及跨帳戶保護。"""

import uuid
from collections.abc import Callable

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.class_confirmation import ClassConfirmation
from api.models.electronic_credential import ElectronicCredentialSettings
from api.models.school_class import ClassManualMember, ClassRosterEntry, SchoolClass
from api.models.user import User
from api.schemas.school_class import SchoolClassCreate
from api.services import school_class as class_svc


@pytest.fixture(autouse=True)
def school_domain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOWED_EMAIL_DOMAINS", ["hchs.hc.edu.tw"])


async def make_class(db: AsyncSession, creator: User, **overrides) -> SchoolClass:
    return await class_svc.create_class(
        db,
        data=SchoolClassCreate(
            academic_year=115, class_code=uuid.uuid4().hex[:6], grade=1, **overrides
        ),
        created_by=creator.id,
    )


async def test_confirmation_requires_login(client: AsyncClient) -> None:
    assert (await client.get("/classes/me/confirmation")).status_code == 401
    response = await client.post(
        "/classes/me/confirmation", json={"class_id": str(uuid.uuid4()), "seat_number": 1}
    )
    assert response.status_code == 401


@pytest.mark.parametrize(
    ("email", "student_id", "superuser", "expected"),
    [
        ("g0510001@hchs.hc.edu.tw", "510001", False, True),
        ("g0510001@example.com", "510001", False, False),
        ("teacher@hchs.hc.edu.tw", None, False, False),
        ("g0110001@hchs.hc.edu.tw", "110001", False, False),
        ("g0210001@hchs.hc.edu.tw", "210001", False, False),
        ("g0510001@hchs.hc.edu.tw", "410001", False, False),
        ("g0510001@hchs.hc.edu.tw", "510001", True, False),
    ],
)
async def test_only_current_school_students_need_confirmation(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable,
    email: str,
    student_id: str | None,
    superuser: bool,
    expected: bool,
) -> None:
    user = await make_user(email=email, student_id=student_id, is_superuser=superuser)
    ac = authed_client_factory(user)
    assert (await ac.get("/auth/me")).json()["requires_class_confirmation"] is expected
    assert (await ac.get("/classes/me/confirmation")).json()["required"] is expected
    if not expected:
        response = await ac.post(
            "/classes/me/confirmation", json={"class_id": str(uuid.uuid4()), "seat_number": 1}
        )
        assert response.status_code == 403


async def test_confirmation_uses_configured_current_student_prefixes(
    db_session: AsyncSession,
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable,
) -> None:
    db_session.add(ElectronicCredentialSettings(id=1, student_id_prefixes=["710"]))
    user = await make_user(email="g0710001@hchs.hc.edu.tw", student_id="710001")
    assert (await authed_client_factory(user).get("/auth/me")).json()[
        "requires_class_confirmation"
    ] is True


async def test_student_can_set_own_class_and_seat_once(
    db_session: AsyncSession,
    admin_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable,
) -> None:
    school_class = await make_class(db_session, admin_user)
    inactive = await make_class(db_session, admin_user)
    inactive.is_active = False
    await db_session.flush()
    user = await make_user(email="g0510001@hchs.hc.edu.tw", student_id="510001")
    ac = authed_client_factory(user)
    initial = (await ac.get("/classes/me/confirmation")).json()
    assert initial["required"] is True
    assert initial["current_class"] is None
    assert [item["id"] for item in initial["class_options"]] == [str(school_class.id)]
    payload = {"class_id": str(school_class.id), "seat_number": 8}
    response = await ac.post("/classes/me/confirmation", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["required"] is False
    assert response.json()["current_class"]["id"] == str(school_class.id)
    assert response.json()["current_class"]["seat_number"] == 8
    assert (await ac.get("/auth/me")).json()["requires_class_confirmation"] is False
    assert (await ac.get("/auth/me")).json()["permissions"] == []
    assert (await ac.post("/classes/me/confirmation", json=payload)).status_code == 200
    assert await db_session.scalar(select(func.count()).select_from(ClassConfirmation)) == 1
    invalid = await ac.post(
        "/classes/me/confirmation", json={"class_id": str(inactive.id), "seat_number": 8}
    )
    assert invalid.status_code == 409
    changed = await ac.post(
        "/classes/me/confirmation", json={"class_id": str(school_class.id), "seat_number": 9}
    )
    assert changed.status_code == 409


async def test_student_can_review_and_fix_imported_roster(
    db_session: AsyncSession,
    admin_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable,
) -> None:
    school_class = await make_class(db_session, admin_user)
    user = await make_user(email="g0410001@hchs.hc.edu.tw", student_id="410001")
    entry = ClassRosterEntry(class_id=school_class.id, student_id=user.student_id, seat_number=6)
    db_session.add(entry)
    await db_session.flush()
    ac = authed_client_factory(user)
    initial = (await ac.get("/classes/me/confirmation")).json()
    assert initial["required"] is True
    assert initial["current_class"]["seat_number"] == 6
    response = await ac.post(
        "/classes/me/confirmation", json={"class_id": str(school_class.id), "seat_number": 7}
    )
    assert response.status_code == 200, response.text
    await db_session.refresh(entry)
    assert entry.user_id == user.id
    assert entry.seat_number == 7
    assert response.json()["required"] is False


async def test_student_can_correct_preassigned_class_without_changing_other_user(
    db_session: AsyncSession,
    admin_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable,
) -> None:
    old = await make_class(db_session, admin_user)
    target = await make_class(db_session, admin_user)
    user = await make_user(email="g0510001@hchs.hc.edu.tw", student_id="510001")
    other = await make_user(email="g0510002@hchs.hc.edu.tw", student_id="510002")
    db_session.add_all(
        [
            ClassManualMember(class_id=old.id, user_id=user.id),
            ClassRosterEntry(
                class_id=target.id, user_id=other.id, student_id="510002", seat_number=3
            ),
        ]
    )
    await db_session.flush()
    response = await authed_client_factory(user).post(
        "/classes/me/confirmation", json={"class_id": str(target.id), "seat_number": 4}
    )
    assert response.status_code == 200, response.text
    assert response.json()["current_class"]["id"] == str(target.id)
    entry = await db_session.scalar(
        select(ClassRosterEntry).where(ClassRosterEntry.user_id == other.id)
    )
    assert entry.seat_number == 3
    assert (
        await db_session.scalar(
            select(ClassConfirmation).where(ClassConfirmation.user_id == other.id)
        )
        is None
    )


async def test_confirmation_never_overwrites_occupied_seat_or_leaks_other_user(
    db_session: AsyncSession,
    admin_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable,
) -> None:
    school_class = await make_class(db_session, admin_user)
    user = await make_user(email="g0510001@hchs.hc.edu.tw", student_id="510001")
    other = await make_user(email="g0510002@hchs.hc.edu.tw", student_id="510002")
    entry = ClassRosterEntry(
        class_id=school_class.id, user_id=other.id, student_id="510002", seat_number=5
    )
    db_session.add(entry)
    await db_session.flush()
    ac = authed_client_factory(user)
    response = await ac.post(
        "/classes/me/confirmation", json={"class_id": str(school_class.id), "seat_number": 5}
    )
    assert response.status_code == 409
    await db_session.refresh(entry)
    assert entry.user_id == other.id and entry.student_id == "510002"
    assert await class_svc.resolve_user_class(db_session, user) is None
    assert await db_session.scalar(select(func.count()).select_from(ClassConfirmation)) == 0
    response = await ac.post(
        "/classes/me/confirmation",
        json={"class_id": str(school_class.id), "seat_number": 6, "user_id": str(other.id)},
    )
    assert response.status_code == 422


@pytest.mark.parametrize("seat", [0, -1, 1000])
async def test_confirmation_rejects_invalid_seat(
    authed_client_factory: Callable[[User], AsyncClient], make_user: Callable, seat: int
) -> None:
    user = await make_user(email="g0510001@hchs.hc.edu.tw", student_id="510001")
    response = await authed_client_factory(user).post(
        "/classes/me/confirmation", json={"class_id": str(uuid.uuid4()), "seat_number": seat}
    )
    assert response.status_code == 422
