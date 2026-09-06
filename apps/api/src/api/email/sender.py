"""Email 高階寄送層：渲染品牌範本後逐封寄送（每位收件人各一封，不互相曝光信箱）。"""

from __future__ import annotations

from api.email.generic import render_generic_message
from api.email.renderer import render_email, render_personalized_text
from api.services.mail import enqueue_email

__all__ = [
    "enqueue_rendered",
    "render_generic_message",
    "render_generic_subject",
    "send_branded_email",
]


def enqueue_rendered(
    to: list[str],
    subject: str,
    html: str,
    email_message_id: str | None = None,
    email_recipient_id: str | None = None,
    attachments: list[dict[str, str]] | None = None,
    recipient_metadata: list[dict[str, str | None]] | None = None,
    source: str | None = None,
    message_template: str | None = None,
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
            already_rendered=True,
            recipient_metadata=(
                [recipient_metadata[index]]
                if recipient_metadata is not None and index < len(recipient_metadata)
                else None
            ),
            source=source,
            message_template=message_template,
        )
        for index, addr in enumerate(to)
        if addr
    ]


def send_branded_email(
    to: list[str],
    subject: str,
    template: str,
    context: dict,
    *,
    recipient_metadata: list[dict[str, str | None]] | None = None,
    source: str | None = None,
) -> list[str]:
    """渲染品牌範本並對每位收件人各寄一封。範本只渲染一次。"""
    html = render_email(template, {**context, "subject": subject})
    return enqueue_rendered(
        to,
        subject,
        html,
        recipient_metadata=recipient_metadata,
        source=source,
        message_template=template,
    )


def render_generic_subject(subject: str, variables: dict | None = None) -> str:
    """渲染個人化主旨，供逐封寄送時與 HTML 內容保持一致。"""
    return render_personalized_text(subject, variables or {}) if variables else subject
