"""權限目錄完整性與模組邊界測試。"""

from api.core.permission_codes import (
    ALL_PERMISSION_CODES,
    PermissionCode,
    validate_permission_codes,
)


def test_permission_catalog_contains_every_defined_code_once() -> None:
    enum_codes = {str(code) for code in PermissionCode}
    catalog_codes = [str(item["code"]) for item in ALL_PERMISSION_CODES]

    assert len(catalog_codes) == len(set(catalog_codes))
    assert set(catalog_codes) == enum_codes
    assert validate_permission_codes(catalog_codes) == []


def test_specialized_modules_have_separate_permission_nodes() -> None:
    codes = {str(code) for code in PermissionCode}

    assert {
        "merchandise_submission:view",
        "merchandise_submission:manage",
        "merchandise_submission:review",
    } <= codes
    assert {
        "partner_map:business_manage",
        "partner_map:submission_review",
        "partner_map:application_manage",
        "partner_map:application_review",
        "electronic_credential:manage",
    } <= codes
