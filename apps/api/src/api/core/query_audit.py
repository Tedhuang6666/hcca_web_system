"""SQL query counter for detecting N+1 patterns per request.

啟用後會在每個 request 開頭重置 counter，結束時若 query 數量超過閾值或
慢查詢過多，會寫 WARN log 與 X-DB-Queries 響應 header（方便開發時觀察）。

慢查詢樣本（去除參數的 statement template）會用 in-memory ring buffer 保留，
供 admin/system slow-queries 端點查詢。不寫入磁碟以避免敏感資訊外洩。
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import deque
from contextvars import ContextVar
from dataclasses import dataclass, field

from sqlalchemy import event
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# 每 request scope 的計數器（middleware 在 request 開頭 reset、結尾讀取）
_query_count: ContextVar[int] = ContextVar("query_count", default=0)
_slow_query_count: ContextVar[int] = ContextVar("slow_query_count", default=0)
_total_query_ms: ContextVar[float] = ContextVar("total_query_ms", default=0.0)

SLOW_QUERY_MS = 50.0  # 單筆 query > 50ms 視為慢查詢
N_PLUS_ONE_THRESHOLD = 20  # 單一 request 超過此 query 數會 WARN
_SLOW_RING_MAX = 100


@dataclass
class SlowQuerySample:
    template: str
    elapsed_ms: float
    occurrences: int = 1
    last_seen: float = field(default_factory=time.time)
    max_ms: float = 0.0

    def update(self, elapsed_ms: float) -> None:
        self.occurrences += 1
        self.last_seen = time.time()
        self.max_ms = max(self.max_ms, elapsed_ms)


_slow_samples: deque[SlowQuerySample] = deque(maxlen=_SLOW_RING_MAX)
_slow_index: dict[str, SlowQuerySample] = {}
_slow_lock = threading.Lock()


def _normalize_statement(statement: str) -> str:
    """去除字面值/數字以聚合相同模板的查詢。截斷過長字串。"""
    s = re.sub(r"'[^']*'", "?", statement)
    s = re.sub(r"\b\d+\b", "?", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:240]


def _record_slow_sample(statement: str, elapsed_ms: float) -> None:
    template = _normalize_statement(statement)
    with _slow_lock:
        sample = _slow_index.get(template)
        if sample:
            sample.update(elapsed_ms)
            return
        sample = SlowQuerySample(template=template, elapsed_ms=elapsed_ms, max_ms=elapsed_ms)
        _slow_samples.append(sample)
        _slow_index[template] = sample
        # 維持 index 與 ring buffer 一致：被擠出的元素也要從 index 移除
        # （deque 上限自動擠出舊元素，但 dict 不會跟著縮，這裡用集合校正）
        if len(_slow_index) > _SLOW_RING_MAX:
            alive = {s.template for s in _slow_samples}
            for k in list(_slow_index.keys()):
                if k not in alive:
                    _slow_index.pop(k, None)


def get_slow_queries(top: int = 10) -> list[dict[str, object]]:
    """取最近 ring buffer 內出現頻率/耗時最高的 N 筆慢查詢。"""
    with _slow_lock:
        snapshot = list(_slow_samples)
    snapshot.sort(key=lambda s: (s.max_ms, s.occurrences), reverse=True)
    return [
        {
            "template": s.template,
            "max_ms": round(s.max_ms, 1),
            "occurrences": s.occurrences,
            "last_seen": s.last_seen,
        }
        for s in snapshot[:top]
    ]


def reset_request_counters() -> None:
    _query_count.set(0)
    _slow_query_count.set(0)
    _total_query_ms.set(0.0)


def get_request_counters() -> tuple[int, int, float]:
    return _query_count.get(), _slow_query_count.get(), _total_query_ms.get()


def install_listeners() -> None:
    """於 app startup 時呼叫一次；註冊全域 cursor event。"""

    @event.listens_for(Engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001, ANN202
        context._query_start_time = time.perf_counter()

    @event.listens_for(Engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001, ANN202
        start = getattr(context, "_query_start_time", None)
        if start is None:
            return
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        _query_count.set(_query_count.get() + 1)
        _total_query_ms.set(_total_query_ms.get() + elapsed_ms)
        if elapsed_ms > SLOW_QUERY_MS:
            _slow_query_count.set(_slow_query_count.get() + 1)
            _record_slow_sample(str(statement), elapsed_ms)
