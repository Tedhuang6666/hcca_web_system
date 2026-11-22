---
version: 1
slug: "s-web-src-components-gallery-galleryexperience-tsx"
primary_target: "apps/web/src/components/gallery/GalleryExperience.tsx"
related_targets: ["apps/web/src/app/(public)/gallery/page.tsx","apps/web/src/app/(public)/gallery/[slug]/page.tsx","apps/web/src/components/gallery/gallery.css","apps/web/src/components/gallery/ActivityImage.tsx"]
---

# Gallery：開場、精選與無邊照片牆

範圍：`/gallery` 與活動詳頁，模式 Experience。依使用者要求恢復原有開場構圖、進場動態及不對稱精選照片區；中央優先使用活動主視覺，缺少或失敗才退回活動照。「每一個片刻」、獨立「活動主視覺」區塊、攝影師選單與先前移除的贅述維持刪除。

照片保留暖白相框，按實際載入寬高貼合；左下短標題，右下顯示攝影師／繪師。逐張署名優先於活動預設，主視覺不繼承活動攝影師；未知作者省略。精選沿用原有 spread、journal、film 排版與捲動動態，手機維持六欄尺度變化；減少動態偏好時停用動態。

無邊照片牆回復第一版的 25 個固定回收節點，保留錯落構圖、差速緩動、滑鼠視差、拖曳慣性與原有牆面進場效果，只有一、三張照片也不留下單排或大面積空白；主視覺與非精選照片仍可在牆上探索。真實照片數不因平鋪增加，離屏或分頁隱藏時暫停動畫。縮放保持原始 100% 到 300%，避免縮小後固定節點不足而露出空白。保留雙向拖曳、牆內滾輪平移、雙指與 Ctrl 縮放及重設視角；牆內操作不帶動整頁捲動。相同可見照片只有一個 Tab 停靠點，全螢幕保持分享、下載、鍵盤切換及焦點返回。
