# 深度盤點的隔離診斷

這些案例刻意斷言盤點當時的錯誤行為。`passed` 代表已重現，**不是漏洞已修復**。修復後應將相應案例改為正確的安全／業務預期，再納入正式回歸套件。

全部從專案根目錄執行。僅連線可丟棄的本機測試 PostgreSQL／Redis，不能使用正式資料庫。沿用 `apps/api/tests/conftest.py`，自動建立／清除專屬測試 schema；競態案例會在該 schema 真正提交合成資料。

## PostgreSQL 與 Redis

需先準備 PostgreSQL 16（建立一個可丟棄的空資料庫）及 Redis 7，帳號需能建立 schema。用自己的本機 DSN 取代以下範例。API 的一般設定仍依專案開發環境提供。

```bash
PYTHONPATH=apps/api/tests \
OTEL_ENABLED=false POSTHOG_API_KEY='' \
DATABASE_URL=postgresql+asyncpg://audit@127.0.0.1:55439/hcca_audit \
TEST_DATABASE_URL=postgresql+asyncpg://audit@127.0.0.1:55439/hcca_audit \
REDIS_URL=redis://127.0.0.1:56439/5 \
REDIS_CACHE_URL=redis://127.0.0.1:56439/6 \
uv run --project apps/api pytest -p conftest \
  docs/audits/2026-09-21/repro/test_deep_audit.py \
  -q -s --tb=short --asyncio-mode=auto --log-level=CRITICAL
```

盤點時 14 個案例通過。部分案例同時覆蓋多個發現；另有重複品項被約束拒絕的排除案例。已知 1 個 warning 來自取消平台訂單時嘗試讀取 null 舊排程主鍵，不是資料庫 mock。

- 資料庫、約束與交易均真實執行。
- HTTP 授權測試使用現有的 `authed_client_factory`，身分為 fixture 注入，仍會執行真實 router、service、權限查詢與 DTO 序列化。
- 匿名稽核測試關閉 PostHog；Redis 撤銷案例刻意模擬鍵不存在；WS 的 session factory 改連同一測試資料庫。這些替換不修改 DB 查詢結果。
- 競態案例覆寫 session.scalar 的排程：先執行真實 SELECT，再用障壁讓兩個請求同時進入插入區段；沒有預製查詢回傳值。
- 匯出測試建立 2,500 回應×8 題，以 10ms 心跳量測 event-loop 延遲；數字受機器負載影響，不適合當固定毫秒門檻。

## 前端、私有公文 SSR 與 HTTP 本文逾時

需先安裝 `apps/web` 的開發依賴；使用已安裝的 TypeScript、React、Testing Library、JSDOM 及 Next 模組。

```bash
node docs/audits/2026-09-21/repro/frontend-probes.cjs
```

程式直接讀取並轉譯目前產品程式，不複製 hook 或 transport 的實作。預期約 16 秒：

1. 實際草稿 hook 保存 A 的內容，執行實際 auth-cache／api-cache 清理後，B 掛載同 key，仍收到 A 草稿。
2. 私有文件的匿名預載結果設為 404，實際 page 元件執行 Next 真實 notFound；這是 SSR 邊界測試，並未冒充完整 OAuth 登入瀏覽。後端另一個 DB 案例確認私有文件對匿名 404、對擁有人可讀。
3. 本機 loopback HTTP server 立即傳回標頭與不完整 JSON；實際 serverFetch／transport 在 16 秒後仍未完成本文讀取。Next 共用快取 wrapper 改為直通，URL 改為本機；網路 fetch 與 AbortController 都是真實實作。

程式結束會關閉自己建立的 HTTP socket。若某項缺陷不再重現會失敗，應先對照修復內容，不要為了讓診斷通過而恢復舊行為。
