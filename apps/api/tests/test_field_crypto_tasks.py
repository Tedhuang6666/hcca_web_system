"""欄位加密漸進輪替背景任務測試（apps/api/src/api/services/field_crypto_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from api.services.field_crypto_tasks import _rotate_model_async, rotate_user_mfa_secrets


async def test_rotate_model_async_skips_when_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("api.services.field_crypto_tasks.is_configured", lambda: False)
    from api.models.user import User

    result = await _rotate_model_async(User, "display_name", 10)
    assert result == {"status": "skipped", "reason": "FIELD_ENCRYPTION_KEYS not set"}


def test_rotate_user_mfa_secrets_skips_when_field_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api.models.user import User

    monkeypatch.delattr(User, "mfa_secret_enc", raising=False)
    result = rotate_user_mfa_secrets()
    assert result["status"] == "skipped"


def test_rotate_user_mfa_secrets_delegates_to_rotate_model_async(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api.models.user import User

    monkeypatch.setattr(User, "mfa_secret_enc", "placeholder", raising=False)

    def _close_coro(coro):  # noqa: ANN001
        coro.close()
        return {"status": "ok", "model": "User", "attr": "mfa_secret_enc"}

    with patch("api.services.field_crypto_tasks.asyncio.run", side_effect=_close_coro) as mock_run:
        result = rotate_user_mfa_secrets(batch_size=50)
    mock_run.assert_called_once()
    assert result["status"] == "ok"
