"""Email 高階寄送層：渲染品牌範本後逐封寄送（每位收件人各一封，不互相曝光信箱）。"""

from __future__ import annotations

from api.email.renderer import (
    absolutize_url,
    render_email,
    render_personalized_text,
    safe_link_url,
    sanitize_html,
)
from api.services.mail import enqueue_email


def _style_paragraphs(html: str, paragraph_spacing: int) -> str:
    following = f'<p style="margin:{paragraph_spacing}px 0 0;">'
    styled = html.replace("<p>", following)
    return styled.replace(following, '<p style="margin:0;">', 1)


def enqueue_rendered(
    to: list[str],
    subject: str,
    html: str,
    email_message_id: str | None = None,
    email_recipient_id: str | None = None,
    attachments: list[dict[str, str]] | None = None,
) -> list[str]:
    """對每位收件人各寄一封「已渲染好」的 HTML email，回傳 Celery task_id 清單。"""
    return [
        enqueue_email(
            addr,
            subject,
            html,
            "html",
            email_message_id,
            email_recipient_id,
            attachments,
        )
        for addr in to
        if addr
    ]


def send_branded_email(to: list[str], subject: str, template: str, context: dict) -> list[str]:
    """渲染品牌範本並對每位收件人各寄一封。範本只渲染一次。"""
    html = render_email(template, {**context, "subject": subject})
    return enqueue_rendered(to, subject, html)


def render_generic_message(
    subject: str,
    body_markdown: str,
    context: dict,
    variables: dict | None = None,
) -> str:
    """組裝 generic 範本 context 並渲染為完整 HTML（寄信頁、預約寄送共用）。

    body_markdown 為使用者用富文本編輯器輸入的 Markdown，先轉 HTML、再以
    bleach 白名單清洗（雙重防護：Markdown 來源已停用 raw HTML）。
    """
    from markdown_it import MarkdownIt

    md = MarkdownIt("commonmark", {"html": False}).enable("strikethrough", True)

    def _text(value: str) -> str:
        return render_personalized_text(value, personal) if personal else value

    personal = variables or {}
    rendered_subject = render_personalized_text(subject, personal) if personal else subject
    rendered_body = (
        render_personalized_text(body_markdown or "", personal) if personal else body_markdown or ""
    )
    rendered_heading = (
        render_personalized_text(str(context.get("heading") or ""), personal)
        if personal
        else context.get("heading", "")
    )
    rendered_banner_image_url = (
        absolutize_url(_text(str(context.get("banner_image_url", ""))))
        if context.get("banner_image_url")
        else ""
    )
    rendered_banner_image_alt = _text(str(context.get("banner_image_alt", "")))
    rendered_rows = [
        {
            "label": render_personalized_text(str(row.get("label", "")), personal)
            if personal
            else row.get("label", ""),
            "value": render_personalized_text(str(row.get("value", "")), personal)
            if personal
            else row.get("value", ""),
        }
        for row in context.get("card_rows", [])
    ]
    rendered_cta_url = safe_link_url(
        render_personalized_text(str(context.get("cta_url") or ""), personal)
        if personal
        else str(context.get("cta_url", ""))
    )
    rendered_cta_label = (
        render_personalized_text(str(context.get("cta_label") or ""), personal)
        if personal
        else context.get("cta_label", "")
    )
    rendered_buttons = [
        {
            "label": _text(str(btn.get("label", ""))),
            "url": safe_link_url(_text(str(btn.get("url", "")))),
            "style": str(btn.get("style") or "primary"),
        }
        for btn in context.get("buttons", [])
        if safe_link_url(_text(str(btn.get("url", ""))))
    ]
    rendered_blocks = []
    paragraph_spacing = int(context.get("paragraph_spacing", 18))
    for block in context.get("blocks", []):
        block_type = str(block.get("type", ""))
        if block_type == "image":
            url = absolutize_url(_text(str(block.get("url", ""))))
            if url:
                rendered_blocks.append(
                    {"type": "image", "url": url, "alt": _text(str(block.get("alt", "")))}
                )
        elif block_type == "divider":
            rendered_blocks.append({"type": "divider"})
        elif block_type == "text":
            block_text = _text(str(block.get("md", "")))
            if block_text.strip():
                rendered_blocks.append(
                    {
                        "type": "text",
                        "html": _style_paragraphs(
                            sanitize_html(md.render(block_text)), paragraph_spacing
                        ),
                    }
                )
    html_body = md.render(rendered_body)
    return render_email(
        "generic",
        {
            "subject": rendered_subject,
            "preview_text": _text(
                str(context.get("preview_text") or rendered_heading or rendered_subject)
            )[:200],
            "body_html": _style_paragraphs(sanitize_html(html_body), paragraph_spacing),
            "heading": rendered_heading,
            "accent_color": str(context.get("accent_color") or "#111827"),
            "background_color": str(context.get("background_color") or "#eef2f7"),
            "content_background_color": str(context.get("content_background_color") or "#ffffff"),
            "body_line_height": float(context.get("body_line_height", 1.6)),
            "footer_text": _text(str(context.get("footer_text") or "")),
            "show_system_footer": bool(context.get("show_system_footer", True)),
            "banner_image_url": rendered_banner_image_url,
            "banner_image_alt": rendered_banner_image_alt,
            "card_rows": rendered_rows,
            "cta_url": rendered_cta_url,
            "cta_label": rendered_cta_label,
            "buttons": rendered_buttons,
            "blocks": rendered_blocks,
        },
    )


def render_generic_subject(subject: str, variables: dict | None = None) -> str:
    """渲染個人化主旨，供逐封寄送時與 HTML 內容保持一致。"""
    return render_personalized_text(subject, variables or {}) if variables else subject
