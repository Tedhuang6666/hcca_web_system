"""安全重新導向工具 — 防止 Open Redirect (CWE-601)。

`next` 之類的重導參數一律只接受「站內相對路徑」。任何可能逃逸出本站來源的
形式都會被退回 `default`：

  - 絕對網址（``https://evil.com``、缺少前導 ``/``）
  - 協定相對 ``//host``
  - 反斜線變體 ``/\\host``（瀏覽器會把 ``\\`` 正規化成 ``/``）
  - 上述的百分比編碼（``/%2f``、``/%5c``）
  - 內嵌控制字元（``\\r \\n \\t \\0``）——瀏覽器可能去除後形成繞過
"""

from __future__ import annotations

_UNSAFE_PREFIXES = ("//", "/\\", "/%2f", "/%5c")
_CONTROL_CHARS = ("\\", "\r", "\n", "\t", "\x00")


def safe_next_path(value: str | None, *, default: str = "/") -> str:
    """回傳安全的站內相對路徑；不安全時回傳 ``default``。"""
    if not value or not value.startswith("/"):
        return default
    if value.lower().startswith(_UNSAFE_PREFIXES):
        return default
    if any(ch in value for ch in _CONTROL_CHARS):
        return default
    return value
