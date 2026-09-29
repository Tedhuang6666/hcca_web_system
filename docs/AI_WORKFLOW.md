# HCCA 維護操作與驗證

適用於本機同一工作樹的後續模型。規範在 [AGENTS.md](../AGENTS.md)，定位先用
[PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md)。命令預設從 repo 根目錄執行。

## 任務開始

1. `git status --short`，記住原有修改。需要修錯先記錄可重現輸入、預期／實際結果。
2. `bash scripts/check.sh doctor` 檢查工具。環境失敗先辨識原因，不把它當成業務 bug。
3. GitNexus query 找流程、context 找實作、impact 查影響；確認 `--repo .` 是目前工作樹。
4. 讀相近功能與測試，寫出本次驗收條件。一般工作由目前模型完成，不依賴升級模型或強制委派。

## 驗證矩陣

| 修改內容 | 至少執行 | 另需確認 |
| --- | --- | --- |
| 規範／工具／文件 | `bash scripts/check.sh docs`；本次工具實跑 | 新入口已 stage／追蹤、連結可用；設定在新 session 是否生效 |
| API／shared Python | `bash scripts/check.sh api`；`api-test` 指定相關測試 | 改動測試檔另跑 Ruff；失敗案例能捕捉原問題 |
| 權限／身份／資料範圍 | 上列 + 相關 RBAC／IDOR 測試 | 未登入、無權限、跨使用者／組織、有效期；不得只驗成功 |
| ORM／DB schema | 上列 + migration upgrade + `alembic check` | PostgreSQL 真實環境、回填／索引／鎖定風險、只有一個 head |
| API schema／回應 | 上列 + `bash scripts/check.sh contract` + Web type-check | 必填／nullable／enum、空列表、錯誤狀態；更新相容層 |
| Web 邏輯／UI | `bash scripts/check.sh web` | 受影響流程；手機、鍵盤、載入／空／失敗狀態；UI 改動做實際瀏覽器驗證 |
| Celery／queue | API 對應 task 測試 + `python3 scripts/validate-celery-topology.py` | 重試、重複執行、consumer、transaction 與通知發送時機 |
| Compose／部署設定 | `docker compose ... config --quiet`（對應檔） | 只驗設定不部署；秘密來源、port、healthcheck、rollback |
| 套件升級 | 該層完整檢查 + audit／release notes | lock 一致、版本相容性；勿用 `audit fix --force` 強制升主版 |

所有 commit 前都需要 `bash scripts/check.sh graph`、`git diff --check`、審查 stage 清單。
`graph` 會保留完整工具輸出，**exit 0 不代表 partial／truncated／UNKNOWN 已解決**。
CI 檢查另見 [.github/workflows/ci.yml](../.github/workflows/ci.yml)。

## 指令語意

- `check.sh api` 僅做靜態檢查，沒有 DB 測試。`check.sh web` 包含 Vitest coverage 與 production build。
- `check.sh api-test` 要求 `TEST_DATABASE_URL` 為 loopback PostgreSQL、DB 名以 `_test` 結尾且無 query。
  它會把應用 `DATABASE_URL` 同步為測試 DB，避免部分流程另開 session 時碰到開發資料。
  先確認 Redis 也是測試用途；腳本不會啟動、建立或清空服務。特殊 CI 網路使用已審閱的 CI 設定。
- `check.sh contract` 在暫存目錄生成型別，比較後退出；不覆寫你或其他工作正在改的契約產物。
- 腳本用 `uv --locked`，lock 與 manifest 不一致會停止，不會為了跑測試默默改 lock。
  僅在明確要更新依賴時才執行 `uv lock`；修業務程式不順手升級套件。
- 原有測試／格式問題與本次引入問題分開報告；不能因「以前就壞」而宣稱全庫綠燈。

## 新增或修改 API 契約

1. 先找 router、schema、service、目前消費者與相近測試；impact 分析被改符號。
2. 改 schema／service／router；有儲存結構變更才建立 migration。RBAC 入口仍在 router。
3. 重新生成契約（這一步會修改產物，先檢查這些檔案是否有其他工作）：

   ```bash
   bash scripts/update-openapi.sh
   npm run --prefix apps/web generate:types
   npm run --prefix apps/web generate:bridge
   ```

4. `api-types.ts` 和 `api-bridge.ts` 是生成檔。`types.ts` 有 re-export 與手寫相容型別，
   只同步必要匯出／欄位，保留前端刻意收窄的型別。別名來源在 `scripts/generate-bridge.mjs`。
   `scripts/rewrite-types-ts.py` 是舊重寫工具，含固定暫存輸入與格式假設，不作日常自動步驟。
5. API 呼叫改 `apps/web/src/lib/api/<domain>.ts`；`lib/api.ts` 是公開 re-export 入口。
6. 執行相關 API 測試、contract、Web type-check，檢查生成差異是否只反映本次契約。
   不需要啟動 API server 即可生成 OpenAPI。

## Schema／migration

以下指令必須指向明確選定的**本機開發或丟棄式測試資料庫**，不要直接複製到正式環境。

```bash
uv run --locked --directory apps/api alembic heads
uv run --locked --directory apps/api alembic revision --autogenerate -m "描述變更"
# 閱讀新 migration：正確預設值、nullable、索引、回填、升降級語意
uv run --locked --directory apps/api alembic upgrade head
uv run --locked --directory apps/api alembic check
```

CI 另在空 PostgreSQL 驗證整條 upgrade。`alembic check` 只涵蓋 autogenerate 能偵測的項目，
不能證明資料回填或自訂 SQL 正確。建立 migration 與實際套用要分別回報。
指令採 `--directory apps/api`，因 `--project` 不會改 cwd。

## 排錯決策

| 觀察 | 下一個可驗證動作 |
| --- | --- |
| 所有 API 測試都連線失敗 | 檢查 test DB／Redis 是否可達、URL 是否明確；不要先改 service |
| `UndefinedColumn`／多個 migration head | 檢查當前 revision 與新 migration；不要刪舊 migration 或重新 create_all 掩蓋 |
| 403 | 區分 CSRF、RBAC、物件範圍；使用既有 authenticated fixture |
| 型別缺失／生成產物 diff | 依契約流程重新生成，查 source schema；不要用 `any` 消除錯誤 |
| GitNexus 零結果或路徑錯置 | 驗 worktree、freshness、排除規則，必要時 force rebuild；再補文字查詢 |
| 同一錯誤兩種修法都無效 | 記錄證據，列不同層級假設，做最小實驗；只撤銷自己的失敗 hunk |
| 工具命令／flag 不存在 | 讀本機 `--help`／已安裝文件；不要沿用舊 memory 的旗標 |

## 依賴與插件更新

一般功能任務不需要順便更新所有工具。更新任務時先記錄版本，再查官方來源；一次處理一組相依套件。
現有 Redis 客戶端在 API 約束 `<6` 是專案相容性要求，不能為了追最新版本刪掉。
插件以實際 CLI 清單／可呼叫工具為準：資料夾存在、config `enabled=true`、已認證、當前 session 可用是不同狀態。
插件的技能更新不保證目前已載入 session 自動刷新，重啟後再驗。

## 留給下一個模型的紀錄

不要只寫「待繼續」。使用這個簡短格式，附到任務回覆或相關 issue／工作筆記：

```text
目標與驗收：
已修改：檔案與行為；commit（如有）
證據：實際命令 → exit code／通過數
未驗證：原因、需要的環境
剩餘：下一個最小步驟與具體路徑
工作樹：哪些檔案是其他來源變更，不能覆蓋
```

與完成標準相關的清單見 [HANDOFF_CHECKLIST.md](HANDOFF_CHECKLIST.md)。
