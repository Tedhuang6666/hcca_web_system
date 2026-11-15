"""摘要規範的純資料測試，不建立或替換資料庫。"""

import pytest

from api.models.document import Document
from api.services.document._summary import document_content_summary


def test_decree_summary_uses_body_and_skips_document_heading() -> None:
    document = Document(
        category="decree",
        title="國立新竹高級中學班級聯合自治會主席令",
        content="""# 國立新竹高級中學班級聯合自治會主席令
中華民國115年11月8日
發文字號：測試字第1150000001號
任命測試幹部擔任資訊部部長，自即日起生效。""",
    )
    assert document_content_summary(document) == "任命測試幹部擔任資訊部部長，自即日起生效。"


@pytest.mark.parametrize("summary", [None, "國立新竹高級中學班級聯合自治會主席令"])
def test_decree_summary_never_falls_back_to_title(summary: str | None) -> None:
    document = Document(
        category="decree", title="國立新竹高級中學班級聯合自治會主席令", summary=summary
    )
    assert document_content_summary(document) is None


def test_explicit_summary_is_preserved_and_long_extract_is_marked() -> None:
    document = Document(
        category="decree", title="主席令", summary="原登錄摘要", content="令文內容" * 100
    )
    assert document_content_summary(document) == "原登錄摘要"
    document.summary = None
    summary = document_content_summary(document)
    assert summary is not None and len(summary) <= 200 and summary.endswith("…")


def test_non_decree_does_not_invent_summary() -> None:
    document = Document(
        category="letter", title="正式公文標題", content="此處不應自動取代正式主旨。"
    )
    assert document_content_summary(document) is None
