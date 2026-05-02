"""LINE Bot Webhook 路由"""

import logging

from fastapi import APIRouter, Header, HTTPException, Request, status
from linebot.v3.exceptions import InvalidSignatureError

from api.services.line_bot import is_configured, verify_and_parse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/line", tags=["LINE Bot"])


@router.post("/webhook", summary="LINE Bot Webhook 接收端點")
async def line_webhook(
    request: Request,
    x_line_signature: str = Header(..., alias="X-Line-Signature"),
) -> dict[str, str]:
    """
    接收 LINE Platform 發送的事件。

    LINE 在每次請求加入 X-Line-Signature Header 供驗證，
    確保請求確實來自 LINE 而非第三方。
    """
    if not is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LINE Bot 尚未設定，請聯絡管理員",
        )

    body_bytes = await request.body()
    body_str = body_bytes.decode("utf-8")

    try:
        verify_and_parse(body_str, x_line_signature)
    except InvalidSignatureError as e:
        logger.warning("LINE Webhook 簽名驗證失敗: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的 LINE 簽名",
        ) from e

    return {"status": "ok"}


@router.get("/status", summary="LINE Bot 設定狀態")
async def line_status() -> dict[str, object]:
    """回傳 LINE Bot 是否已完整設定（供管理員確認）"""
    return {
        "configured": is_configured(),
        "message": "LINE Bot 已設定完成" if is_configured() else "請設定 LINE_CHANNEL_SECRET 與 LINE_CHANNEL_ACCESS_TOKEN",
    }
