"""Email 範本渲染：讀取 MJML 編譯產物（compiled/*.html），以 Jinja2 注入變數。

範本流程：templates/*.mjml --(npm run build)--> compiled/*.html --(此模組)--> 完整 HTML
"""

from __future__ import annotations

import re
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import bleach
from itsdangerous import URLSafeTimedSerializer
from jinja2 import (
    Environment,
    FileSystemLoader,
    StrictUndefined,
    TemplateError,
    select_autoescape,
)
from jinja2.sandbox import SandboxedEnvironment
from markupsafe import Markup, escape

from api.core.config import settings

_COMPILED_DIR = Path(__file__).resolve().parent / "compiled"

# 富文本白名單 — 寄信頁內文（Markdown 轉 HTML 後）的清洗規則
_ALLOWED_TAGS = [
    "p",
    "br",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "del",
    "a",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "span",
    "code",
    "pre",
    "hr",
]
_ALLOWED_ATTRS = {"a": ["href", "title"]}
_ALLOWED_PROTOCOLS = ["http", "https", "mailto"]
_VARIABLE_KEY_RE = re.compile(r"^[^\W\d]\w{0,63}$", re.UNICODE)
_RESERVED_VARIABLE_KEYS = {"user", "app", "unsubscribe_url", "frontend_base_url"}

_UNSUBSCRIBE_SALT = "hcca-email-unsubscribe"

# context 缺漏欄位的安全預設值（避免範本 Jinja Undefined）
_CONTEXT_DEFAULTS: dict = {
    "subject": "",
    "preview_text": "",
    "accent_color": "#111827",
    "background_color": "#eef2f7",
    "content_background_color": "#ffffff",
    "body_line_height": 1.6,
    "paragraph_spacing": 18,
    "footer_text": "",
    "show_system_footer": True,
    "heading": "",
    "body_text": "",
    "body_html": "",
    "banner_image_url": "",
    "banner_image_alt": "",
    "card_rows": [],
    "cta_url": "",
    "cta_label": "",
    "buttons": [],
    "blocks": [],
    "brand_logo_url": "",
    "unsubscribe_url": "",
}


def absolutize_url(url: str | None) -> str:
    """把相對路徑補上公開 base URL，供 email 內圖片載入。

    email 客戶端無法載入相對路徑，因此上傳後的圖片網址需轉為 API 絕對網址；
    前端 public 靜態資源（如 /brand/...）則轉為前端絕對網址。
    已是 http/https 的網址原樣回傳；其他（含空字串）回傳空字串。
    """
    value = (url or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value
    if value.startswith("/uploads/"):
        return f"{settings.API_PUBLIC_BASE_URL.rstrip('/')}{value}"
    if value.startswith("/"):
        return f"{settings.FRONTEND_BASE_URL.rstrip('/')}{value}"
    return ""


def safe_link_url(url: str | None) -> str:
    """只保留 email 連結允許的絕對 URL 協定。"""
    value = (url or "").strip()
    if not value:
        return ""
    return value if urlparse(value).scheme.lower() in _ALLOWED_PROTOCOLS else ""


def _nl2br(value: str | None) -> Markup:
    """純文字換行轉 <br>（先逐行 escape 再以 <br> 連接，輸出 safe Markup）。"""
    # 所有不受信任片段都先 escape，Markup 只標記固定的 <br> 分隔符。
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
    email_link_base_url = settings.EMAIL_LINK_BASE_URL.rstrip("/")
    render_context = {
        **_CONTEXT_DEFAULTS,
        "brand_logo_url": absolutize_url(settings.EMAIL_BRAND_LOGO_URL),
        **context,
    }
    return template.render(
        app_name=settings.APP_NAME,
        frontend_base_url=email_link_base_url,
        **render_context,
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


def validate_variable_definitions(definitions: list[dict]) -> list[dict]:
    """正規化自訂佔位符定義，避免覆蓋系統變數與危險 key。"""
    normalized: list[dict] = []
    seen: set[str] = set()
    for item in definitions or []:
        key = str(item.get("key", "")).strip()
        if not _VARIABLE_KEY_RE.match(key) or key in _RESERVED_VARIABLE_KEYS:
            raise ValueError(f"不合法的自訂佔位符：{key}")
        if key in seen:
            raise ValueError(f"重複的自訂佔位符：{key}")
        seen.add(key)
        normalized.append(
            {
                "key": key,
                "label": str(item.get("label") or key).strip()[:80],
                "required": bool(item.get("required", False)),
                "default_value": str(item.get("default_value") or ""),
            }
        )
    return normalized


def validate_required_variables(
    definitions: list[dict], variables: dict[str, Any], *, recipient_label: str
) -> None:
    """檢查單一收件人的 required 自訂變數是否都有值。"""
    for item in definitions or []:
        if not item.get("required"):
            continue
        key = str(item.get("key", ""))
        value = variables.get(key, item.get("default_value", ""))
        if value is None or str(value).strip() == "":
            raise ValueError(f"{recipient_label} 缺少必要佔位符：{key}")


@lru_cache(maxsize=1)
def _personalization_environment() -> SandboxedEnvironment:
    env = SandboxedEnvironment(autoescape=False, undefined=StrictUndefined)
    return env


def render_personalized_text(raw: str, variables: dict[str, Any]) -> str:
    """以受限 Jinja2 語法渲染文字欄位；變數不存在會明確失敗。"""
    try:
        return _personalization_environment().from_string(raw or "").render(**variables)
    except TemplateError as exc:
        raise ValueError(f"佔位符渲染失敗：{exc}") from exc


def build_personalization_context(
    *,
    user_id: uuid.UUID | None,
    name: str | None,
    email: str,
    student_id: str | None,
    custom_variables: dict[str, Any],
) -> dict[str, Any]:
    """建立系統預設佔位符與自訂佔位符合併後的 context。"""
    unsubscribe_url = ""
    email_link_base_url = settings.EMAIL_LINK_BASE_URL.rstrip("/")
    if user_id:
        token = make_unsubscribe_token(user_id, "email")
        unsubscribe_url = f"{email_link_base_url}/unsubscribe?token={token}"
    return {
        **{key: "" if value is None else str(value) for key, value in custom_variables.items()},
        "姓名": name or "",
        "電子郵件": email,
        "user": {
            "id": str(user_id) if user_id else "",
            "name": name or "",
            "email": email,
            "student_id": student_id or "",
        },
        "unsubscribe_url": unsubscribe_url,
        "frontend_base_url": email_link_base_url,
    }


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
