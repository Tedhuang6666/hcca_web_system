"""以公開 CSV 或服務帳號唯讀存取 Sheets，不阻塞 event loop。"""

import asyncio
import csv
import io
from functools import partial
from urllib.parse import quote

import httpx


class SheetReadError(RuntimeError):
    pass


_MAX_PUBLIC_BYTES = 8 * 1024 * 1024


async def _read_public_sheet_csv(
    spreadsheet_id: str, sheet_id: int, max_rows: int
) -> list[list[str]]:
    """CSV 匯出保留數量與尺寸混用的文字；不透過會推斷欄位型別的圖表查詢。"""
    url = httpx.URL(
        f"https://docs.google.com/spreadsheets/d/{quote(spreadsheet_id, safe='')}/export",
        params={"format": "csv", "gid": str(sheet_id)},
    )
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        for _attempt in range(4):
            async with client.stream("GET", url) as response:
                if response.is_redirect:
                    url = response.url.join(response.headers.get("location", ""))
                    host = url.host or ""
                    if url.scheme != "https" or not (
                        host == "docs.google.com" or host.endswith(".googleusercontent.com")
                    ):
                        raise SheetReadError("公開分頁無法唯讀匯出，請確認連結讀取權限")
                    continue
                response.raise_for_status()
                if "text/csv" not in response.headers.get("content-type", "").lower():
                    raise SheetReadError("Google 未回傳 CSV，請確認公開分頁 ID 與連結讀取權限")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > _MAX_PUBLIC_BYTES:
                        raise SheetReadError("公開分頁超過 8 MiB，請分割來源")
                rows = []
                try:
                    for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                        while row and not row[-1].strip():
                            row.pop()
                        if len(row) > 100:
                            raise SheetReadError("公開分頁超過 100 欄，請分割來源")
                        rows.append(row)
                        if len(rows) > max_rows:
                            raise SheetReadError("公開分頁超過設定列數上限，請分割來源")
                except (UnicodeError, csv.Error) as exc:
                    raise SheetReadError("公開分頁 CSV 格式不正確，無法安全匯入") from exc
                return rows
    raise SheetReadError("公開分頁重新導向次數過多，請確認來源連結")


def _access_token() -> str:
    import google.auth
    from google.auth.transport.requests import Request

    credentials, _project = google.auth.default(
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )
    credentials.refresh(partial(Request(), timeout=20))
    return credentials.token


async def read_sheet(
    spreadsheet_id: str, sheet_name: str, max_rows: int, public_sheet_id: int | None = None
) -> list[list[str]]:
    try:
        if public_sheet_id is not None:
            return await _read_public_sheet_csv(spreadsheet_id, public_sheet_id, max_rows)
        token = await asyncio.to_thread(_access_token)
        base = f"https://sheets.googleapis.com/v4/spreadsheets/{quote(spreadsheet_id, safe='')}"
        async with httpx.AsyncClient(
            headers={"Authorization": f"Bearer {token}"}, timeout=30, follow_redirects=False
        ) as client:
            metadata = await client.get(base, params={"fields": "sheets(properties)"})
            metadata.raise_for_status()
            properties = [sheet["properties"] for sheet in metadata.json().get("sheets", [])]
            sheet = next((item for item in properties if item["title"] == sheet_name), None)
            if sheet is None:
                raise SheetReadError("找不到設定的工作表，請核對分頁名稱")
            columns = sheet["gridProperties"]["columnCount"]
            if columns > 100:
                raise SheetReadError("工作表超過 100 欄，請建立專用的表單回覆分頁")
            if sheet["gridProperties"]["rowCount"] > max_rows:
                raise SheetReadError("工作表列數超過設定上限，請分割來源或移除多餘空白列")
            end_column = ""
            number = columns
            while number:
                number, remainder = divmod(number - 1, 26)
                end_column = chr(65 + remainder) + end_column
            quoted_tab = "'" + sheet_name.replace("'", "''") + "'"
            rows: list[list[str]] = []
            # 多讀一列以確認沒有因設定的上限而靜默漏單。
            limit = min(max_rows + 1, sheet["gridProperties"]["rowCount"])
            for start in range(1, limit + 1, 500):
                end = min(start + 499, limit)
                cell_range = quote(f"{quoted_tab}!A{start}:{end_column}{end}", safe="")
                response = await client.get(
                    f"{base}/values/{cell_range}", params={"valueRenderOption": "FORMATTED_VALUE"}
                )
                response.raise_for_status()
                page = response.json().get("values", [])
                rows.extend([[str(cell) for cell in row] for row in page])
                rows.extend([[] for _ in range(end - start + 1 - len(page))])
            if len(rows) > max_rows and any(rows[max_rows]):
                raise SheetReadError("表單超過設定列數上限，請先分割來源")
            return rows[:max_rows]
    except SheetReadError:
        raise
    except httpx.HTTPStatusError as exc:
        raise SheetReadError(
            f"Google Sheets 讀取失敗（HTTP {exc.response.status_code}），請檢查唯讀分享與 API 設定"
        ) from exc
    except Exception as exc:
        # 不把憑證、HTTP 回應或填答資料寫入 error/log。
        raise SheetReadError("無法讀取 Google Sheets，請檢查服務帳號認證與連線") from exc
