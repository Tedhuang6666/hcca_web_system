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


@pytest.mark.parametrize("answer", ["1", "L2、XXL1", "XL一件", "S/M各2件"])
async def test_public_csv_preserves_mixed_size_answers_without_credentials(monkeypatch, answer):
    import csv
    import io

    data = io.StringIO()
    csv.writer(data).writerows([["識別", "規格", ""], ["one", answer, ""]])
    requests = []

    def respond(request):
        requests.append(request)
        assert "authorization" not in request.headers
        assert request.url.params["gid"] == "0"
        assert request.url.params["format"] == "csv"
        assert "/export" in request.url.path and "/gviz/" not in request.url.path
        return httpx.Response(200, text=data.getvalue(), headers={"content-type": "text/csv"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        reader, "_access_token", lambda: pytest.fail("Public read must not use ADC")
    )
    monkeypatch.setattr(
        reader.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(respond)),
    )
    assert await reader.read_sheet("synthetic-id", "表單回覆 1", 10, 0) == [
        ["識別", "規格"],
        ["one", answer],
    ]
    assert len(requests) == 1


@pytest.mark.parametrize("mode", ["html", "rows", "columns", "bytes", "malformed", "redirect"])
async def test_public_csv_rejects_incomplete_or_unsafe_exports(monkeypatch, mode):
    def respond(request):
        if mode == "redirect":
            return httpx.Response(302, headers={"location": "https://example.org/private-export"})
        if mode == "html":
            return httpx.Response(
                200, text="<html>Sign in</html>", headers={"content-type": "text/html"}
            )
        body = {
            "rows": "header\n1\n2\n",
            "columns": ",".join(["column"] * 101),
            "bytes": "x" * 101,
            "malformed": 'header\n"unclosed',
        }[mode]
        return httpx.Response(200, text=body, headers={"content-type": "text/csv"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(reader, "_MAX_PUBLIC_BYTES", 100 if mode == "bytes" else 10000)
    monkeypatch.setattr(
        reader.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(respond)),
    )
    with pytest.raises(reader.SheetReadError):
        await reader.read_sheet("synthetic-id", "表單回覆 1", 2, 123)


async def test_public_csv_follows_only_google_export_redirects(monkeypatch):
    requests = []

    def respond(request):
        requests.append(request)
        assert "authorization" not in request.headers
        if request.url.host == "docs.google.com":
            return httpx.Response(
                302,
                headers={"location": "https://doc-export.googleusercontent.com/export/synthetic"},
            )
        return httpx.Response(200, content=b"header\n1\n", headers={"content-type": "text/csv"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        reader.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(**kwargs, transport=httpx.MockTransport(respond)),
    )
    assert await reader.read_sheet("synthetic-id", "表單回覆 1", 10, 123) == [["header"], ["1"]]
    assert len(requests) == 2
