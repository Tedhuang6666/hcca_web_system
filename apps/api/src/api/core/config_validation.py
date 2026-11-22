"""Pure parsing and validation helpers for application settings."""


def parse_field_encryption_keys(value: object) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        if raw.startswith("["):
            import json

            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = [item.strip() for item in raw.strip("[]").split(",") if item.strip()]
            if not isinstance(parsed, list):
                raise ValueError("FIELD_ENCRYPTION_KEYS 必須是 JSON array 或逗號分隔字串")
            return [str(item).strip() for item in parsed if str(item).strip()]
        return [item.strip() for item in raw.split(",") if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raise ValueError("FIELD_ENCRYPTION_KEYS 必須是 JSON array 或逗號分隔字串")


def parse_jwt_previous_signing_keys(value: object) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raise ValueError("JWT_PREVIOUS_SIGNING_KEYS 必須是 kid:secret 的逗號分隔字串")


def parse_audit_chain_previous_signing_keys(value: object) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        items = [item.strip() for item in value.split(",") if item.strip()]
    elif isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
    else:
        raise ValueError("AUDIT_CHAIN_PREVIOUS_SIGNING_KEYS 必須是 kid:secret 的逗號分隔字串")

    for item in items:
        kid, separator, secret = item.partition(":")
        valid_kid = (
            bool(kid)
            and len(kid) <= 16
            and all(char.isascii() and (char.isalnum() or char in "_-") for char in kid)
        )
        if not separator or not valid_kid or len(secret.encode("utf-8")) < 32:
            raise ValueError(
                "AUDIT_CHAIN_PREVIOUS_SIGNING_KEYS 項目必須是有效 kid:secret，key 至少 32 bytes"
            )
    return items


def parse_rate_limit_trusted_ips(value: object) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        if raw.startswith("["):
            import json

            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = [item.strip() for item in raw.strip("[]").split(",") if item.strip()]
            if not isinstance(parsed, list):
                raise ValueError("RATE_LIMIT_TRUSTED_IPS 必須是 JSON array 或逗號分隔字串")
            return [str(item).strip() for item in parsed if str(item).strip()]
        return [item.strip() for item in raw.split(",") if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    raise ValueError("RATE_LIMIT_TRUSTED_IPS 必須是 JSON array 或逗號分隔字串")


def validate_audit_chain_previous_signing_keys(
    *,
    active_kid: str,
    audit_chain_signing_key: str,
    secret_key: str,
    previous_signing_keys: list[str],
) -> None:
    active_audit_key = audit_chain_signing_key or secret_key
    previous_audit_kids: set[str] = set()
    for item in previous_signing_keys:
        kid, _, key = item.partition(":")
        if kid == active_kid or kid in previous_audit_kids or key == active_audit_key:
            raise ValueError("AUDIT_CHAIN_PREVIOUS_SIGNING_KEYS 的 kid 與 key 必須唯一")
        previous_audit_kids.add(kid)


def ensure_audit_chain_signing_key_is_independent(
    *,
    is_production: bool,
    audit_chain_signing_key: str,
    secret_key: str,
    jwt_signing_key: str,
    jwt_session_hash_key: str,
    oauth_session_secret: str,
) -> None:
    if (
        is_production
        and audit_chain_signing_key
        and audit_chain_signing_key
        in {secret_key, jwt_signing_key, jwt_session_hash_key, oauth_session_secret}
    ):
        raise ValueError("生產環境 AUDIT_CHAIN_SIGNING_KEY 必須使用獨立金鑰")
