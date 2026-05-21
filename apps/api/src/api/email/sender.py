"""Email 高階寄送層：渲染品牌範本後逐封寄送（每位收件人各一封，不互相曝光信箱）。"""

from __future__ import annotations

from api.email.renderer import render_email, sanitize_html
from api.services.mail import enqueue_email


def enqueue_rendered(to: list[str], subject: str, html: str) -> list[str]:
    """對每位收件人各寄一封「已渲染好」的 HTML email，回傳 Celery task_id 清單。"""
    return [enqueue_email(addr, subject, html, "html") for addr in to if addr]


def send_branded_email(to: list[str], subject: str, template: str, context: dict) -> list[str]:
    """渲染品牌範本並對每位收件人各寄一封。範本只渲染一次。"""
    html = render_email(template, {**context, "subject": subject})
    return enqueue_rendered(to, subject, html)


def render_generic_message(subject: str, body_markdown: str, context: dict) -> str:
    """組裝 generic 範本 context 並渲染為完整 HTML（寄信頁、預約寄送共用）。

    body_markdown 為使用者用富文本編輯器輸入的 Markdown，先轉 HTML、再以
    bleach 白名單清洗（雙重防護：Markdown 來源已停用 raw HTML）。
    """
    from markdown_it import MarkdownIt

    html_body = (
        MarkdownIt("commonmark", {"html": False})
        .enable("strikethrough", True)
        .render(body_markdown or "")
    )
    return render_email(
        "generic",
        {
            "subject": subject,
            "preview_text": (context.get("heading") or subject)[:80],
            "body_html": sanitize_html(html_body),
            "heading": context.get("heading", ""),
            "card_rows": context.get("card_rows", []),
            "cta_url": context.get("cta_url", ""),
            "cta_label": context.get("cta_label", ""),
        },
    )
