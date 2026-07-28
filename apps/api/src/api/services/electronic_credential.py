"""電子證件業務邏輯。"""

from __future__ import annotations

from api.core.config import settings
from api.models.user import User
from api.schemas.electronic_credential import ElectronicCredentialOut


def _normalized_email_set(values: list[str] | set[str]) -> set[str]:
    return {value.strip().lower() for value in values if value.strip()}


def identity_for_user(user: User) -> tuple[str, str] | None:
    """回傳電子證件身份別與顯示標籤；不符合資格時回傳 None。"""
    normalized_email = user.email.strip().lower()
    domain = normalized_email.rsplit("@", maxsplit=1)[-1] if "@" in normalized_email else ""
    campus_domains = {
        value.strip().lower().lstrip("@")
        for value in settings.LOGIN_ALLOWED_EMAIL_DOMAINS
        if value.strip()
    }
    if domain in campus_domains:
        is_student = bool(user.student_id) or normalized_email.startswith("g0")
        return ("student", "校內學生") if is_student else ("teacher", "校內師長")

    authorized_emails = (
        _normalized_email_set(settings.LOGIN_EMAIL_ALLOWLIST)
        | _normalized_email_set(settings.OWNER_EMAILS)
        | _normalized_email_set(settings.SUPERUSER_EMAILS)
    )
    if normalized_email in authorized_emails:
        return "authorized", "特別授權帳號"
    return None


async def get_my_credential(user: User) -> ElectronicCredentialOut | None:
    """取得當前使用者電子證件；資格由後端再次確認。"""
    if not user.is_active:
        return None
    identity = identity_for_user(user)
    if identity is None:
        return None
    return ElectronicCredentialOut(
        display_name=user.display_name,
        email=user.email,
        student_id=user.student_id,
        identity_kind=identity[0],
        identity_label=identity[1],
        status_label="目前有效",
    )
