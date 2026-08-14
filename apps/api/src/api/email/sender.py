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
        )
        for addr in to
        if addr
    ]


def send_branded_email(to: list[str], subject: str, template: str, context: dict) -> list[str]:
    """渲染品牌範本並對每位收件人各寄一封。範本只渲染一次。"""
    html = render_email(template, {**context, "subject": subject})
    return enqueue_rendered(to, subject, html)


def render_generic_subject(subject: str, variables: dict | None = None) -> str:
    """渲染個人化主旨，供逐封寄送時與 HTML 內容保持一致。"""
    return render_personalized_text(subject, variables or {}) if variables else subject
