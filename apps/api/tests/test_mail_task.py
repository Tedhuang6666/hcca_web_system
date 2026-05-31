"""Celery 郵件任務單元測試（使用 Mock 避免真實 Resend API 呼叫）"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.mail import enqueue_email, send_email, send_email_now


def _close_coro_and_return(coro, value: str = "email-id") -> str:  # noqa: ANN001
    coro.close()
    return value


def _close_coro_and_raise(coro) -> None:  # noqa: ANN001
    coro.close()
    raise ConnectionError("Resend down")


def test_send_email_task_calls_resend(monkeypatch: pytest.MonkeyPatch) -> None:
    """send_email Celery task 應呼叫 Resend 寄送函式"""
    monkeypatch.setattr("api.services.mail.settings.RESEND_API_KEY", "re_test")

    with patch("api.services.mail.asyncio.run", side_effect=_close_coro_and_return) as mock_run:
        send_email(["test@example.com"], "測試主旨", "<p>測試內容</p>")
        assert mock_run.call_count == 2


def test_send_email_returns_sent_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """send_email task 執行成功時應回傳 status: sent"""
    monkeypatch.setattr("api.services.mail.settings.RESEND_API_KEY", "re_test")
    with patch("api.services.mail.asyncio.run", side_effect=_close_coro_and_return):
        result = send_email(["user@school.edu"], "主旨", "內容")

    assert result["status"] == "sent"
    assert result["to"] == ["user@school.edu"]
    assert result["subject"] == "主旨"
    assert result["provider_id"] == "email-id"


def test_enqueue_email_returns_task_id() -> None:
    """enqueue_email 應回傳 Celery task_id 字串"""
    mock_task_result = MagicMock()
    mock_task_result.id = "fake-task-id-12345"

    with patch("api.services.mail.send_email.delay", return_value=mock_task_result) as mock_delay:
        task_id = enqueue_email("to@example.com", "subject", "body")

    assert task_id == "fake-task-id-12345"
    # delay 應以 list 型態呼叫（單一收件人也轉換成 list）
    mock_delay.assert_called_once_with(["to@example.com"], "subject", "body", "html")


def test_enqueue_email_accepts_list_of_recipients() -> None:
    """enqueue_email 應接受多位收件人清單"""
    mock_task_result = MagicMock()
    mock_task_result.id = "task-abc"

    with patch("api.services.mail.send_email.delay", return_value=mock_task_result) as mock_delay:
        enqueue_email(["a@x.com", "b@x.com"], "s", "b")

    args = mock_delay.call_args[0]
    assert args[0] == ["a@x.com", "b@x.com"]


def test_enqueue_email_accepts_message_id() -> None:
    """enqueue_email 可把 EmailMessage id 帶進 Celery task，供完成後回寫狀態。"""
    mock_task_result = MagicMock()
    mock_task_result.id = "task-with-message"

    with patch("api.services.mail.send_email.delay", return_value=mock_task_result) as mock_delay:
        enqueue_email("to@example.com", "subject", "body", email_message_id="message-id")

    mock_delay.assert_called_once_with(
        ["to@example.com"], "subject", "body", "html", "message-id"
    )


def test_send_email_retries_on_failure() -> None:
    """send_email 在 Resend API 失敗時應觸發 Celery retry 機制"""
    # 直接 patch task 物件上的 retry（bind=True 的正確 mock 方式）
    with (
        patch.object(send_email, "retry", side_effect=Exception("retry called")) as mock_retry,
        patch("api.services.mail.asyncio.run", side_effect=_close_coro_and_raise),
        pytest.raises(Exception, match="retry called"),
    ):
        send_email(["x@y.com"], "s", "b")

    mock_retry.assert_called_once()


async def test_send_email_now_posts_to_resend(monkeypatch: pytest.MonkeyPatch) -> None:
    """send_email_now 應以 Resend API payload 寄送 HTML 郵件"""
    monkeypatch.setattr("api.services.mail.settings.RESEND_API_KEY", "re_test")
    monkeypatch.setattr("api.services.mail.settings.MAIL_FROM", "noreply@hct.works")
    monkeypatch.setattr("api.services.mail.settings.MAIL_FROM_NAME", "HCCA")
    mock_response = MagicMock()
    mock_response.json.return_value = {"id": "email-id"}
    mock_response.raise_for_status = MagicMock()
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("api.services.mail.httpx.AsyncClient", return_value=mock_client):
        await send_email_now("user@example.com", "主旨", "<p>內容</p>")

    mock_client.post.assert_awaited_once()
    _url, kwargs = mock_client.post.call_args
    assert kwargs["headers"]["Authorization"] == "Bearer re_test"
    assert kwargs["json"] == {
        "from": "HCCA <noreply@hct.works>",
        "to": ["user@example.com"],
        "subject": "主旨",
        "html": "<p>內容</p>",
    }
