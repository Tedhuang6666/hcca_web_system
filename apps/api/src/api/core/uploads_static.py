"""受限的 /uploads 靜態服務 — 只放行「本就公開」的媒體前綴，其餘一律 404。

背景（安全）：
    歷史上 `/uploads` 是一個 catch-all 靜態掛載，會把 uploads/ 底下所有檔案
    無認證直接吐出。但公文附件（含密件）也存在 uploads/{document_id}/...，
    於是 `documents_attachments.py` 裡精心做的 `assert_access` /
    `can_anonymous_access_document` / 密等檢查全被這條靜態路徑繞過——任何人拿到
    URL 就能下載受存取控制的附件。

修法：
    公開媒體（公告圖片、商品圖、問卷圖、官網素材與投稿範本）以具名前綴儲存：
        announcements/{id}/...、merchandise-submissions/templates/...、shop/...、
        surveys/...、public-site/...
    這些需要以 <img src="/uploads/..."> 形式被未登入訪客嵌入，故仍靜態服務。
    推薦商家菜單可能隨商家或菜單狀態撤下，只能走會檢查公開狀態的菜單下載端點。
    公文附件則使用「裸 UUID」前綴（uploads/{document_id}/...），不在允許清單內，
    故一律 404；附件存取改走已授權的端點：
        GET /documents/{doc_id}/attachments/{att_id}/download
        GET /documents/{doc_id}/attachments/{att_id}/preview
    （這兩個端點以 FileResponse 直接 serve 檔案，不依賴本靜態掛載；前端本就使用它們。）

防穿越：入口自行拒絕非標準路徑，不依賴 StaticFiles 呼叫前的正規化。
    檔案查找後再驗證解析符號連結的實體路徑，避免公開目錄的連結指向私有附件。
"""

from __future__ import annotations

import os
from pathlib import Path

from starlette.responses import PlainTextResponse, Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

# 唯一允許未認證靜態存取的前綴（對應公開媒體上傳路徑）。
PUBLIC_UPLOAD_PREFIXES: tuple[str, ...] = (
    "announcements/",
    "merchandise-submissions/templates/",
    "shop/",
    "surveys/",
    "public-site/",
)


def _is_public_path(path: str) -> bool:
    return (
        path.startswith(PUBLIC_UPLOAD_PREFIXES)
        and "\\" not in path
        and all(part not in {"", ".", ".."} for part in path.split("/"))
    )


class PublicUploadsStaticFiles(StaticFiles):
    """只服務公開媒體前綴的 StaticFiles；其餘路徑（如公文附件）回 404。"""

    async def get_response(self, path: str, scope: Scope) -> Response:
        if not _is_public_path(path):
            # 公文附件與任何非公開路徑：絕不未認證直出，強制走已授權端點。
            return PlainTextResponse("Not Found", status_code=404)
        return await super().get_response(path, scope)

    def lookup_path(self, path: str) -> tuple[str, os.stat_result | None]:
        full_path, stat_result = super().lookup_path(path)
        if stat_result is None:
            return "", None
        resolved = Path(full_path).resolve()
        for directory in self.all_directories:
            try:
                relative = resolved.relative_to(Path(directory).resolve())
            except ValueError:
                continue
            if _is_public_path(relative.as_posix()):
                return str(resolved), stat_result
        # StaticFiles 只限制 uploads 根目錄，仍須防止公開前綴連到根目錄內的私有檔案。
        return "", None
