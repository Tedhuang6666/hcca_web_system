"""學校學生帳號與現行學號前綴的純判定規則。"""

from collections.abc import Sequence

SCHOOL_EMAIL_DOMAIN = "hchs.hc.edu.tw"


def is_g0_school_account_email(email: str) -> bool:
    local_part, separator, domain = email.strip().lower().partition("@")
    return bool(separator and domain == SCHOOL_EMAIL_DOMAIN and local_part.startswith("g0"))


def student_id_from_school_email(email: str) -> str | None:
    local_part, separator, domain = email.strip().lower().partition("@")
    if separator and domain == SCHOOL_EMAIL_DOMAIN and local_part.startswith("g0"):
        return local_part[2:] or None
    return None


def is_current_student_id(student_id: str | None, prefixes: Sequence[str] | None) -> bool:
    return bool(
        student_id
        and student_id.isascii()
        and student_id.isdigit()
        and prefixes
        and any(student_id.startswith(prefix) for prefix in prefixes)
    )


def is_alumni_school_account(email: str, current_student_id_prefixes: Sequence[str]) -> bool:
    if not is_g0_school_account_email(email):
        return False
    return not is_current_student_id(
        student_id_from_school_email(email), current_student_id_prefixes
    )
