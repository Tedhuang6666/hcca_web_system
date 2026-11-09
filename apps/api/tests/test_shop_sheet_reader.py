"""只 mock 外部 HTTP 與認證；驗證分頁界限與標題分頁引用。"""

import httpx
import pytest

from api.services.shop import _sheet_reader as reader


@pytest.mark.parametrize("failure", [None, "forbidden", "missing", "oversized"])
async def test_read_sheet_is_bounded_and_uses_exact_tab(monkeypatch, failure):
    requests = []
    tab = "老師's 表單"

    def respond(request):
        requests.append(request)
        assert request.headers["Authorization"] == "Bearer synthetic-token"
        if failure == "forbidden":
            return httpx.Response(403, json={"error": "private response not for logs"})
        if "/values/" not in request.url.path:
            return httpx.Response(
                200,
                json={
                    "sheets": [
                        {
                            "properties": {
                                "title": "另一個分頁" if failure == "missing" else tab,
                                "gridProperties": {
                                    "rowCount": 10001 if failure == "oversized" else 3,
                                    "columnCount": 4,
                                },
                            }
                        }
                    ]
                },
            )
        assert request.url.path.endswith("'老師''s 表單'!A1:D3")
        return httpx.Response(200, json={"values": [["時間戳記", "姓名"], ["one", "合成名稱"]]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(reader, "_access_token", lambda: "synthetic-token")
    monkeypatch.setattr(
        reader.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(respond)),
    )
    if failure:
        with pytest.raises(reader.SheetReadError) as error:
            await reader.read_sheet("synthetic-id", tab, 10000)
        assert "private response" not in str(error.value)
        assert len(requests) == 1
    else:
        assert await reader.read_sheet("synthetic-id", tab, 10000) == [
            ["時間戳記", "姓名"],
            ["one", "合成名稱"],
            [],
        ]
        assert len(requests) == 2


async def test_missing_credentials_are_reported_without_secret_content(monkeypatch):
    def fail():
        raise RuntimeError("synthetic-private-key-content")

    monkeypatch.setattr(reader, "_access_token", fail)
    with pytest.raises(reader.SheetReadError) as error:
        await reader.read_sheet("synthetic-id", "表單回覆 1", 100)
    assert "synthetic-private-key-content" not in str(error.value)
