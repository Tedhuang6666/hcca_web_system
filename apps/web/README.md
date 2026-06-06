# apps/web

校園自治整合平台前端（Next.js 16 App Router + React 19 + TypeScript）。

> 完整專案說明請參閱根目錄 [PROJECT_CONTEXT.md](../../PROJECT_CONTEXT.md)。

## 環境與啟動

需要 Node.js `>=20.9.0` 與 npm `>=10`。請在 WSL 內執行開發伺服器。

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

`generate:types` 需要 API 已在 `http://localhost:8000` 啟動。

## 目錄

- `src/app/`：App Router 頁面與 layouts。
- `src/components/`：共用及各領域元件。
- `src/hooks/`：前端 hooks。
- `src/lib/api.ts`：API wrapper。
- `src/lib/types.ts`：手動維護的前後端型別。
- `src/lib/api-types.ts`：OpenAPI 產生型別。

後端 schema 或 API 回應異動時，需同步更新 `src/lib/types.ts`，並視需要
重新執行 `npm run generate:types`。
