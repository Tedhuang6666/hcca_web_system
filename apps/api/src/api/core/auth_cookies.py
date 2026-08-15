"""Browser-only authentication cookie helpers with a bounded legacy migration path."""

from __future__ import annotations

from collections.abc import Mapping

from fastapi import Response

from api.core.config import settings


def access_token_from_cookies(cookies: Mapping[str, str]) -> str | None:
    return cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME) or (
        cookies.get(settings.LEGACY_ACCESS_TOKEN_COOKIE_NAME)
        if settings.AUTH_LEGACY_TOKEN_COMPAT_ENABLED
        else None
    )


def refresh_token_from_cookies(cookies: Mapping[str, str]) -> str | None:
    return cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME) or (
        cookies.get(settings.LEGACY_REFRESH_TOKEN_COOKIE_NAME)
        if settings.AUTH_LEGACY_TOKEN_COMPAT_ENABLED
        else None
    )


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        settings.ACCESS_TOKEN_COOKIE_NAME,
        access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        settings.REFRESH_TOKEN_COOKIE_NAME,
        refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )
    if settings.LEGACY_ACCESS_TOKEN_COOKIE_NAME != settings.ACCESS_TOKEN_COOKIE_NAME:
        response.delete_cookie(settings.LEGACY_ACCESS_TOKEN_COOKIE_NAME, path="/")
    if settings.LEGACY_REFRESH_TOKEN_COOKIE_NAME != settings.REFRESH_TOKEN_COOKIE_NAME:
        response.delete_cookie(settings.LEGACY_REFRESH_TOKEN_COOKIE_NAME, path="/")


def delete_auth_cookies(response: Response) -> None:
    response.delete_cookie(settings.ACCESS_TOKEN_COOKIE_NAME, path="/")
    response.delete_cookie(settings.REFRESH_TOKEN_COOKIE_NAME, path="/")
    if settings.LEGACY_ACCESS_TOKEN_COOKIE_NAME != settings.ACCESS_TOKEN_COOKIE_NAME:
        response.delete_cookie(settings.LEGACY_ACCESS_TOKEN_COOKIE_NAME, path="/")
    if settings.LEGACY_REFRESH_TOKEN_COOKIE_NAME != settings.REFRESH_TOKEN_COOKIE_NAME:
        response.delete_cookie(settings.LEGACY_REFRESH_TOKEN_COOKIE_NAME, path="/")
