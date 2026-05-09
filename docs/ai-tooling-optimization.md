# AI 開發工具最佳化手冊（Codex / Claude Code / Cursor）

## 目標

這份手冊提供一套「同一專案、三個工具一致化」的實務做法，重點是：
- 降低 context 噪音
- 提升一次完成率（first-pass success）
- 讓輸出符合 HCCA 架構鐵律（Router -> Service -> Model）

## 核心原則

1. 單一真相來源（SSOT）
- 規範以 `README_FOR_CLAUDE.md` 為主。
- `AGENTS.md`、`CLAUDE.md`、Cursor rules 僅做映射，不重複維護完整規格。

2. 任務分層
- L1：小修（單檔或單 router）
- L2：功能調整（router + service + schema）
- L3：資料模型變更（含 migration）

3. 固定交付格式
- 變更摘要（1-3 行）
- 受影響檔案
- 風險/回歸點
- 驗證指令

## 各工具最佳使用定位

### Codex
- 最適合：直接改檔、跑指令、驗證、提交前整理。
- 建議：把「執行命令、修改檔案、測試」交給 Codex，並要求先讀 `README_FOR_CLAUDE.md`。

### Claude Code
- 最適合：大型重構策略、規則收斂、長文檔與跨模組 reasoning。
- 建議：把「方案比較、設計決策、遷移風險分析」交給 Claude Code。

### Cursor
- 最適合：在 IDE 內快速補全、局部修正、邊看邊改。
- 建議：搭配 `.cursor/rules`，讓每次 inline 生成都遵守專案規範。

## 建議工作流（每日）

1. 規格對齊
- 先貼需求 + 驗收條件 + 非目標（out of scope）。

2. 指派工具
- 設計與拆解：Claude Code
- 實作與驗證：Codex
- 局部修補：Cursor

3. 收斂輸出
- 最終 PR 說明統一為：問題、做法、風險、測試結果。

## Prompt 設計模板（通用）

請依下列格式給任一工具，可顯著提升穩定度：

```text
[任務]
<一句話描述要改什麼>

[背景]
- 專案：HCCA
- 必讀：README_FOR_CLAUDE.md
- 架構：Router -> Service -> Model

[限制]
- 只改必要檔案
- DB 用 AsyncSession
- 不掃描 alembic/versions、快取、鎖定檔

[驗收]
- 列出修改檔案與重點
- 提供可執行驗證指令
- 若改 schema，提醒建立 Alembic migration
```

## 品質檢查清單（提交前）

- 是否只在 router 做 permission 檢查
- service 是否避免重複權限驗證
- async 函式是否無 blocking call
- schema 命名是否符合 Create/Update/Out/ListItem
- 若改前端 API 欄位，是否同步 `apps/web/src/lib/types.ts`

## 維護建議

- 每 2 週檢查一次規則是否過時（尤其技術版本與指令）。
- 新增重大模組時，先更新 `README_FOR_CLAUDE.md` 再更新工具規則映射。
