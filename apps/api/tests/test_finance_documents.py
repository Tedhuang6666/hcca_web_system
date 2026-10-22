"""財務 DOCX 維持文字跳脫與有效的 WordprocessingML 命名空間。"""

from io import BytesIO
from zipfile import ZipFile

from defusedxml import ElementTree

from api.services.finance_documents import W, advance_receipt


def test_advance_receipt_escapes_user_text() -> None:
    budget = '預算 <w:injected/> & "測試"'
    recipient = "代墊人 <w:injected/> & 甲"
    item = "項目 <w:injected/> & 乙"
    receipt = advance_receipt(
        budget,
        [
            {
                "advanced_by_name": recipient,
                "items": [{"name": item, "amount": 1234}],
            }
        ],
    )
    with ZipFile(BytesIO(receipt)) as archive:
        document = ElementTree.fromstring(archive.read("word/document.xml"), forbid_dtd=True)
        for name in archive.namelist():
            ElementTree.fromstring(archive.read(name), forbid_dtd=True)

    assert document.tag == f"{{{W}}}document"
    texts = [element.text for element in document.iter(f"{{{W}}}t")]
    assert all(value in texts for value in (budget, recipient, item, "1,234"))
    assert list(document.iter(f"{{{W}}}injected")) == []
