---
version: 1
slug: "apps-web-src-app-public-regulations-page-tsx"
primary_target: "apps/web/src/app/(public)/regulations/page.tsx"
related_targets: ["apps/web/src/app/(public)/documents/page.tsx","apps/web/src/app/(public)/documents/[id]/PublicDocumentView.tsx","apps/web/src/app/(public)/regulations/[id]/RegulationDetailPageClient.tsx","apps/web/src/components/site/administrative.css"]
---

# 法規與公文公開系統

範圍：/regulations、/documents 之列表、法規全文與公開公文。索引為 Operate，正文為 Read。
使用者：學生與行政人員查詢、閱讀與引用正式資料。
方向：全站共同的頁首頁尾、導覽、字體與按鈕；僅為查詢表格、連續條文及 A4 閱讀安排內容。
法規管理直接整合主頁，閱讀工具與管理操作在標題及日期下方靠左排列，不另做行政 hero 或管理版型。
條文沿用全站字體與 1.5 行高；條間距 0.875em、項 0.375em、款 0.1875em、目 0.125em，保留階層縮排與引用連結。
法規僅從雲端來源自動同步、解析、查閱與公布，不提供起草、編輯或審議流程。
公文登入後與公開檢視共用正式文書本文，簽核與管理操作位於本文外。
主要內容：既有 API 與正式文書欄位；不得加入示例公文、推測署名、印章或日期。
主要互動：網址可保存的檢索；章節定位、條文深層連結、縮放、PDF 與列印。
驗證：桌面 1440px、手機 390px；錯誤／空結果／重試及鍵盤。規則見 docs/ADMINISTRATIVE_DESIGN.md。
限制：資料庫測試需本機 PostgreSQL *_test；公開 API 舊版尚無列表 issued_at 時顯示未載明。
