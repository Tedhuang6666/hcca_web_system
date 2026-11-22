---
target: 全站 AI 感與設計品質檢測
total_score: 33
max_score: 40
na_heuristics: ""
p0_count: 0
p1_count: 0
timestamp: 2026-08-22T01-26-21Z
slug: apps-web-src-app
---
# HCCA 公開站修正後設計複檢

## Design Health Score

| # | Heuristic | Score | 變更後證據 |
|---|-----------|------:|-----------|
| 1 | Visibility of System Status | 3 | 公文頁明確區分載入失敗、查無條件與尚無公開資料，並提供下一步。 |
| 2 | Match System / Real World | 4 | 首頁與導覽從模組名稱改為學生可理解的任務：公告、資料、參與、聯絡。 |
| 3 | User Control and Freedom | 3 | 篩選無結果可一鍵清除所有查詢條件；仍有批次原生確認流程待日後改善。 |
| 4 | Consistency and Standards | 4 | Google 主登入與 Discord 已綁定登入的文字、視覺層級與條件一致。 |
| 5 | Error Prevention | 2 | 權限前置完整，但批次高風險操作仍依賴原生 prompt/confirm。 |
| 6 | Recognition Rather Than Recall | 4 | 四個任務入口置頂；完整服務可在桌機與手機用關鍵字搜尋。 |
| 7 | Flexibility and Efficiency | 3 | 已存篩選、批次、角色導覽與快速服務搜尋可共存。 |
| 8 | Aesthetic and Minimalist Design | 4 | 手機首屏以任務 CTA 為主，校徽轉為次要識別；移除無意義的 01–04 編號。 |
| 9 | Error Recovery | 3 | 公文服務不可用有重新載入與聯絡途徑；查無結果有清除條件。 |
| 10 | Help and Documentation | 3 | 導覽搜尋、具體 CTA 與空狀態下一步讓任務當下更可理解。 |
| **Total** | | **33/40** | **Good：已消除最主要的模板感與任務阻礙。** |

## 修正驗證

- 公開站頂列改為四條任務路徑，完整服務在桌機下拉與手機抽屜均可搜尋；手機服務群組預設折疊。
- 390×844 首屏中，「查看學生服務」CTA 位於校徽之前；文案使用平衡換行，沒有孤立單字。
- 公文快捷篩選、搜尋框與狀態 tab 在手機量測均為 44px 高；已存篩選刪除改為獨立可聚焦按鈕。
- Google 為唯一主要登入按鈕；Discord 以「已綁定」條件呈現為次要選項。
- 空狀態已區分 no records、no results、service unavailable，並分別提供公告、清除條件、重新載入／聯絡路徑。
- CMS 中的 `AAA` → `test` 測試連結已在公開首頁排除，未刪除任何後台資料。

## Remaining Follow-up

1. 批次核准、退件與封存仍使用原生 prompt/confirm；應改為包含受影響數量、結果摘要與復原途徑的應用程式內流程。
2. 全站 detector 的 9 項警示均為既有且不在本次改動範圍；其中狀態色條與選舉慶祝動畫需按其實際語意另行複核。
