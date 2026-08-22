---
target: 全站 AI 感與設計品質檢測
total_score: 26
max_score: 40
na_heuristics: ""
p0_count: 0
p1_count: 3
timestamp: 2026-08-22T01-00-20Z
slug: apps-web-src-app
---
# HCCA 全站介面設計檢測

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|------:|-----------|
| 1 | Visibility of System Status | 2 | 公開資料空狀態與服務不可用缺乏清楚區分，公開導覽沒有目前位置。 |
| 2 | Match System / Real World | 3 | 校園自治用語大致自然，但部分入口仍以系統模組命名。 |
| 3 | User Control and Freedom | 3 | 返回、關閉、清除篩選與登入後返回目標完整，復原能力仍弱。 |
| 4 | Consistency and Standards | 3 | Token、外殼、焦點與按鈕一致；登入頁的視覺權重與說明相反。 |
| 5 | Error Prevention | 2 | 有權限與登入前置提示，但批次高風險動作仍依賴原生 prompt/confirm。 |
| 6 | Recognition Rather Than Recall | 3 | 多數圖示有文字；一次展開 16 個目的地造成掃描負擔。 |
| 7 | Flexibility and Efficiency | 3 | Ctrl-K、批次、已存篩選、角色導覽等效率工具完整。 |
| 8 | Aesthetic and Minimalist Design | 3 | 視覺克制，但手機 hero、空狀態容器與裝飾性編號浪費注意力。 |
| 9 | Error Recovery | 2 | 有 alert/toast，但公開頁錯誤與空狀態缺少原因、重試與下一步。 |
| 10 | Help and Documentation | 2 | 有聯絡、無障礙與關於頁，任務當下的提示仍不足。 |
| **Total** | | **26/40** | **Acceptable：基礎穩固，但需要聚焦改善。** |

## Design Specificity Verdict

**部分具有作者性，但還沒有強到只能屬於 HCCA。** 校徽、深藍金色、正式而清楚的中文文案，已建立可信的校園治理基調；公開樣式也刻意移除了常見 SaaS 發光、漂浮與過度卡片化效果。

仍有可互換的模板語法：暖米色、系統無襯線字、左右切半 OAuth 登入、細線分隔、`01–04` 圖示入口與「查看平台連結」等抽象 CTA。首頁換掉校徽與文案後，仍可能屬於任何學校或非營利組織。

Deterministic detector 共回報 8 筆：7 warnings、1 advisory，全部標為 slop。逐筆複核後，三筆是 blockquote/checkmark 的明確誤判，一筆是未使用的 `.gold-line`，兩筆左側色條其實編碼逾期／風險狀態；彈性 easing 僅用於選舉勝出慶祝，點陣背景則被錯描述為格線。因此自動掃描不支持「全站大量 AI 裝飾」的結論；真正問題由實際畫面的 IA、首屏層級與狀態完成度構成。

Live overlay 未能顯示：頁面 CSP 阻擋從 `localhost:8400` 載入 `detect.js`。替代證據包括成功的 CLI 掃描、8 組 headless Playwright 畫面、DOM／尺寸／鍵盤量測與確切 CSP console 訊息。

## Overall Impression

網站比一般 AI 生成介面更克制、正式、可讀，校徽也是有效的識別高點。最大機會不是增加更多裝飾，而是把「組織模組入口」重整成「學生現在想完成的事」，並讓手機第一屏立刻提供有意義的下一步。

## What's Working

1. 公開樣式主動取消發光、漂浮與裝飾性面板，治理語氣可信而安靜。
2. Skip link、語意標題、文字標籤、清楚 focus outline、reduced-motion 與 ARIA 基礎良好。
3. 受保護 Dashboard 的原始碼已採任務優先：優先處理與快速動作限制為三項，完整服務再逐步揭露。

## Cognitive Load

8 項檢查失敗 4 項：single focus、chunking、minimal choices、progressive disclosure。公開導覽一次露出 16 個目的地；受保護手機底部導覽最多 6 項；公文展開篩選同時包含 9 個類別、6 個密等、5 個可見範圍。

## Priority Issues

### [P1] 公開資訊架構仍像模組目錄

- **Why it matters**：學生必須先理解「公開資料庫」「特約洽談」「關於本系統」等組織分類，才能表達意圖。
- **Fix**：導覽先收斂成「找公開資料」「參與校園事務」「聯絡班聯會」等 3–4 條任務路徑並提供搜尋；完整目錄降為次要入口。
- **Suggested command**：`$impeccable distill`

### [P1] 手機首頁第一屏把識別放在任務之前

- **Why it matters**：390×844 下 CTA 約到 y=617 才出現，「快速進入」落在首屏以下，使用者先看完 18rem 校徽才找到任務。
- **Fix**：縮短手機 hero，第一屏直接放一個最高頻任務或小型任務列；把「查看平台連結」改為具體行為。
- **Suggested command**：`$impeccable adapt`

### [P1] 多個手機操作目標未達 44px，另有不可鍵盤操作的刪除控制

- **Why it matters**：登入返回 40px、公文 quick-filter/tab 30px、搜尋框 42px、法律連結 14px；已存篩選刪除用 button 內的 onClick span，無法獨立聚焦。
- **Fix**：所有 actionable targets 提升至至少 44×44；刪除改成真正且有標籤的 sibling button。
- **Suggested command**：`$impeccable audit`

### [P2] 登入視覺層級指向錯誤提供者

- **Why it matters**：文案說學校 Google 是預期路徑，Discord 卻是唯一高飽和、發光的主視覺按鈕。
- **Fix**：Google 成為明確 primary；Discord 降為 secondary，綁定前置條件直接附在按鈕旁。
- **Suggested command**：`$impeccable clarify`

### [P2] 公開資料空狀態無法維持治理信任

- **Why it matters**：「尚無公文記錄」不能說明是真的沒有資料、尚未公開、篩選無結果，還是 API 不可用。
- **Fix**：拆分 no records、no results、service unavailable，分別提供清除篩選、重試、最後更新或聯絡方式。
- **Suggested command**：`$impeccable harden`

## Persona Red Flags

- **Alex（熟練使用者）**：Ctrl-K、批次與已存篩選很好，但高風險批次動作落入原生 prompt/confirm，缺乏結構化預覽與 undo。
- **Sam（依賴無障礙）**：focus 與 skip link 良好；小於 44px 目標、不可聚焦的巢狀刪除、缺少 `aria-current` 仍會破壞流程。
- **Casey（分心的手機使用者）**：首個有效任務出現太晚，展開選單有 16 個目的地，公文控制只有 30–42px。
- **怡君（學生自治公文承辦）**：Dashboard 三項優先佇列符合課間處理情境，但批次核准／退回缺少受影響公文、風險摘要與復原路徑。

## Minor Observations

- `01–04` 對四個平行入口沒有序列意義。
- 公開導覽沒有可見與語意的目前頁面狀態。
- 系統字體可讀，但未形成校園治理專屬的字體性格。
- 首頁出現內容管理殘留的 `AAA`／`href="test"`，會直接削弱正式感。
- 公開頁在本次無後端環境收到 analytics 403 與 announcements WebSocket 403；沒有 JavaScript pageerror 或水平溢出。

## Questions to Consider

1. 首頁的 thesis 應該是「平台有哪些連結」，還是「你今天要完成哪一件校園事務」？
2. 如果 16 個公開目的地都需要保留，是否仍有必要讓學生先解碼組織模組，才能找到任務？
3. 空白公文頁最需要證明的是沒有資料、尚未公開，還是目前無法取得？
4. Google 是預期登入路徑時，Discord 為何擁有最強視覺權重？
