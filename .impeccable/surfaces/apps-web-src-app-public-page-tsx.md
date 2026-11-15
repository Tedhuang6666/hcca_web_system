---
version: 1
slug: "apps-web-src-app-public-page-tsx"
primary_target: "apps/web/src/app/(public)/page.tsx"
related_targets: ["apps/web/src/app/(public)/HomeHero.tsx","apps/web/src/app/(public)/HomeHeroScene.tsx","apps/web/src/app/(public)/HomeContent.tsx","apps/web/src/app/(public)/public-home.css"]
---

# 首頁：正在發生的校園生活

範圍：公開首頁，模式 Read。手機使用者應先辨識班聯會、看到最新活動實照，再找到公告與常用服務。

首屏左側為兩行品牌主標與一句介紹，右側為小幅橫向活動照，不在圖上疊 Logo、文案或按鈕。桌機照片以 4° 傾斜起始，與捲動進度連動轉正、展開；標題隨進度退場，往上捲可還原。日期與活動名在圖下連到單一活動；「最新消息」可直接跳至公告。手機依序呈現文字與靠右縮幅照片，減少動態偏好及較矮視窗使用靜態版型。沒有照片、圖片失敗或動畫無法初始化時仍可閱讀，不留下動畫的長空白。公告與服務在桌面並排、手機依序閱讀，文章和商品排在後方。

素材來自正式活動設定，維持編輯順序與真實日期。無資料不虛構活動；圖片失敗先重試原圖及同活動其他實照，最終以緊湊文字取代。導覽與頁尾沿用全站品牌。
