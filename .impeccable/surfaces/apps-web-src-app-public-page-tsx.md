---
version: 1
slug: "apps-web-src-app-public-page-tsx"
primary_target: "apps/web/src/app/(public)/page.tsx"
related_targets: ["apps/web/src/app/(public)/HomeHero.tsx","apps/web/src/app/(public)/HomeHeroScene.tsx","apps/web/src/app/(public)/HomeContent.tsx","apps/web/src/app/(public)/public-home.css"]
---

# 首頁：正在發生的校園生活

範圍：公開首頁，模式 Read。手機使用者應先辨識班聯會、看見真實校園活動，再找到公告與常用服務；不以未經日期排序的相簿宣稱「最新活動」。

開場採六欄網格，以小型 HCCA 識別建立入口。左側預設為「新竹高中／班聯會」兩行主標，右側在手機完整呈現「學生自治／校園活動／公開資訊」三行主題詞，桌機連成一行；後台自訂標題、副標沿用正式內容。直角活動實照接在文字下方，真實活動日期、標題及「活動紀錄／攝影集」入口集中疊於照片下緣的深色漸層，整張影像連入該活動。無日期時省略，不保留已移除的 Latest story 標籤。

手機與桌機皆以自然捲動展開照片：由右下偏移 40px／28px、4° 傾斜回正，再由左右內縮展開至視窗全寬；日期、標題與入口錯開從 opacity 0.8 變為 1。往上捲可還原，不使用 sticky 或額外長捲動區段。視窗高度至少 540px 且 prefers-reduced-motion 為 no-preference 時才延遲載入 GSAP。減少動態偏好與較矮視窗保留完整靜態構圖；沒有活動或所有照片失敗時採緊湊版型，不留下動態空白。

素材來自正式活動設定，活動沿用相簿來源順序；內建迎新相簿優先選 team-games.webp，已設定相簿維持精選優先及照片原有相對順序。圖片失敗先重試原圖及同活動其他實照，最終顯示緊湊狀態；無資料不虛構活動、日期或最新狀態。

「最新消息」箭頭入口可用鍵盤跳至單一可見的公告標題。活動影像的鍵盤焦點以白框及完整清晰的資訊表達。公告、常用服務、文章、商品、共用導覽與頁尾沿用既有行為與結構。

驗證紀錄：手機 320px、390px 與桌機 1440px 無水平溢位；鍵盤錨點未被導覽列遮住，影像焦點白框及資訊 opacity 1；圖片全失敗時回到靜態緊湊版型。獨立設計審查確認移除 Latest story 後唯一修正已解決，此次三檔視覺範圍為 ship；修正後頂部完整頁截圖為 `.impeccable/review/home-mobile-full.png` 與 `home-desktop-full.png`。靜態截圖不能證明動畫流暢。整頁無 JavaScript 驗證未通過：獨立無 JavaScript context 仍被既有 Next 串流的 hidden 祖先隱藏，不能宣稱全站支援無 JavaScript。型別、測試與建置結果由主流程記錄。
