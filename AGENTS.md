# HCCA 維護規範

本專案在同一台主機的 WSL `/home/ted98/projects/main` 維護。回覆使用繁體中文。
先讀 [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)，再讀修改目錄下的 `AGENTS.md`。
本檔是跨模型共同規範；`CLAUDE.md` 只引用本檔。舊筆記、memory、稽核報告是線索，
不是目前程式或驗證結果的替代品。使用者當次指示優先。

## 任務從開始到交付

1. 執行 `git status --short`，辨識原有變更；只處理本次範圍。操作中若出現其他來源修改，保留它。
   使用獨立 worktree 與 `feat/<主題>`、`fix/<主題>` 或 `chore/<主題>` 分支；不得直接提交
   `main`／`develop`，不得讓多個任務共用同一工作樹提交。
2. 用一句話確認預期行為與驗收方式。按目錄地圖找相似實作與測試，避免掃全庫。
3. 先做 GitNexus 影響分析，再改既有函式／類別。流程見下節。
4. 完成最小、可驗證的修改。遇到相同失敗兩次，改查假設／環境／呼叫鏈，勿反覆套同一修法。
5. 依 [驗證矩陣](docs/AI_WORKFLOW.md) 實跑相應檢查；記錄通過、失敗、未跑及原因。
6. 提交前跑 GitNexus `detect-changes`、`git diff --check`，再審閱最終差異與 stage 清單。
7. **在獨立 worktree 分支上自行 git commit**（`git worktree add ../hcca-<主題> -b <類型>/<主題>`），
   不直接改主工作樹的 `main`，避免與其他同時進行的工作互相覆蓋。分支使用 `feat/`、
   `fix/` 或 `chore/` 前綴；訊息用簡短中文，不附任何協作或作者署名。
   只 stage 本次相關檔案；無關變動分開提交。驗證通過並完成 commit 後，自動執行
   `git push -u origin <分支>` 推送目前的 `feat/`、`fix/` 或 `chore/` 分支。不要自動開 PR 或部署。
8. 最後回報：改了什麼、驗證證據與限制、commit 與分支。未跑的檢查不可寫成通過。

## 需要使用者另行明確核准的操作

即使任務已授權實作，下列操作仍須當次明確核准；`guard-dangerous` hook 會對受保護推送
與部署提出確認，並攔截其他正式操作：
正式部署與正式 compose 啟停、正式資料庫 migration／資料修改／刪除、金鑰與憑證輪替、
推送到 `main`／`develop` 或 `feat/`、`fix/`、`chore/` 以外的分支、強制推送／改寫歷史／刪除分支，
GitHub 設定與 secrets、改變既有業務政策（退款、庫存、座位、審核與覆核規則）。
正式主機 MCP（hostinger-vps）預設已 deny。
完整安全稽核報告、受影響帳號與正式環境處置紀錄不得提交到公開 repository 或公開 issue。

## 架構與資料

- 依賴方向 **Router → Service → Model**。FastAPI 入口 `api.main:app`，掛載在 `api/main.py`。
- `require_permission` 等 RBAC 入口檢查在 router。不要把既有 service 的物件歸屬、組織範圍、
  狀態轉移檢查當成重複權限刪掉；有登入／權限不代表能存取每一筆資料。
- DB 業務操作用 `AsyncSession`；async 函式不可呼叫 `requests`、`time.sleep()` 等阻塞 API。
  Alembic 與同步 Celery 入口沿用既有橋接方式，不機械改成 async。
- Schema 直接回傳既有 `XxxOut`／列表格式，不新增 `{data, success}` 包裝。
- schema 命名 `XxxCreate / XxxUpdate / XxxOut / XxxListItem`，ORM 回應設 `from_attributes=True`。
  PATCH 要區分「未提供」與「明確設為 null」，沿用 `exclude_unset=True` 等現有慣例。
- 變更持久化 schema 必須建立／檢查 Alembic migration，正確位置 `apps/api/alembic/`。
  不改已套用的歷史 migration 來掩蓋問題；非結構 model 修改不盲目產空 migration。
- API 契約變更：更新 OpenAPI 產物與 `apps/web/src/lib/types.ts` 相容層，檢查領域 API 呼叫端。
  實際型別流程見前端規範，禁止直接手改 `api-types.ts`／`api-bridge.ts`。
- 沿用 UUID、TimestampMixin、String 儲存 StrEnum 與既有軟刪除語意。Python 3.12、Ruff 行長 100。
- 測試不 mock DB；使用 PostgreSQL 或 aiosqlite。SQLite 結果不等同 PostgreSQL／migration 驗證。
  新增 router 行為至少覆蓋成功、未授權／禁止存取；權限變更還需跨使用者／組織案例。

## GitNexus（先確認主機上的正確工作樹）

本機曾有兩筆同名 `hcca_web_system` 索引。CLI **一律帶 `--repo .`**；MCP 先 `list_repos`，
以實際路徑辨識，不憑名稱猜。索引資訊請即時查，不把符號數寫成常數。此主機的增量更新曾錯置符號，暫用下列完整重建入口。

```bash
node .gitnexus/run.cjs status
node .gitnexus/run.cjs query '業務概念' --repo .
node .gitnexus/run.cjs context 'symbolName' --repo .
node .gitnexus/run.cjs impact 'symbolName' --direction upstream --repo .
# 更新索引，保留手寫規範／技能
bash scripts/refresh-code-index.sh
# 每次 commit 前（涵蓋其他工作時要區分歸屬）
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

- **既有函式、類別、方法在 impact 前不得編輯。** 回報直接呼叫者、受影響流程與風險。
- 同名符號用 `--file` 或 `--uid` 定位；HIGH／CRITICAL 先告知風險，再按授權範圍處理。
- `UNKNOWN`、空結果、工具失敗不是低風險；補查文字引用、入口與測試。
  文件／設定若圖譜未收錄，同樣記錄 UNKNOWN，逐一驗證引用與設定格式。
- 概念／流程用 query，已知符號用 context，影響用 impact；`rg` 用於字面量、圖譜缺漏的補查。
- `partial: true`／`truncated: true` 的變更分析不能當通過，需重跑或處理限制並明示阻塞。
- 索引出現不符路徑的符號時，先修索引，再用結果判斷。修復方式見 [本機工具](docs/ENVIRONMENT.md)。
- 重命名用 GitNexus rename，不做全庫文字替換。沒有工具時先修好工具，不假造分析結果。

## 操作邊界

- 不讀出／貼出 `.env`、token、cookie、私鑰或個資；只查所需設定名稱／是否存在。
- 不覆寫、reset、stash、整檔 restore 其他來源變更。撤銷失敗嘗試只回退自己新增的 hunk。
- 不因測試失敗而刪測試、降低 coverage、加 `any`、吞例外或移除權限檢查。
- 任務已授權的可逆實作、驗證與修復直接完成。需要新增不可逆資料操作、正式部署、對外發送時，
  先確認本次已有相應授權；未授權才提出具體方案請使用者決定。
- 不假設可用更強模型或子代理。單一模型可以完成分析、實作與驗證；是否委派遵守當次工具規範。
- 不預讀 `alembic/versions/`、lockfiles、快取或生成型別全文。需要時針對最新 revision／指定型別讀取。

## 按需文件

- [操作與驗證矩陣](docs/AI_WORKFLOW.md)：改功能、排錯、schema、UI、更新依賴的具體步驟。
- [本機工具與限制](docs/ENVIRONMENT.md)：Codex／Claude、技能、插件、索引與已知環境限制。
- [交接檢查清單](docs/HANDOFF_CHECKLIST.md)：任務收尾與證據格式。
- [文件索引](docs/README.md)：區分現行入口、主題文件與歷史報告。
