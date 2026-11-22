"""權限目錄完整性與模組邊界測試。"""

from api.core.permission_codes import (
    ALL_PERMISSION_CODES,
    PERMISSION_CATEGORY_BY_GROUP,
    PERMISSION_CATEGORY_ORDER,
    PermissionCode,
    validate_permission_codes,
)


def test_permission_catalog_contains_every_defined_code_once() -> None:
    enum_codes = {str(code) for code in PermissionCode}
    catalog_codes = [str(item["code"]) for item in ALL_PERMISSION_CODES]

    assert len(catalog_codes) == len(set(catalog_codes))
    assert set(catalog_codes) == enum_codes
    assert validate_permission_codes(catalog_codes) == []


def test_qr_code_permission_covers_the_combined_marketing_tools_workspace() -> None:
    permission = next(
        item for item in ALL_PERMISSION_CODES if item["code"] == PermissionCode.QR_CODE_MANAGE
    )

    assert permission["label"] == "經營工具"
    assert "短網址" in permission["desc"]
    assert "QR Code" in permission["desc"]


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


def test_permission_catalog_groups_are_classified_and_loan_codes_are_removed() -> None:
    catalog_groups = {item["group"] for item in ALL_PERMISSION_CODES}

    assert catalog_groups == set(PERMISSION_CATEGORY_BY_GROUP)
    assert {item["category"] for item in ALL_PERMISSION_CODES} == set(PERMISSION_CATEGORY_ORDER)
    assert all(
        item["category"] == PERMISSION_CATEGORY_BY_GROUP[item["group"]]
        for item in ALL_PERMISSION_CODES
    )
    assert not any(str(item["code"]).startswith("loan:") for item in ALL_PERMISSION_CODES)
