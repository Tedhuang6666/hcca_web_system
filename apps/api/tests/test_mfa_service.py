"""MFA service tests."""

from __future__ import annotations

import pyotp
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.services import mfa as mfa_svc


@pytest.mark.asyncio
async def test_mfa_setup_confirm_encrypts_secret_and_persists_backup_hashes(
    db_session: AsyncSession,
) -> None:
    user = User(email="mfa@example.com", display_name="MFA User", is_verified=True)
    db_session.add(user)
    await db_session.flush()

    setup = await mfa_svc.setup_mfa(db_session, user)
    assert setup["secret"] not in (user.mfa_pending_secret or "")
    assert user.mfa_pending_secret.startswith("enc:v1:")
    assert len(setup["backup_codes"]) == 8

    code = pyotp.TOTP(setup["secret"]).now()
    assert await mfa_svc.confirm_mfa(db_session, user, code)

    assert user.mfa_enabled is True
    assert user.mfa_secret is not None
    assert user.mfa_secret.startswith("enc:v1:")
    assert user.mfa_pending_secret is None
    assert mfa_svc.backup_code_count(user) == 8
    assert all(item.startswith("scrypt:") for item in user.mfa_backup_code_hashes["codes"])


@pytest.mark.asyncio
async def test_mfa_backup_code_can_be_used_once(db_session: AsyncSession) -> None:
    user = User(email="backup@example.com", display_name="Backup User", is_verified=True)
    db_session.add(user)
    await db_session.flush()

    setup = await mfa_svc.setup_mfa(db_session, user)
    code = pyotp.TOTP(setup["secret"]).now()
    assert await mfa_svc.confirm_mfa(db_session, user, code)

    backup_code = setup["backup_codes"][0]
    assert await mfa_svc.verify_mfa(db_session, user, backup_code)
    assert mfa_svc.backup_code_count(user) == 7
    assert not await mfa_svc.verify_mfa(db_session, user, backup_code)
