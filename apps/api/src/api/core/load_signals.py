"""全域負載訊號 — 給 load_shed middleware 與 admin 系統狀態頁共用。

維護兩個 in-process 指標：
  - `active_requests`：當下進行中的 HTTP 請求數（HTTP middleware 在 try/finally 維護）
  - `recent_status_window`：過去 N 秒的 (timestamp, status_code) 滑動視窗

這些指標是 per-worker（單一 Gunicorn worker 進程）的；多 worker 環境下，
load_shed 決策也是 per-worker，這樣的好處是某個 worker 卡住時不會影響另一個。
admin 狀態頁如要看全進程聚合，需另跨 IPC（暫不做，PoC 階段用單 worker 觀察）。
"""

from __future__ import annotations

import time
from collections import deque
from threading import Lock

_WINDOW_SECONDS = 60.0

_lock = Lock()
_active_requests: int = 0
_status_window: deque[tuple[float, int]] = deque()


def inc_active() -> None:
    global _active_requests
    with _lock:
        _active_requests += 1


def dec_active() -> None:
    global _active_requests
    with _lock:
        if _active_requests > 0:
            _active_requests -= 1


def record_status(status_code: int) -> None:
    """記錄一筆 response status。會順帶 evict 過期樣本。"""
    now = time.monotonic()
    cutoff = now - _WINDOW_SECONDS
    with _lock:
        _status_window.append((now, status_code))
        while _status_window and _status_window[0][0] < cutoff:
            _status_window.popleft()


def get_active_requests() -> int:
    with _lock:
        return _active_requests


def get_5xx_ratio() -> float:
    """過去 60s 內 5xx 比例（0.0–1.0）；樣本不足 (<10) 時回 0.0 避免雜訊觸發。"""
    now = time.monotonic()
    cutoff = now - _WINDOW_SECONDS
    with _lock:
        while _status_window and _status_window[0][0] < cutoff:
            _status_window.popleft()
        total = len(_status_window)
        if total < 10:
            return 0.0
        fivexx = sum(1 for _, s in _status_window if 500 <= s < 600)
        return fivexx / total


def get_recent_5xx_count() -> int:
    """過去 60s 內 5xx 絕對數量（給 admin 狀態頁顯示）。"""
    now = time.monotonic()
    cutoff = now - _WINDOW_SECONDS
    with _lock:
        while _status_window and _status_window[0][0] < cutoff:
            _status_window.popleft()
        return sum(1 for _, s in _status_window if 500 <= s < 600)


def snapshot() -> dict[str, float | int]:
    return {
        "active_requests": get_active_requests(),
        "recent_5xx_ratio": round(get_5xx_ratio(), 4),
        "recent_5xx_count": get_recent_5xx_count(),
        "window_seconds": int(_WINDOW_SECONDS),
    }
