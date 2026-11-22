from api.core.config import Settings


def test_public_url_derives_passkey_origin_and_rp_id() -> None:
    settings = Settings(
        _env_file=None,
        FRONTEND_BASE_URL="https://passkey.example.test",
        SECRET_KEY="test-secret-key",
    )

    assert settings.PASSKEY_ORIGIN == "https://passkey.example.test"
    assert settings.PASSKEY_RP_ID == "passkey.example.test"
