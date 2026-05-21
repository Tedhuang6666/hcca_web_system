"""Email 範本渲染：讀取 MJML 編譯產物（compiled/*.html），以 Jinja2 注入變數。

範本流程：templates/*.mjml --(npm run build)--> compiled/*.html --(此模組)--> 完整 HTML
"""

from __future__ import annotations

import uuid
from functools import lru_cache
from pathlib import Path

import bleach
from itsdangerous import URLSafeTimedSerializer
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup, escape

from api.core.config import settings

_COMPILED_DIR = Path(__file__).resolve().parent / "compiled"

# 富文本白名單 — 寄信頁內文（Markdown 轉 HTML 後）的清洗規則
_ALLOWED_TAGS = [
    "p", "br", "b", "strong", "i", "em", "u", "s", "del", "a",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "blockquote", "span",
    "code", "pre", "hr",
]
_ALLOWED_ATTRS = {"a": ["href", "title"]}
_ALLOWED_PROTOCOLS = ["http", "https", "mailto"]

_UNSUBSCRIBE_SALT = "hcca-email-unsubscribe"

# context 缺漏欄位的安全預設值（避免範本 Jinja Undefined）
_CONTEXT_DEFAULTS: dict = {
    "subject": "",
    "preview_text": "",
    "heading": "",
    "body_text": "",
    "body_html": "",
    "card_rows": [],
    "cta_url": "",
    "cta_label": "",
    "unsubscribe_url": "",
}


def _nl2br(value: str | None) -> Markup:
    """純文字換行轉 <br>（先逐行 escape 再以 <br> 連接，輸出 safe Markup）。"""
    return Markup("<br>".join(escape(line) for line in (value or "").splitlines()))


@lru_cache(maxsize=1)
def _environment() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(_COMPILED_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    env.filters["nl2br"] = _nl2br
    return env


def render_email(template_name: str, context: dict) -> str:
    """渲染指定 email 範本為完整 HTML。

    template_name: "notification" 或 "generic"（對應 compiled/{name}.html）。
    自動注入 app_name / frontend_base_url；context 缺漏欄位以安全預設補齊。
    """
    template = _environment().get_template(f"{template_name}.html")
    return template.render(
        app_name=settings.APP_NAME,
        frontend_base_url=settings.FRONTEND_BASE_URL.rstrip("/"),
        **{**_CONTEXT_DEFAULTS, **context},
    )


def sanitize_html(raw: str | None) -> str:
    """以白名單清洗使用者輸入的富文本 HTML（連結僅允許 http/https/mailto）。"""
    return bleach.clean(
        raw or "",
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        protocols=_ALLOWED_PROTOCOLS,
        strip=True,
    )


def make_unsubscribe_token(user_id: uuid.UUID, notification_type: str) -> str:
    """產生退訂連結用的簽章 token（編碼 user_id + 通知類型）。"""
    serializer = URLSafeTimedSerializer(settings.SECRET_KEY, salt=_UNSUBSCRIBE_SALT)
    return serializer.dumps({"uid": str(user_id), "type": notification_type})


def parse_unsubscribe_token(token: str) -> tuple[uuid.UUID, str]:
    """驗證並解析退訂 token，回傳 (user_id, notification_type)。

    token 無效時拋 itsdangerous.BadSignature。退訂連結不設過期。
    """
    serializer = URLSafeTimedSerializer(settings.SECRET_KEY, salt=_UNSUBSCRIBE_SALT)
    data = serializer.loads(token)
    return uuid.UUID(data["uid"]), str(data["type"])
