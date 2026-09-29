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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
