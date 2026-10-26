# 校慶服飾圖集與圖片託管

商品目錄辨識校慶服飾後顯示實拍圖集。直式照片使用 3:4、橫式照片使用 6:4，
放大檢視與原版 DM 保留完整構圖。商品對照在 `apps/web/src/lib/shop-lookbook.ts`，
照片與裁切位置在 `shop-lookbook-data.json`；價格、庫存與訂購限制沿用 API。

## 圖片準備

原始攝影檔在本機 `校商圖片/`。使用者指定圖片不入 Git；原圖、網頁 WebP 與圖片包
皆由 `.gitignore` 排除。程式、照片清單、產生工具與測試維持版本控制。

```bash
node apps/web/scripts/prepare-shop-lookbook.mjs
python3 scripts/package-shop-lookbook.py
```

第一步產生 `apps/web/public/shop/104/` 的本機預覽檔，保留原始照片。
第二步驗證每一張 WebP 並產生 `output/shop-lookbook-104/shop-lookbook-104.zip`，
包含 27 張照片各三個尺寸及三張 DM，共 84 個檔案；旁邊的 `sha256sum.txt` 可核對內容。
不需將攝影大檔上傳到網站。

## 圖床上傳與建置

1. 將圖片包解壓後的 84 個檔案上傳至同一個可公開讀取的 HTTPS 目錄，保留檔名。
   例如使用專案既有圖片網域的 `/images/shop/104/` 目錄。圖片伺服器需回傳
   `Content-Type: image/webp`，可設定長時間公開快取。
2. 在 Web **建置環境**設定 `NEXT_PUBLIC_SHOP_LOOKBOOK_BASE_URL` 為該目錄網址，
   例如 `https://hcca.buckets.hct.works/images/shop/104`，再執行既有 Web build。
   `NEXT_PUBLIC_` 變數會編入前端程式，僅修改啟動環境不會更新既有建置。
   Compose 的 Web build args 已接入此設定；GitHub Docker workflow 使用同名 repository variable。
3. 實際確認該目錄的 `hoodie-01-480.webp`、`hoodie-01-2400.webp` 及
   `hoodie-dm.webp` 可公開載入，再檢查 `/shop` 的款式切換、放大與原版 DM。
   若改用其他圖片網域，亦需確認部署環境 CSP 的 `img-src` 允許該網域。

留空時使用 `/shop/104/`，供已有本機預覽檔的工作樹使用；乾淨 checkout 不含圖片，
正式環境需先完成圖床上傳與網址設定。建置與單元測試不要求攝影檔存在於 repository。
本文件不代表已上傳圖片、更新正式設定或部署。
