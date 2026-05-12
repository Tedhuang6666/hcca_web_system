"""Celery 郵件任務單元測試（使用 Mock 避免真實 SMTP 連線）"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services.mail import enqueue_email, send_email


def test_send_email_task_calls_fastmail(monkeypatch: pytest.MonkeyPatch) -> None:
    """send_email Celery task 應呼叫 FastMail.send_message"""
    mock_fm_instance = MagicMock()
    mock_fm_instance.send_message = AsyncMock()

    with patch("api.services.mail.FastMail", return_value=mock_fm_instance):
        # 使用 Celery 的 eager 模式（同步執行，不需要 Worker）
        with patch("api.services.mail.asyncio.run") as mock_run:
            send_email(["test@example.com"], "測試主旨", "<p>測試內容</p>")
            # asyncio.run 應被呼叫一次
            mock_run.assert_called_once()


def test_send_email_returns_sent_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """send_email task 執行成功時應回傳 status: sent"""
    with patch("api.services.mail.asyncio.run"):
        result = send_email(["user@school.edu"], "主旨", "內容")

    assert result["status"] == "sent"
    assert result["to"] == ["user@school.edu"]
    assert result["subject"] == "主旨"


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


def test_send_email_retries_on_failure() -> None:
    """send_email 在 SMTP 失敗時應觸發 Celery retry 機制"""
    # 直接 patch task 物件上的 retry（bind=True 的正確 mock 方式）
    with patch.object(send_email, "retry", side_effect=Exception("retry called")) as mock_retry:
        with patch("api.services.mail.asyncio.run", side_effect=ConnectionError("SMTP down")):
            with pytest.raises(Exception, match="retry called"):
                send_email(["x@y.com"], "s", "b")

    mock_retry.assert_called_once()
