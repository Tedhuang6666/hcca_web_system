---
version: 1
slug: "apps-web-src-app-public-regulations-page-tsx"
primary_target: "apps/web/src/app/(public)/regulations/page.tsx"
related_targets: ["apps/web/src/app/(public)/documents/page.tsx","apps/web/src/app/(public)/documents/[id]/PublicDocumentView.tsx","apps/web/src/app/(public)/regulations/[id]/RegulationDetailPageClient.tsx","apps/web/src/components/site/administrative.css"]
---

# 法規與公文公開系統

範圍：/regulations、/documents 之列表、法規全文與公開公文。索引為 Operate，正文為 Read。
使用者：學生與行政人員查詢、閱讀與引用正式資料。
方向：使用者指定的行政資料庫與法典／A4 文書；延續主站配色，移除促銷干擾。
主要內容：既有 API 與正式文書欄位；不得加入示例公文、推測署名、印章或日期。
主要互動：網址可保存的檢索；章節定位、條文深層連結、縮放、PDF 與列印。
驗證：桌面 1440px、手機 390px；錯誤／空結果／重試及鍵盤。規則見 docs/ADMINISTRATIVE_DESIGN.md。
限制：資料庫測試需本機 PostgreSQL *_test；公開 API 舊版尚無列表 issued_at 時顯示未載明。
