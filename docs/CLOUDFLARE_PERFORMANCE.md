# Cloudflare 效能設定 Runbook

此專案已在 origin 端完成圖片與靜態資源的長效快取；Cloudflare 控制台仍需由具備 Zone 權限的管理者套用以下設定。先套用於 staging，再以 Lighthouse、Chrome DevTools 與登入／互動流程驗證。

## 1. Polish

在 Cloudflare Dashboard 選擇 staging zone：

1. `Speed` → `Settings` → `Image Optimization`
2. `Polish` 選 `Lossy`
3. 開啟 `WebP`
4. 儲存後 purge staging cache

Next Image 的 `/_next/image` 已經是依尺寸與格式產生的變體，Polish 不會再重複處理這類 transformation URL；Polish 主要涵蓋公開 `/uploads/...` 與其他未經 Next Image 的原始圖片。正式環境確認畫質與回應 `Content-Type` 後再套用。

## 2. Cache Rules

建立兩條規則，順序置於任何通用 Cache Everything 規則之前：

### Next.js 靜態與圖片變體

Expression：

```text
(http.host in {"staging.hcca.tw" "www.staging.hcca.tw"}) and
(starts_with(http.request.uri.path, "/_next/static/") or
 starts_with(http.request.uri.path, "/_next/image"))
```

設定：

- Cache eligibility：`Eligible for cache`
- Edge TTL：`Respect origin`（origin 已分別設定 365 天與 30 天）
- Browser TTL：`Respect origin`

### 公開圖片

Expression：

```text
(http.host in {"staging.hcca.tw" "www.staging.hcca.tw"}) and
(starts_with(http.request.uri.path, "/uploads/announcements/") or
 starts_with(http.request.uri.path, "/uploads/merchandise-submissions/templates/") or
 starts_with(http.request.uri.path, "/uploads/surveys/") or
 starts_with(http.request.uri.path, "/uploads/public-site/") or
 starts_with(http.request.uri.path, "/uploads/recommended-vendors/"))
```

設定：

- Cache eligibility：`Eligible for cache`
- Edge TTL：`Use cache-control header if present`
- Browser TTL：`Respect origin`

不要將 `/api/`、登入、管理後台、WebSocket 或任何帶使用者／權限狀態的 HTML 加入快取規則。若圖片內容以相同 URL 覆蓋，請在更新後 purge 對應 URL；目前上傳檔案通常使用唯一 storage key，因此可安全使用較長 TTL。

## 3. 第三方 JavaScript

- 專案內 PostHog 已在瀏覽器 idle 時動態載入。
- Google One Tap 已改為 `lazyOnload`，不再參與首屏互動。
- Rocket Loader 先只對 staging 開啟；驗證 OAuth、表單送出、TipTap 編輯器、Leaflet 地圖、WebSocket、QR Code 與 service worker 後再評估正式環境。
- Zaraz 若接管分析或行銷工具，先移除頁面上重複的同類第三方 script。Zaraz 與 Rocket Loader 不建議同時啟用；二者擇一測試。

若 Rocket Loader 造成互動回歸，優先停用它，不要以延長 timeout 掩蓋問題。

## 4. 驗證與回復

```bash
curl -sSI https://staging.hcca.tw/_next/static/<hashed-file>.js
curl -sSI 'https://staging.hcca.tw/_next/image?url=%2Fbrand%2Fhcca-emblem-512.png&w=640&q=75'
curl -sSI https://staging.hcca.tw/uploads/public-site/<file>
```

預期看到：

- `/_next/static/*`：`public, max-age=31536000, immutable`
- `/_next/image*`：瀏覽器 1 天、edge 30 天，並含 `stale-while-revalidate`
- 公開 uploads：瀏覽器 7 天、edge 30 天，並含 `stale-while-revalidate`
- Cloudflare 回應標頭 `CF-Cache-Status: HIT`（第二次請求起）

若出現圖片格式錯誤、登入流程失效或編輯器無法操作：先在 staging 關閉 Rocket Loader／Zaraz，再 purge cache；Polish 則改回 `Lossless` 或關閉 WebP。
