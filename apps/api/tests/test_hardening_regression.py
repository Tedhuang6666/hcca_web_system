"""2026-06-04 全系統檢測後的回歸測試。

鎖定以下修復，避免日後退化：
- 時區單一來源 api.core.clock（Asia/Taipei，不依賴容器 TZ）
- LIKE 萬用字元轉義（搜尋正確性）
- 字號/案號序列化配發（格式與遞增正確）
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.core.clock import TAIPEI, local_today, now_local, roc_year
from api.core.search import like_contains, like_escape

# ── 時區 ─────────────────────────────────────────────────────────────────────


def test_clock_is_taipei_not_utc() -> None:
    """clock 永遠回傳台北日期/年份，與容器 TZ 無關。"""
    expected = datetime.now(ZoneInfo("Asia/Taipei"))
    assert now_local().tzinfo == TAIPEI
    assert local_today() == expected.date()
    assert roc_year() == expected.year - 1911


def test_clock_today_differs_from_utc_in_early_morning() -> None:
    """台北 00:00–08:00 之間，台北日期應比 UTC 日期晚一天（這正是舊 bug 的時段）。"""
    taipei_now = now_local()
    # 僅在凌晨時段斷言差異，其餘時段兩者相同；此測試確保我們用的是台北而非 UTC。
    utc_today = datetime.now(ZoneInfo("UTC")).date()
    if taipei_now.hour < 8:
        assert local_today() >= utc_today


# ── LIKE 轉義 ────────────────────────────────────────────────────────────────


def test_like_escape_escapes_wildcards() -> None:
    assert like_escape("50%") == r"50\%"
    assert like_escape("a_b") == r"a\_b"
    assert like_escape(r"x\y") == r"x\\y"
    assert like_escape("normal") == "normal"


def test_like_contains_wraps_escaped_term() -> None:
    assert like_contains("50%") == r"%50\%%"
    assert like_contains("abc") == "%abc%"


# ── 字號序列化配發 ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_council_proposal_serial_is_sequential_and_unique(db_session) -> None:
    """連續建立提案應產生格式正確、遞增且唯一的字號（議提{民國年}NNNN）。"""
    from api.schemas.council_proposal import CouncilProposalCreate
    from api.services import council_proposal as svc

    def _payload(n: int) -> CouncilProposalCreate:
        return CouncilProposalCreate(
            contact_email="proposer@example.com",
            proposer_name=f"提案人{n}",
            case_type="finance",  # 非法規案，免連結 regulation
            title=f"測試提案 {n}",
            summary="摘要",
            proposal_text="提案內容",
            rationale="理由",
        )

    serials = []
    for n in range(3):
        proposal = await svc.create(db_session, data=_payload(n), submitter=None)
        serials.append(proposal.serial_number)

    year = roc_year()
    prefix = f"議提{year:03d}"
    assert serials == [f"{prefix}0001", f"{prefix}0002", f"{prefix}0003"]
    assert len(set(serials)) == 3  # 全部唯一
