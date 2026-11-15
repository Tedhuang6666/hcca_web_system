---
version: 1
slug: "s-web-src-components-gallery-galleryexperience-tsx"
primary_target: "apps/web/src/components/gallery/GalleryExperience.tsx"
related_targets: ["apps/web/src/app/(public)/gallery/page.tsx","apps/web/src/app/(public)/gallery/[slug]/page.tsx","apps/web/src/components/gallery/gallery.css","apps/web/src/components/gallery/ActivityImage.tsx"]
---

# Gallery：獨立操作的活動照片牆

範圍：`/gallery` 與活動詳頁，模式 Experience。保留最上方中央主圖與兩側活動照的開場；中央優先使用該活動主視覺，缺少主視覺或載入失敗時回退活動實照。活動標題、簡介、日期與署名集中於開場下方，再接單一照片牆；移除攝影師選單、英文標語、「每一個片刻」及獨立「活動主視覺」區塊。環節超過一個才顯示環節篩選。

照片以暖白相框與底部短標題呈現，少量傾斜，依實際載入的圖片寬高貼合，不用固定高度或比例撐出底部留白。照片牆內同活動相同圖片來源只出現一次，包含非精選照片，不為填滿牆而複製；已作開場中央主圖的主視覺不再放入牆內。使用滑鼠或單指雙向拖曳、滾輪平移、Ctrl／雙指縮放；工具列提供縮放比例、放大、縮小與顯示全部照片。牆內操作不帶動整頁捲動，也不依賴整頁捲動探索照片。

方向鍵平移、加減鍵縮放、Home 顯示全部，鍵盤聚焦會將照片帶入可見範圍。單一活動網址、逐張分享、下載、全螢幕鍵盤切換與焦點返回維持可用；攝影與主視覺設計署名在全螢幕檢視保留。圖片失敗先重試原圖，再於原相框顯示緊湊狀態，不影響其他照片。
