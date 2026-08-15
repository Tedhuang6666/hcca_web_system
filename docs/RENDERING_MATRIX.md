# 頁面渲染矩陣

此矩陣是 `apps/web/src/app/` 全部頁面的渲染規則來源；新增頁面時必須先歸入其中一類。

| 路由範圍 | 首屏渲染 | 資料快取 | Client 職責 |
| --- | --- | --- | --- |
| `(public)` 的內容、列表、法規、文件、公告、新聞與靜態頁 | Static/ISR | 60 秒；法定靜態頁於建置時產出 | 篩選、地圖、問卷填答、延後載入的閱讀工具 |
| `/public/elections`、`/live/elections/*` | ISR 或動態 SSR | 選舉列表 15 秒；直播畫面不共享快取 | 即時票數、畫面更新 |
| `/meetings/join/*`、`/meetings/screen/*`、`/petitions/*/*`、`/profile/complete` | 動態 SSR shell | `no-store` | token 驗證、報到、即時操作與表單 |
| `(protected)` 的 dashboard、列表、搜尋、詳情、報表 | 動態 SSR | 私有 `no-store` | 篩選、排序、寫入、WebSocket 更新 |
| `(protected)` 的 `new`、`edit`、cart、vote、control、seating、QR 與地圖工具 | 動態 SSR shell | 私有 `no-store` | 編輯器、掃碼、裝置 API、即時工作流 |
| `(admin)` 全部頁面 | 動態 SSR workbench | 私有 `no-store` | 資料表、批次操作、盤點、借還與表單 |
| `/login`、`/auth/*`、`/unsubscribe`、`/blocked`、`/maintenance`、`/module-status` | Client workflow shell | `no-store` | OAuth/MFA、登出與狀態輪詢 |

## 不可違反的規則

- 公開資料僅能使用 `publicServerData()` 或 `serverFetch.ts` 的 60 秒 ISR helper；不得轉送訪客 cookie。
- 受保護與管理資料僅能以 `privateServerData` 載入，並轉送 HTTP-only session cookie；不得進入共享 Data Cache。
- Client 元件接收 SSR 的 `initialData` 時，不得在 mount 重複呼叫相同 GET；只在篩選變更、突變、WebSocket 或過期後重新抓取。
- 模擬登入 flag 存在時，server 不得輸出原管理員資料，必須回退至既有 client impersonation flow。
