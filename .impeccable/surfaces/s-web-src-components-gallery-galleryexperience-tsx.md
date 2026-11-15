---
version: 1
slug: "s-web-src-components-gallery-galleryexperience-tsx"
primary_target: "apps/web/src/components/gallery/GalleryExperience.tsx"
related_targets: ["apps/web/src/app/(public)/gallery/page.tsx","apps/web/src/app/(public)/gallery/[slug]/page.tsx","apps/web/src/components/gallery/gallery.css","apps/web/src/components/gallery/ActivityImage.tsx"]
---

# Gallery：照片先行的活動紀錄

範圍：Gallery 選輯與活動詳頁，模式 Experience。先看見真實學生互動，再讀取集中編排的活動資料與攝影署名。

依使用者指定方向：詳頁開場照片直接接導覽，選輯首頁保留小型識別。主照全寬、次照雙欄，手機依序單欄；直角、平直照片，無旋轉、透視或視差。正式海報完整比例放於活動內容，只有海報時才作開場。照片總覽為平直網格，保留分頁與全螢幕操作。

單一活動保有網址與逐張分享、下載、鍵盤切換及焦點返回。圖片失敗重試原圖，開場再換同活動實照，完全失敗顯示緊湊狀態。完整照片入口只在編輯選輯有未展示照片時出現。
