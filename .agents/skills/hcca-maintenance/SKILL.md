---
name: hcca-maintenance
description: 維護 HCCA 的 API、前端、資料庫契約與開發工具時，定位實作、選擇對應驗證並留下可接手的結果。適用於這個 repository 的修錯、新增功能、schema 或維護設定任務。
---

# HCCA 維護

從此 skill 目錄往上三層是 repository 根目錄；先讀
[PROJECT_CONTEXT.md](../../../PROJECT_CONTEXT.md) 與目標目錄的 AGENTS.md。
不要把整個 docs 或歷史 migration 載入上下文。

1. 記錄 `git status --short` 與可驗收的行為；保留其他來源修改。
2. 依根 AGENTS 的 GitNexus 流程定位與 impact。CLI 綁 `--repo .`；同名索引／符號不能猜。
3. 讀最近似的實作和測試。API 的 document/meeting/meal/shop/auth 是 service 套件，
   Web `lib/api.ts` 是 re-export；不要在舊單檔路徑新增第二套實作。
4. 依 [AI_WORKFLOW.md](../../../docs/AI_WORKFLOW.md) 選所需章節：
   - 改欄位／回應：API 契約流程，生成型別與手寫相容層分別處理。
   - 改儲存結構：schema／migration，PostgreSQL upgrade 與 drift 分開驗。
   - 修錯：排錯決策，先區分業務問題與工具／環境問題。
   - 其他：驗證矩陣，不漏相關檢查、不把未跑當通過。
5. 用 `bash scripts/check.sh <scope>` 執行檢查。環境不通時讀
   [LOCAL_TOOLING.md](../../../docs/LOCAL_TOOLING.md)，完成不受阻的工作並記錄限制。
6. `detect-changes` 與 diff 審閱完成後，只提交本次相關檔案；中文 commit、無署名，不主動 push。
7. 回報結果、實跑證據、限制與 commit。若尚有後續步驟，用 workflow 裡的接手格式寫明。

單一模型可依此完成；不要假設有更高階模型可救援或任意啟動子代理。
