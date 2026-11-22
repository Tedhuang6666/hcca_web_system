"""部署版本與 GitHub 推送版本的讀取服務。"""

from __future__ import annotations

import base64
import re
import time
from typing import Any

import httpx

from api.core.config import settings

_github_cache: tuple[float, dict[str, Any] | None, str | None] | None = None
_VERSION_PATTERN = re.compile(r"^\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$")
_VERSION_BASE_PATTERN = re.compile(r"^\d{2}\.\d{2}\.\d{2}\.\d{2}$")


def release_version(value: str) -> str:
    """將舊版號安全顯示為五段式，避免管理畫面出現無法辨識的格式。"""
    if _VERSION_PATTERN.fullmatch(value):
        return value
    numbers = value.split(".")
    if 1 <= len(numbers) <= 5 and all(part.isdigit() for part in numbers):
        return ".".join([*(part.zfill(2) for part in numbers), *("00",) * (5 - len(numbers))])
    return "00.00.00.00.00"


def version_for_commit(version_base: str, commit_count: int) -> str | None:
    if not _VERSION_BASE_PATTERN.fullmatch(version_base) or commit_count < 1:
        return None
    return f"{version_base}.{commit_count:02d}"


def _commit_count(response: httpx.Response) -> int | None:
    link = response.headers.get("Link", "")
    last_page = re.search(r"[?&]page=(\d+)>; rel=\"last\"", link)
    if last_page:
        return int(last_page.group(1))
    return 1 if response.json() else None


def _version_base(payload: dict[str, Any]) -> str | None:
    content = payload.get("content")
    if not isinstance(content, str):
        return None
    try:
        return base64.b64decode(content).decode("utf-8").strip()
    except (ValueError, UnicodeDecodeError):
        return None


def runtime_version() -> dict[str, str | None]:
    return {
        "app_version": release_version(settings.APP_VERSION),
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
            sha = str(payload.get("sha", ""))
            count_response = await client.get(
                f"https://api.github.com/repos/{repository}/commits?sha={sha}&per_page=1",
                headers=headers,
            )
            version_response = await client.get(
                f"https://api.github.com/repos/{repository}/contents/VERSION?ref={sha}",
                headers=headers,
            )
        count_response.raise_for_status()
        commit = payload.get("commit", {})
        author = commit.get("author", {})
        commit_count = _commit_count(count_response)
        version_base = (
            _version_base(version_response.json()) if version_response.is_success else None
        )
        result = {
            "repository": repository,
            "branch": settings.GITHUB_DEFAULT_BRANCH,
            "sha": payload.get("sha"),
            "short_sha": str(payload.get("sha", ""))[:12] or None,
            "message": str(commit.get("message", "")).splitlines()[0] or None,
            "pushed_at": author.get("date"),
            "url": payload.get("html_url"),
            "version": version_for_commit(version_base or "", commit_count or 0),
        }
        _github_cache = (now, result, None)
        return result, None
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        error = f"GitHub 查詢失敗：{exc.__class__.__name__}"
        _github_cache = (now, None, error)
        return None, error
