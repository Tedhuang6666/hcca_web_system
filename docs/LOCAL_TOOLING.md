# 同一主機的工具與接手紀錄

核對日：2026-09-30。這是本機快照，不是永久版本承諾。工作位置是
WSL `/home/ted98/projects/main`；後續工作留在這台主機。

## 本次已落實

- 根 `AGENTS.md` 為共同規範，`CLAUDE.md` 引用它；API／Web 有局部規範。
- 修正舊目錄地圖、Alembic cwd、OpenAPI 生成說明，以及升級模型／全面回退的舊指引。
- [AI_WORKFLOW.md](AI_WORKFLOW.md) 與 `scripts/check.sh` 提供固定維護與驗證入口。
- [.agents/skills/hcca-maintenance/SKILL.md](../.agents/skills/hcca-maintenance/SKILL.md) 可按需載入；
  本機 `.claude/skills/hcca-maintenance` 連至同一份技能，避免維護兩份。
- Codex 專案設定加入 GitNexus 與 Context7 MCP；Claude `.mcp.json` 同步加入 GitNexus，
  並固定 Context7／Playwright MCP 套件版本。
- Claude 的 guard hook 原本指向 WSL UNC 路徑，已改為此 WSL 實際 Linux 路徑；保留既有攔截規則。
- CI 使用 `uv --locked`，schema drift 改為 `alembic check`，維護入口／連結／腳本回歸納入 CI。
- GitNexus 排除瀏覽器 profiles、生成型別與快取，完整重建索引，修正錯置符號。

## 工具快照與實際狀態

| 工具 | 核對結果 |
| --- | --- |
| Node／npm | 24.19.0／11.17.0；Web engines 最低 22.13.0，CI 由 `.nvmrc` 指定 |
| Python／uv | 3.12.3／0.12.5；`uv lock --check --offline` 通過 |
| Codex CLI | 0.155.0-alpha.16.3；`codex doctor` 19 OK、1 idle、0 warning／failure |
| Claude Code | 2.1.233；Python／TypeScript language server 均可由 PATH 找到 |
| GitNexus | 1.6.12；npm registry 查詢為同版本；MCP initialize、17 tools、list_repos 實測成功 |
| Context7 MCP | 固定 `@upstash/context7-mcp@4.1.1`；initialize 與 2 tools 實測成功 |
| Playwright MCP | 固定 `@playwright/mcp@0.0.83`；initialize 與 25 tools 成功；尚未驗瀏覽器安裝／頁面流程 |
| Docker／PostgreSQL／Redis | 此 WSL 的 Docker 命令目前回報未啟用整合；localhost 5432／6379 沒有 listener |

版本固定的是 MCP 套件；serverInfo 回報的內部 Playwright 版本可能不同，不要據此誤判套件未生效。
本次沒有改個人預設模型、權限、服務等級或外部帳戶授權。後續可在客戶端選實際可用的模型，
專案流程不依賴特定模型名稱。

## 插件更新

已透過 Claude 的正式 CLI 更新 `claude-plugins-official` marketplace，逐一核對此專案的既有插件：

| 插件 | 結果 |
| --- | --- |
| security-guidance | 2.0.7 → 2.0.8，更新成功 |
| code-review | 來源刷新成功；上游未提供版本號，不能虛構版本 |
| claude-md-management | 1.0.0，CLI 回報已最新 |
| pyright-lsp | 1.0.0，CLI 回報已最新 |
| typescript-lsp | 1.0.0，CLI 回報已最新 |

需重新開始 Claude session 才會載入更新。可用：

```bash
claude plugin list --json
claude plugin marketplace update claude-plugins-official
claude plugin update security-guidance@claude-plugins-official --scope project
```

Codex `plugin list --json` 已核對：GitHub、Google Drive、Gmail、Canva 等遠端插件列為已安裝／啟用。
`plugin marketplace upgrade --json` 沒有可更新的本機 Git marketplace；這不等同遠端插件已全部升版。
本次未移除或重新安裝遠端插件，也未改連線權限；不能以 user config 中舊 `@openai-curated` 名稱
推論某遠端插件已安裝。需要使用時，以當次清單、認證與可呼叫工具為準。

## GitNexus 修復與日常維護

原索引含 `C:/Users/.../lighthouse...` 的瀏覽器資料，出現 UID 與來源檔錯置。
新增 `.gitnexusignore` 與 Git ignore，執行下列完整重建後，具名符號查詢已回到正確來源檔：

```bash
node .gitnexus/run.cjs analyze --index-only --force --no-parse-cache
```

後續一次增量更新再次導致測試變數 `spec` 被錯連到 262 條流程，回報 CRITICAL。
重新完整解析後該變數回到正確檔案；同份變更分析回到 low／0 受影響流程。
這是本機可重現的索引完整性問題，不能只忽略警告。**暫時每次更新使用**：

```bash
bash scripts/refresh-code-index.sh
```

此腳本固定 `--index-only --force --no-parse-cache`，不依賴增量路徑。
Codex／Claude 本機的 12 份 GitNexus skill 已加專案覆寫提示，避免沿用上游的裸 analyze 範例。
待上游更新並經相同查詢驗證後再移除此 workaround；`--index-only` 保護手寫規範與技能。
本機仍有另一個同名 repository，請 CLI 一律 `--repo .`；MCP 指定實際路徑，不刪另一個工作樹。
完整索引也有動態派發／跨語言與流程採樣限制；警告、UNKNOWN 或未找到流程不代表沒有影響。
提交後索引 commit 會落後，做完提交後用上述腳本更新一次，下一次任務先 `status` 驗證。

## 目前環境限制與下一步

- PostgreSQL pytest、空 DB migration upgrade、`alembic check` 需要本機測試服務，目前未實跑。
  先修復 Docker Desktop 的此 WSL 整合或使用已核准的本機測試服務，再設 `TEST_DATABASE_URL`。
  不連正式 DB 取代測試、不因環境缺件修改業務行為。
- 本次工作期間另有工作持續提交應用程式，測試證據只代表執行時的工作樹；保留其他來源修改。
- `uv.lock` 是本次任務開始前即存在的修改，本次不提交。
- Codex 原有 `.codex/hooks.json` 保留；其 hook trust／是否在目前 client 執行未另宣稱驗證。
  MCP 已做協定測試；新設定由下一個 session 載入，不代表正在進行的工具清單即時改變。

## 本次驗證紀錄

- 文件／入口／設定檢查通過；腳本回歸含斷連結、誤用 DB 目標與匯出失敗保留原契約。
- 後端 Ruff lint／format、mypy 的 10 個 gate 模組、Celery consumer 拓撲通過。
- Web type-check、22 個 module registry、29 檔／108 個 Vitest 測試、coverage 與 production build 通過。
  coverage 只量測 `vitest.config.ts` 所選的 4 個檔案，不能聲稱整個前端有 98.3% 覆蓋率。
- ESLint exit 0，但保留 7 個既有 warning，並非零警告。
- OpenAPI 生成與既有型別比對通過；本機匯出會關閉 Sentry／PostHog／OTel，避免收集驗證活動。
- Claude guard 的安全指令／模擬 force push 輸入測試符合預期；未真正執行 push。
- PostgreSQL 整合測試、migration 與 compose runtime：受上述環境限制，未驗證。

## 查驗與來源

```bash
bash scripts/check.sh doctor
codex doctor --summary --ascii
codex mcp list
codex plugin list --json
claude plugin list --json
```

Codex 設定採官方 [設定參考](https://learn.chatgpt.com/docs/config-file/config-reference) 與
[AGENTS 載入規則](https://learn.chatgpt.com/docs/agent-configuration/agents-md)；
插件狀態以本機 CLI 結果為準。Schema drift 使用
[Alembic check](https://alembic.sqlalchemy.org/en/latest/autogenerate.html#running-alembic-check-to-test-for-new-upgrade-operations)，
保留官方列出的 autogenerate 偵測限制。
