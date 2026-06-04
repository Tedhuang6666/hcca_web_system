"""平台統一時鐘工具。

整個系統的「今天 / 現在 / 民國年」一律以台北時間（Asia/Taipei, UTC+8）為準，
不依賴容器的 TZ 環境變數，避免：
- 容器預設 UTC 時，台北 00:00–08:00 之間「今天」被誤判成昨天；
- 民國年字號在跨年夜凌晨拿到前一年的年份；
- 有人日後改容器 TZ 後，散落的 datetime.now(UTC).date() 與 date.today() 互相分裂。

儲存到資料庫的時間戳仍應使用 aware UTC（datetime.now(UTC)）；
本模組只負責「業務上的當地日期/年份」判定。
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

TAIPEI = ZoneInfo("Asia/Taipei")


def now_local() -> datetime:
    """台北當地時間（timezone-aware）。"""
    return datetime.now(TAIPEI)


def local_today() -> date:
    """台北當地的「今天」。取代散落的 date.today() / datetime.now(UTC).date()。"""
    return now_local().date()


def roc_year() -> int:
    """台北當地的民國年（西元 - 1911）。用於字號年份。"""
    return now_local().year - 1911
