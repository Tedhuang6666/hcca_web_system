"""權限矩陣自動測試

遍歷所有 FastAPI 路由，斷言每條路由的保護等級符合預期。
任何新增到「完全公開」分類但未登記在 KNOWN_PUBLIC_ROUTES 的路由都會讓測試失敗，
迫使開發者明確審查並宣告其為公開端點。

保護等級（由強到弱）：
  PERMISSION   — 掛有 require_permission / require_any / require_org_permission
  MFA_ADMIN    — 掛有 require_admin_mfa（系統管理員 + MFA）
  LOGIN        — 需登入（has get_current_active_user）但無明確權限碼
  PUBLIC       — 完全無需認證

此測試的目的是「防遺漏」，不是「驗正確性」。
"""

from __future__ import annotations

import pytest
from fastapi.routing import APIRoute

from api.dependencies.api_key_auth import ApiScopeChecker, api_key_required
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import (
    AdminMFAChecker,
    AnyPermissionChecker,
    OrgScopedPermissionChecker,
    PermissionChecker,
)
from api.main import app

# ---------------------------------------------------------------------------
# 已知且刻意公開的路由（無需任何認證）
# 維護說明：若需新增公開端點，在此加入 (path, method) 並說明理由。
# ---------------------------------------------------------------------------
KNOWN_PUBLIC_ROUTES: set[tuple[str, str]] = {
    # 根路徑 / 健康探測
    ("/", "GET"),
    ("/health", "GET"),
    ("/ready", "GET"),
    ("/metrics", "GET"),
    ("/live", "GET"),
    # 模組健康探測（每個 router 一條 __module_health__ 端點）
    ("/activities/__module_health__", "GET"),
    ("/announcements/__module_health__", "GET"),
    ("/documents/__module_health__", "GET"),
    ("/calendar/__module_health__", "GET"),
    ("/council-proposals/__module_health__", "GET"),
    ("/discord/__module_health__", "GET"),
    ("/elections/__module_health__", "GET"),
    ("/exam-papers/__module_health__", "GET"),
    ("/governance/__module_health__", "GET"),
    ("/judicial-petitions/__module_health__", "GET"),
    ("/line/__module_health__", "GET"),
    ("/matters/__module_health__", "GET"),
    ("/meal/__module_health__", "GET"),
    ("/meetings/__module_health__", "GET"),
    ("/merchandise-submissions/__module_health__", "GET"),
    ("/partner-map/__module_health__", "GET"),
    ("/petitions/__module_health__", "GET"),
    ("/regulations/__module_health__", "GET"),
    ("/seating/__module_health__", "GET"),
    ("/shop/__module_health__", "GET"),
    ("/surveys/__module_health__", "GET"),
    # 認證流程
    ("/auth/google/login", "GET"),
    ("/auth/google/callback", "GET"),
    ("/auth/google/one-tap", "POST"),
    ("/auth/discord/login", "GET"),
    ("/auth/discord/callback", "GET"),
    ("/auth/logout", "POST"),
    ("/auth/refresh", "POST"),
    ("/auth/mfa/exchange-challenge", "GET"),
    ("/auth/mfa/login/verify", "POST"),
    # Discord / LINE webhook（由外部服務呼叫，帶有 HMAC 簽章）
    ("/discord/callback", "GET"),
    ("/discord/open", "GET"),
    ("/line/open", "GET"),
    ("/line/webhook", "POST"),
    ("/email/resend/webhook", "POST"),
    # 公開資訊（法規、公文、公告等刻意對外公開）
    ("/documents", "GET"),
    ("/documents/{doc_id}", "GET"),
    ("/documents/{doc_id}/attachments", "GET"),
    ("/documents/{doc_id}/attachments/{att_id}/download", "GET"),
    ("/documents/{doc_id}/attachments/{att_id}/preview", "GET"),
    ("/announcements", "GET"),
    ("/announcements/active-urgent", "GET"),
    ("/announcements/{ann_id}", "GET"),
    ("/regulations", "GET"),
    ("/regulations/search", "GET"),
    ("/regulations/{reg_id}", "GET"),
    ("/regulations/{reg_id}/articles", "GET"),
    ("/regulations/{reg_id}/tree", "GET"),
    ("/regulations/{reg_id}/revisions", "GET"),
    ("/regulations/{reg_id}/amendment-comparison", "GET"),
    ("/regulations/{reg_id}/diff", "POST"),
    ("/regulations/{reg_id}/print", "GET"),
    ("/regulations/{reg_id}/reference-warnings", "GET"),
    ("/regulations/{reg_id}/time-machine", "GET"),
    ("/regulations/{reg_id}/usage-context", "GET"),
    ("/regulations/{reg_id}/workflow_logs", "GET"),
    # 陳情（民眾可匿名提交）
    ("/petitions", "POST"),
    ("/petitions/lookup", "GET"),
    ("/petitions/types", "GET"),
    ("/petitions/{case_id}/attachments", "POST"),
    ("/petitions/{case_id}/attachments/{attachment_id}/download", "GET"),
    ("/petitions/{case_id}/supplement", "POST"),
    ("/petitions/share", "POST"),
    # 議案（公開查閱）
    ("/council-proposals", "POST"),
    # 問卷（公開填答）
    ("/surveys/public", "GET"),
    ("/surveys/public/{survey_id}", "GET"),
    ("/surveys/{survey_id}/submit", "POST"),
    # 選舉（公開資訊與即時牆）
    ("/elections/public", "GET"),
    ("/elections/public/{election_ref}/live", "GET"),
    # 校外合作地圖（公開）
    ("/partner-map", "GET"),
    ("/partner-map/businesses/{business_id}", "GET"),
    ("/partner-map/businesses/{business_id}/check-in", "POST"),
    ("/partner-map/businesses/{business_id}/click", "POST"),
    ("/partner-map/businesses/{business_id}/ratings", "GET"),
    ("/partner-map/businesses/{business_id}/ratings", "POST"),
    ("/partner-map/rankings", "GET"),
    ("/partner-map/submissions", "POST"),
    ("/partner-map/tags", "GET"),
    # 公開會議看板
    ("/public/meetings/screen/{token}", "GET"),
    # 政策同意（公開版本瀏覽）
    ("/policies/public/{kind}", "GET"),
    ("/policies/public/{kind}/versions", "GET"),
    ("/policies/public/{kind}/{version}", "GET"),
    # 通知訂閱管理（退訂連結帶 token）
    ("/notifications/unsubscribe", "POST"),
    ("/notifications/web-push/config", "GET"),
    # 公開網站資訊
    ("/site/link-categories", "GET"),
    ("/site/links", "GET"),
    ("/site/officers", "GET"),
    ("/site/pages", "GET"),
    ("/site/pages/{slug}", "GET"),
    ("/site/public", "GET"),
    # 系統狀態（公開，供監控用）
    ("/system/access-status", "GET"),
    ("/system/maintenance", "GET"),
    ("/system/module-status", "GET"),
    # Google Tasks OAuth callback（需 state token，安全性由 OAuth flow 保證）
    ("/user/google-tasks/callback", "GET"),
    # Google Calendar callback
    ("/calendar/google/callback", "GET"),
}


def _flatten_deps(dependant, seen: set | None = None) -> list:
    """遞迴展開 FastAPI dependant 樹，回傳所有 callable。"""
    if seen is None:
        seen = set()
    key = id(dependant)
    if key in seen:
        return []
    seen.add(key)
    result = [dependant.call] if dependant.call else []
    for sub in dependant.dependencies:
        result.extend(_flatten_deps(sub, seen))
    return result


def _classify_route(route: APIRoute) -> str:
    """回傳路由的保護等級字串。"""
    calls = _flatten_deps(route.dependant)
    if any(
        isinstance(c, (PermissionChecker, AnyPermissionChecker, OrgScopedPermissionChecker))
        for c in calls
    ):
        return "PERMISSION"
    if any(isinstance(c, ApiScopeChecker) or c is api_key_required for c in calls):
        return "API_KEY"
    if any(isinstance(c, AdminMFAChecker) for c in calls):
        return "MFA_ADMIN"
    if get_current_active_user in calls:
        return "LOGIN"
    return "PUBLIC"


def _iter_api_routes(routes: list[object]) -> list[APIRoute]:
    """遞迴展開 FastAPI include_router 產生的巢狀 router。"""
    found: list[APIRoute] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append(route)
            continue
        children = getattr(route, "routes", None)
        if not children:
            original_router = getattr(route, "original_router", None)
            children = getattr(original_router, "routes", None)
        if isinstance(children, list):
            found.extend(_iter_api_routes(children))
    return found


def test_all_public_routes_are_declared() -> None:
    """任何完全公開的路由都必須在 KNOWN_PUBLIC_ROUTES 白名單中。

    測試失敗代表：有新端點沒加認證，或者忘了把刻意公開的路由加入白名單。
    兩者都需要開發者主動審查後決定。
    """
    undeclared: list[str] = []

    for route in _iter_api_routes(list(app.routes)):
        if _classify_route(route) != "PUBLIC":
            continue
        for method in sorted(route.methods):
            key = (route.path, method)
            if key not in KNOWN_PUBLIC_ROUTES:
                undeclared.append(f"  {method} {route.path}")

    if undeclared:
        routes_str = "\n".join(sorted(undeclared))
        pytest.fail(
            f"以下路由完全無需認證，但未在 KNOWN_PUBLIC_ROUTES 白名單中宣告：\n"
            f"{routes_str}\n\n"
            f"若刻意公開，請將 (path, method) 加入 test_permission_matrix.py 的 KNOWN_PUBLIC_ROUTES。\n"
            f"若非刻意，請在 router 中加上 `dependencies=[Depends(require_permission(...))]`。"
        )


def test_known_public_routes_all_exist() -> None:
    """白名單中的路由必須真實存在於 app 中（防止白名單腐化）。"""
    existing: set[tuple[str, str]] = set()
    for route in _iter_api_routes(list(app.routes)):
        for method in route.methods:
            existing.add((route.path, method))

    stale = KNOWN_PUBLIC_ROUTES - existing
    if stale:
        stale_str = "\n".join(f"  {m} {p}" for p, m in sorted(stale))
        pytest.fail(f"KNOWN_PUBLIC_ROUTES 白名單中有已不存在的路由（可安全刪除）：\n{stale_str}")


def test_permission_coverage_report() -> None:
    """列出各保護等級的數量（不斷言，僅作報告用途）。"""
    counts: dict[str, int] = {
        "PERMISSION": 0,
        "API_KEY": 0,
        "MFA_ADMIN": 0,
        "LOGIN": 0,
        "PUBLIC": 0,
    }
    for route in _iter_api_routes(list(app.routes)):
        level = _classify_route(route)
        counts[level] += len(route.methods)

    total = sum(counts.values())
    print(f"\n權限矩陣統計（共 {total} 個端點）：")
    for level, count in counts.items():
        pct = count / total * 100 if total else 0
        print(f"  {level:12s} {count:4d}  ({pct:.1f}%)")
