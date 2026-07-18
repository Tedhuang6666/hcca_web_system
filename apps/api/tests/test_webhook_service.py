"""Webhook service 核心邏輯測試（HMAC + backoff）。"""

from __future__ import annotations

import hashlib
import hmac

import pytest

from api.services import webhook


def test_generate_signing_secret_is_unique():
    a = webhook.generate_signing_secret()
    b = webhook.generate_signing_secret()
    assert a != b
    assert len(a) > 20


def test_sign_payload_matches_manual_hmac():
    secret = "test-secret"
    body = b'{"event":"document.approved","id":"1"}'
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    assert webhook.sign_payload(secret, body) == expected


def test_sign_payload_accepts_str():
    secret = "x"
    body_str = '{"a":1}'
    body_bytes = body_str.encode("utf-8")
    assert webhook.sign_payload(secret, body_str) == webhook.sign_payload(secret, body_bytes)


def test_backoff_increases_then_caps():
    backoffs = [webhook.next_backoff_seconds(i) for i in range(1, 10)]
    # 前幾次嚴格遞增
    assert backoffs[0] < backoffs[1] < backoffs[2]
    # 最終 cap 在 _BACKOFF_TABLE 最後一筆
    assert backoffs[-1] == webhook._BACKOFF_TABLE[-1]


def test_backoff_attempt_zero_returns_first_bucket():
    assert webhook.next_backoff_seconds(0) == webhook._BACKOFF_TABLE[0]
    assert webhook.next_backoff_seconds(-1) == webhook._BACKOFF_TABLE[0]


def test_serialize_payload_sort_keys_stable():
    a = {"b": 2, "a": 1}
    b = {"a": 1, "b": 2}
    assert webhook.serialize_payload(a) == webhook.serialize_payload(b)


async def test_validate_delivery_url_rejects_private_address() -> None:
    with pytest.raises(webhook.UnsafeWebhookUrlError):
        await webhook.validate_delivery_url("https://127.0.0.1/webhook")
