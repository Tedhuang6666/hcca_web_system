"""LINE Bot 服務 - Webhook 處理與訊息推播"""

from __future__ import annotations

import logging

from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    ApiClient,
    Configuration,
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
)
from linebot.v3.webhook import WebhookHandler
from linebot.v3.webhooks import MessageEvent, TextMessageContent

from api.core.config import settings

logger = logging.getLogger(__name__)

# ── 初始化（Channel Secret 為空時降級為 Noop）────────────────────────────────

handler = WebhookHandler(settings.LINE_CHANNEL_SECRET or "placeholder")

_line_config = Configuration(
    access_token=settings.LINE_CHANNEL_ACCESS_TOKEN or "placeholder"
)


def is_configured() -> bool:
    """回傳 LINE Bot 是否已完整設定"""
    return bool(settings.LINE_CHANNEL_SECRET and settings.LINE_CHANNEL_ACCESS_TOKEN)


# ── 訊息事件處理器 ────────────────────────────────────────────────────────────

@handler.add(MessageEvent, message=TextMessageContent)
def handle_text_message(event: MessageEvent) -> None:
    """文字訊息處理：Echo 回覆使用者輸入"""
    if not is_configured():
        return

    user_text = event.message.text  # type: ignore[union-attr]
    logger.info("LINE 收到訊息 user_id=%s text=%s", event.source.user_id, user_text)

    reply_text = _build_reply(user_text)

    with ApiClient(_line_config) as api_client:
        line_api = MessagingApi(api_client)
        line_api.reply_message(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=reply_text)],
            )
        )


def _build_reply(user_text: str) -> str:
    """根據使用者輸入產生回覆文字（可擴充為指令路由）"""
    commands = {
        "說明": "📋 可用指令：\n• 說明 - 顯示此訊息\n• 公告 - 最新公告",
        "公告": "📢 目前沒有最新公告。",
    }
    return commands.get(user_text.strip(), f"收到：{user_text}")


# ── 推播輔助函式 ──────────────────────────────────────────────────────────────

def push_text_message(user_id: str, text: str) -> None:
    """
    主動推播文字訊息給指定使用者。
    需要 LINE_CHANNEL_ACCESS_TOKEN 具備 push message 權限。
    """
    if not is_configured():
        logger.warning("LINE Bot 未設定，跳過推播")
        return

    from linebot.v3.messaging import PushMessageRequest

    with ApiClient(_line_config) as api_client:
        line_api = MessagingApi(api_client)
        line_api.push_message(
            PushMessageRequest(
                to=user_id,
                messages=[TextMessage(text=text)],
            )
        )
    logger.info("LINE 推播完成 to=%s", user_id)


def verify_and_parse(body: str, signature: str) -> None:
    """
    驗證 X-Line-Signature 並解析事件。
    拋出 InvalidSignatureError 表示簽名不合法。
    """
    handler.handle(body, signature)


__all__ = ["InvalidSignatureError", "is_configured", "push_text_message", "verify_and_parse"]
