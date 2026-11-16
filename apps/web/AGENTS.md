# Web 局部規範

繼承根目錄 [AGENTS.md](../../AGENTS.md)。新增 UI 沿用所在區域的元件、tokens、錯誤呈現與權限模式。
公開區與登入區有不同設計系統，先看最近似頁面；涉及 UI 時使用可用的設計／瀏覽器技能。

- App Router 頁面在 `src/app/(public)`、`(protected)`、`(admin)`；括號不出現在 URL。
- `src/lib/api.ts` 是 re-export，實作在 `src/lib/api/<domain>.ts`，共用 fetch 在 `api/core.ts`。
- 型別流：Pydantic → `api-types.ts` → `api-bridge.ts` → `types.ts`。
  前兩者生成，不手改；`types.ts` 保留手寫相容型別與匯出。
- 不以 localStorage 狀態代替後端身份／權限；沿用現有 cookie、CSRF 與錯誤處理。
- 新增頁面檢查模組／導覽／route manifest；執行 `npm run check:module-registry`。
- 互動改動驗證 loading、empty、error、success 與鍵盤／手機，不只驗靜態畫面。
- 型別、Vitest、build 各自有作用；`type-check` 通過不能代表 build 或瀏覽器互動通過。
- 前端命令從 repo 根用 `npm run --prefix apps/web ...`，不要誤用根 package.json。
- 契約生成不需啟動 server；完整流程與驗證見 [AI_WORKFLOW.md](../../docs/AI_WORKFLOW.md)。

## 介面文案：預設不加說明

- 使用者知道如何點擊、選擇、送出。標題、欄位與按鈕已能表達的操作，不再加介紹、教學、提示或重述；沒有必要資訊就刪除整段，不為版面補文案。
- 同一件事只說一次。只有會影響當下決策的資格、期限、費用、付款責任、不可復原後果，以及錯誤原因／復原方式，才保留在操作附近。
- 不主動補充職務用途、訂單併單／歸班、統計公式與口徑、背景同步或報表計算等業務解說；折疊區也不例外。
- 使用者要求刪除的說明，連同容器移除；不得縮寫、改述或搬到別處保留。必要標籤、動態數值與狀態、錯誤回饋及不可逆操作確認照常保留。
- 必要說明以一句短句為原則；罕用細節放在可展開說明，不把完整業務規則常駐頁首。不要把後端實作、資料歸屬或防呆流程寫成使用教學。
- 刪掉「先選擇要處理的工作」「點擊可查看明細」「符合條件自動套用」這類不增加決策資訊的句子。需要說明加價時，只寫「規格加價另計」。
- 新增或修改 UI 時，連同相鄰文案檢查：刪除後仍能正確操作的說明就不保留。不得因此刪除表單標籤、無障礙名稱、必要確認、錯誤回饋或法定／隱私告知。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
