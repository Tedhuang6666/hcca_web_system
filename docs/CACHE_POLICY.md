# Redis 快取規範

**生效日期**：2026-06-11

## Key

格式統一為 `<domain>:<resource>:<scope>:v<schema-version>`，只放穩定識別值，不放 Email、
姓名或 Token。例：`permission:user:<uuid>:v1`、`document:list:<filter-hash>:v1`。

- key schema 或序列化格式改變時遞增版本，避免新舊程式互讀。
- 多租戶資料必須包含組織或使用者 scope。
- 禁止使用 `KEYS`；批次失效使用 `SCAN`，每批最多 100 筆。

## TTL

| 類型 | 建議 TTL | 失效方式 |
|---|---:|---|
| 權限、組織樹 | 180 秒 | 權限或任期異動後立即刪除 |
| 公開列表 | 60 秒 | 建立、更新、封存後刪除對應 namespace |
| 系統設定、Feature Flag | 5–30 秒 | 寫入後刪除本機與 Redis cache |
| 防重與 Idempotency | 24 小時 | 到期自動清除，不允許主動延長 |

TTL 必須有上限且不得設為永久。高流量 key 可加入最多 10% 隨機 jitter，避免同時過期。

## Stampede

昂貴查詢採 single-flight：

1. cache miss 後以 `<key>:lock` 執行 Redis `SET NX EX`。
2. 取得 lock 的請求重建快取；其他請求短暫等待後再讀一次。
3. lock TTL 必須短於業務 timeout，finally 以 token 比對後釋放。
4. Redis 失效時直接查來源資料，不可讓快取故障中斷核心流程。

## 審查清單

- key 是否含正確的 tenant/user scope 與版本？
- 寫入路徑是否同步失效所有受影響 key？
- TTL、資料敏感度、最大 payload 是否已定義？
- 是否有 cache hit/miss、重建耗時與 fallback log/metric？
- 是否以併發測試驗證 single-flight，並測試 Redis 不可用時的退化行為？
