"""部署版本與 GitHub 推送版本的讀取服務。"""

from __future__ import annotations

import time
from typing import Any

import httpx

from api.core.config import settings

_github_cache: tuple[float, dict[str, Any] | None, str | None] | None = None


def runtime_version() -> dict[str, str | None]:
    return {
        "app_version": settings.APP_VERSION,
        "commit": settings.BUILD_COMMIT or None,
        "ref": settings.BUILD_REF or None,
        "built_at": settings.BUILD_TIME or None,
        "environment": settings.ENVIRONMENT,
    }


async def github_version() -> tuple[dict[str, Any] | None, str | None]:
    """讀取預設分支最新 commit；短暫快取以避免管理頁輪詢耗盡 GitHub 額度。"""
    global _github_cache
    now = time.monotonic()
    if _github_cache and now - _github_cache[0] < settings.GITHUB_VERSION_CACHE_SECONDS:
        return _github_cache[1], _github_cache[2]

    repository = settings.GITHUB_REPOSITORY.strip()
    if not repository or "/" not in repository:
        error = "GitHub repository 未設定"
        _github_cache = (now, None, error)
        return None, error

    headers = {"Accept": "application/vnd.github+json", "User-Agent": "hcca-version-check"}
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {settings.GITHUB_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"https://api.github.com/repos/{repository}/commits/{settings.GITHUB_DEFAULT_BRANCH}",
                headers=headers,
            )
        response.raise_for_status()
        payload = response.json()
        commit = payload.get("commit", {})
        author = commit.get("author", {})
        result = {
            "repository": repository,
            "branch": settings.GITHUB_DEFAULT_BRANCH,
            "sha": payload.get("sha"),
            "short_sha": str(payload.get("sha", ""))[:12] or None,
            "message": str(commit.get("message", "")).splitlines()[0] or None,
            "pushed_at": author.get("date"),
            "url": payload.get("html_url"),
        }
        _github_cache = (now, result, None)
        return result, None
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        error = f"GitHub 查詢失敗：{exc.__class__.__name__}"
        _github_cache = (now, None, error)
        return None, error
