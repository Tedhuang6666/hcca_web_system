"""安全 .env / 系統設定編輯頁。"""

from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.main import app
from api.core import app_settings as app_settings_svc
from api.core.config import settings
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services import mfa as mfa_svc


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def _seed_admin(db: AsyncSession, *, mfa_enabled: bool = True) -> User:
    admin = User(
        email="settings-admin@school.edu",
        display_name="系統管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
        mfa_enabled=mfa_enabled,
    )
    db.add(admin)
    await db.flush()
    return admin


async def _seed_member(db: AsyncSession) -> User:
    member = User(
        email="settings-member@school.edu",
        display_name="一般",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    db.add(member)
    await db.flush()
    return member


@pytest.fixture
def env_editor_on(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "ENABLE_ENV_EDITOR", True)
    yield


@pytest.fixture
def fake_mfa_accepts_1234(monkeypatch: pytest.MonkeyPatch):
    async def _verify(_db, _user, code: str) -> bool:
        return code == "1234"

    monkeypatch.setattr(mfa_svc, "verify_mfa", _verify)
    yield


@pytest.fixture
def tmp_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """把 .env 路徑導向 tmp 檔，避免污染真實 .env。"""
    env_path = tmp_path / ".env"
    env_path.write_text(
        "MAIL_FROM=test@example.com\nRESEND_API_KEY=initial-secret\n"
        "SLOW_REQUEST_THRESHOLD_MS=1000\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(app_settings_svc, "resolve_env_path", lambda: env_path)
    return env_path


# ── disabled / auth ────────────────────────────────────────────────────────


async def test_settings_disabled_returns_404(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 顯式關閉旗標：避免受 repo .env 的 ENABLE_ENV_EDITOR=true 影響而誤判。
    monkeypatch.setattr(settings, "ENABLE_ENV_EDITOR", False)
    admin = await _seed_admin(db_session)
    _override_user(admin)
    resp = await client.get("/admin/system/settings")
    assert resp.status_code == 404


async def test_settings_requires_superuser_returns_403(
    client: AsyncClient, db_session: AsyncSession, env_editor_on
) -> None:
    member = await _seed_member(db_session)
    _override_user(member)
    resp = await client.get("/admin/system/settings")
    assert resp.status_code == 403


async def test_list_settings_masks_secrets_when_enabled(
    client: AsyncClient, db_session: AsyncSession, env_editor_on, tmp_env: Path
) -> None:
    admin = await _seed_admin(db_session)
    _override_user(admin)
    resp = await client.get("/admin/system/settings")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is True
    assert body["mfa_enabled"] is True
    assert len(body["fields"]) > 50
    resend_api_key = next(f for f in body["fields"] if f["key"] == "RESEND_API_KEY")
    assert resend_api_key["is_secret"] is True
    assert resend_api_key["value"] == "••••••"
    mail_from = next(f for f in body["fields"] if f["key"] == "MAIL_FROM")
    assert mail_from["is_secret"] is False
    assert mail_from["value"] == "test@example.com"


# ── MFA gating ─────────────────────────────────────────────────────────────


async def test_save_requires_mfa_enabled(
    client: AsyncClient, db_session: AsyncSession, env_editor_on, tmp_env: Path
) -> None:
    admin = await _seed_admin(db_session, mfa_enabled=False)
    _override_user(admin)
    resp = await client.put(
        "/admin/system/settings",
        json={"mfa_code": "anything", "changes": {"MAIL_FROM": "x@example.com"}},
    )
    assert resp.status_code == 403
    assert "MFA" in resp.json()["detail"]


async def test_save_requires_correct_mfa(
    client: AsyncClient,
    db_session: AsyncSession,
    env_editor_on,
    tmp_env: Path,
    fake_mfa_accepts_1234,
) -> None:
    admin = await _seed_admin(db_session)
    _override_user(admin)
    resp = await client.put(
        "/admin/system/settings",
        json={"mfa_code": "wrong", "changes": {"MAIL_FROM": "x@example.com"}},
    )
    assert resp.status_code == 403


# ── validation + write ─────────────────────────────────────────────────────


async def test_save_rejects_invalid_value_keeps_file(
    client: AsyncClient,
    db_session: AsyncSession,
    env_editor_on,
    tmp_env: Path,
    fake_mfa_accepts_1234,
) -> None:
    admin = await _seed_admin(db_session)
    _override_user(admin)
    before = tmp_env.read_text(encoding="utf-8")
    resp = await client.put(
        "/admin/system/settings",
        json={"mfa_code": "1234", "changes": {"DATABASE_URL": "not-a-valid-dsn"}},
    )
    assert resp.status_code == 422
    assert tmp_env.read_text(encoding="utf-8") == before
    # 沒有產生備份
    assert not list(tmp_env.parent.glob(".env.bak.*"))


async def test_save_writes_changes_and_creates_backup(
    client: AsyncClient,
    db_session: AsyncSession,
    env_editor_on,
    tmp_env: Path,
    fake_mfa_accepts_1234,
) -> None:
    admin = await _seed_admin(db_session)
    _override_user(admin)
    resp = await client.put(
        "/admin/system/settings",
        json={"mfa_code": "1234", "changes": {"SLOW_REQUEST_THRESHOLD_MS": "2000"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated"] == ["SLOW_REQUEST_THRESHOLD_MS"]
    assert body["restart_required"] is True
    assert "SLOW_REQUEST_THRESHOLD_MS=2000" in tmp_env.read_text(encoding="utf-8")
    # 備份檔產生
    backups = list(tmp_env.parent.glob(".env.bak.*"))
    assert len(backups) == 1


async def test_save_rejects_unknown_key_returns_422(
    client: AsyncClient,
    db_session: AsyncSession,
    env_editor_on,
    tmp_env: Path,
    fake_mfa_accepts_1234,
) -> None:
    admin = await _seed_admin(db_session)
    _override_user(admin)
    resp = await client.put(
        "/admin/system/settings",
        json={"mfa_code": "1234", "changes": {"TOTALLY_MADE_UP_KEY": "x"}},
    )
    assert resp.status_code == 422


# ── reveal ──────────────────────────────────────────────────────────────────


async def test_reveal_returns_secret_values_only(
    client: AsyncClient,
    db_session: AsyncSession,
    env_editor_on,
    tmp_env: Path,
    fake_mfa_accepts_1234,
) -> None:
    admin = await _seed_admin(db_session)
    _override_user(admin)
    resp = await client.post(
        "/admin/system/settings/reveal",
        json={"mfa_code": "1234", "keys": ["RESEND_API_KEY", "MAIL_FROM"]},
    )
    assert resp.status_code == 200
    values = resp.json()["values"]
    # RESEND_API_KEY 是密鑰 → 回明文；MAIL_FROM 不是密鑰 → 不在回應中
    assert values == {"RESEND_API_KEY": "initial-secret"}


async def test_reveal_requires_mfa(
    client: AsyncClient,
    db_session: AsyncSession,
    env_editor_on,
    tmp_env: Path,
    fake_mfa_accepts_1234,
) -> None:
    admin = await _seed_admin(db_session)
    _override_user(admin)
    resp = await client.post(
        "/admin/system/settings/reveal",
        json={"mfa_code": "wrong", "keys": ["RESEND_API_KEY"]},
    )
    assert resp.status_code == 403
