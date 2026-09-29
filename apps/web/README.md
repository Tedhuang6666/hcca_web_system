# apps/web

竹嶺班聯數位整合系統前端（Next.js 16 App Router + React 19 + TypeScript）。

> 完整專案說明請參閱根目錄 [PROJECT_CONTEXT.md](../../PROJECT_CONTEXT.md)。

## 環境與啟動

需要 Node.js `>=22.13.0` 與 npm `>=10`。請在 WSL 內執行開發伺服器。

```bash
cd apps/web
npm ci
npm run dev
```

開發站位於 `http://localhost:3000`，預設連線至本機 API。

## 常用指令

```bash
npm run lint
npm run type-check
npm run build
npm start
npm run analyze
npm run generate:types
```

`generate:types` 讀根目錄 `openapi.json`，不需啟動 API server。先從 repo 根執行
`bash scripts/update-openapi.sh`，再生成 types 與 bridge。完整流程見
[AI_WORKFLOW.md](../../docs/AI_WORKFLOW.md)。

## 目錄

- `src/app/`：App Router 頁面與 layouts。
- `src/components/`：共用及各領域元件。
- `src/hooks/`：前端 hooks。
- `src/lib/api.ts`：領域 API re-export；實作在 `src/lib/api/`。
- `src/lib/types.ts`：re-export 與手寫相容型別。
- `src/lib/api-bridge.ts`：生成的具名型別與別名。
- `src/lib/api-types.ts`：OpenAPI 產生型別。

後端 schema 或 API 回應異動時，需同步更新 `src/lib/types.ts`，並視需要
重新執行 `npm run generate:types`。
