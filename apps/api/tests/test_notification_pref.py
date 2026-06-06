"""通知偏好正規化測試：相容空值、扁平與巢狀格式。"""

from __future__ import annotations

from api.services.notification_pref import NOTIFICATION_TYPES, normalize_preferences


def test_normalize_empty_returns_all_defaults() -> None:
    result = normalize_preferences(None)
    assert set(result) == set(NOTIFICATION_TYPES)
    # 站內預設全開
    assert all(v["inapp"] for v in result.values())
    # email 僅 document_pending 預設開
    assert result["document_pending"]["email"] is True
    assert result["document_approved"]["email"] is False
    # LINE 預設關閉，避免綁定後立刻大量推播
    assert all(v["line"] is False for v in result.values())
    # Discord 預設關閉，由使用者綁定並啟用後才推播
    assert all(v["discord"] is False for v in result.values())


def test_normalize_legacy_flat_bool_format() -> None:
    legacy = {"document_pending": False, "announcement": True}
    result = normalize_preferences(legacy)
    assert result["document_pending"] == {
        "inapp": False,
        "email": False,
        "line": False,
        "discord": False,
    }
    # announcement 舊值 True → inapp True；email 因不在預設清單仍 False
    assert result["announcement"] == {
        "inapp": True,
        "email": False,
        "line": False,
        "discord": False,
    }


def test_normalize_new_nested_format_preserved() -> None:
    nested = {"system": {"inapp": False, "email": True}}
    result = normalize_preferences(nested)
    assert result["system"] == {"inapp": False, "email": True, "line": False, "discord": False}


def test_normalize_partial_nested_fills_missing_subkeys() -> None:
    result = normalize_preferences({"document_rejected": {"email": True}})
    # 缺 inapp → 補 True
    assert result["document_rejected"] == {
        "inapp": True,
        "email": True,
        "line": False,
        "discord": False,
    }
