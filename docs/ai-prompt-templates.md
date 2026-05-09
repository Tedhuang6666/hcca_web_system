# AI 提示詞模板庫（Codex / Claude Code / Cursor）

## 1) 功能新增（不改 schema）

```text
請在 HCCA 專案完成以下功能：<描述>
先讀 README_FOR_CLAUDE.md。
遵守 Router -> Service -> Model。
權限檢查只放 router dependencies。
請直接實作並提供：
1. 變更檔案清單
2. 關鍵程式碼差異
3. 測試指令與結果摘要
```

## 2) 功能新增（含 schema 變更）

```text
請在 HCCA 專案新增：<描述>
這次會改到 models，請同步：schema/service/router。
使用 AsyncSession。
完成後請額外提醒 Alembic migration 指令，並說明 migration 要人工檢查哪些點。
```

## 3) Bug 修復

```text
請修復以下問題：<錯誤現象>
先最小化定位根因，再做最小必要修補。
不要做無關重構。
輸出格式：
- Root cause
- Fix
- Risk
- 驗證步驟
```

## 4) Code Review 模式

```text
請用 code review 模式檢查這次變更，優先找：
- 行為回歸
- 權限漏洞
- 非同步阻塞
- 缺少測試
請依嚴重度排序並附檔案位置。
```

## 5) 前端型別同步

```text
這次 API 欄位有變更，請同步更新前端：
- apps/web/src/lib/types.ts
- apps/web/src/lib/api.ts
並檢查對應頁面是否受影響。
```

## 6) Cursor 行內修補（短 prompt）

```text
只做最小修補，不重構。
遵守現有風格與命名。
若牽涉 API 欄位，同步更新 lib/types.ts。
```
