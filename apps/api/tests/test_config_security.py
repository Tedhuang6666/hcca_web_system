"""核心設定的安全 validator 測試 — SECRET_KEY、SUPERUSER、DEBUG、CORS。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.core.config import _DEFAULT_SECRET, Settings


def _make(**overrides: object) -> Settings:
    """以最小可運行的環境變數產出 Settings，保留 overrides 內覆寫項。"""
    base: dict[str, object] = {
        "ENVIRONMENT": "development",
        "SECRET_KEY": "x" * 64,
        "DEBUG": False,
        "ENABLE_API_DOCS": False,
        "COOKIE_SECURE": False,
        "ALLOWED_ORIGINS": ["http://localhost:3000"],
        "ALLOWED_HOSTS": ["localhost", "127.0.0.1", "test"],
        "SUPERUSER_EMAILS": [],
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_development_with_default_secret_warns_but_succeeds() -> None:
    with pytest.warns(UserWarning, match="SECRET_KEY"):
        s = _make(SECRET_KEY=_DEFAULT_SECRET)
    assert s.SECRET_KEY == _DEFAULT_SECRET


def test_production_rejects_default_secret() -> None:
    with pytest.raises(ValidationError) as exc:
        _make(
            ENVIRONMENT="production",
            SECRET_KEY=_DEFAULT_SECRET,
            COOKIE_SECURE=True,
        )
    assert "SECRET_KEY" in str(exc.value)


def test_production_rejects_debug_true() -> None:
    with pytest.raises(ValidationError, match="DEBUG"):
        _make(ENVIRONMENT="production", DEBUG=True, COOKIE_SECURE=True)


def test_production_rejects_public_api_docs() -> None:
    with pytest.raises(ValidationError, match="ENABLE_API_DOCS"):
        _make(ENVIRONMENT="production", ENABLE_API_DOCS=True, COOKIE_SECURE=True)


def test_production_rejects_superuser_emails_autograms() -> None:
    with pytest.raises(ValidationError, match="SUPERUSER_EMAILS"):
        _make(
            ENVIRONMENT="production",
            COOKIE_SECURE=True,
            SUPERUSER_EMAILS=["admin@example.com"],
        )


def test_production_requires_cookie_secure() -> None:
    with pytest.raises(ValidationError, match="COOKIE_SECURE"):
        _make(ENVIRONMENT="production", COOKIE_SECURE=False)


def test_allowed_origins_wildcard_rejected_anywhere() -> None:
    with pytest.raises(ValidationError, match="ALLOWED_ORIGINS"):
        _make(ALLOWED_ORIGINS=["*"])


def test_production_allowed_hosts_wildcard_rejected() -> None:
    with pytest.raises(ValidationError, match="ALLOWED_HOSTS"):
        _make(ENVIRONMENT="production", COOKIE_SECURE=True, ALLOWED_HOSTS=["*"])


def test_email_lists_are_lowercased_and_stripped() -> None:
    s = _make(SUPERUSER_EMAILS=["  Admin@Example.com  ", "", "@user@x.com"])
    assert s.SUPERUSER_EMAILS == ["admin@example.com", "user@x.com"]


def test_cookie_samesite_invalid_rejected() -> None:
    with pytest.raises(ValidationError, match="COOKIE_SAMESITE"):
        _make(COOKIE_SAMESITE="invalid-mode")
