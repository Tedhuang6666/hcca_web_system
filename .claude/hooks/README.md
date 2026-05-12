# Hooks 設定說明

Hooks 設定在 `.claude/settings.json`，由 Claude Code harness 自動執行。

## 已設定的 Hooks

### 1. PostToolUse — Ruff 自動 Lint/Format

**觸發**：Write 或 Edit 工具寫入 `.py` 檔案後
**動作**：自動執行 `ruff check --fix` 與 `ruff format`
**目的**：確保每次修改 Python 檔案後都符合 PEP8 與專案 Ruff 設定

```json
{
  "matcher": "Write|Edit",
  "hooks": [{
    "type": "command",
    "command": "bash -c 'FILE=... ruff check --fix && ruff format'"
  }]
}
```

### 2. PreToolUse — 危險指令警示

**觸發**：Bash 工具執行前，偵測到危險關鍵字
**偵測關鍵字**：`alembic downgrade`、`DROP TABLE`、`DROP DATABASE`
**動作**：印出警告並中斷執行（exit 1），需使用者手動確認後再執行

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "bash -c 'if echo $CMD | grep -qE \"alembic downgrade|DROP\"; then exit 1; fi'"
  }]
}
```

## 新增 Hook 的方式

1. 編輯 `.claude/settings.json`
2. 在對應的事件類型（`PreToolUse` / `PostToolUse`）下新增條目
3. `matcher` 支援正規表達式匹配工具名稱
4. `command` 為 shell 指令字串

## 可用的環境變數

| 變數 | 說明 |
|------|------|
| `CLAUDE_TOOL_RESULT_FILE_PATH` | 被修改的檔案路徑（Write/Edit 後） |
| `CLAUDE_TOOL_INPUT_COMMAND` | 即將執行的 Bash 指令（PreToolUse） |
| `CLAUDE_TOOL_NAME` | 觸發 hook 的工具名稱 |

## 提醒：Model 變更後記得建 Migration

修改 `apps/api/src/api/models/` 下的任何檔案後，必須：

```bash
uv run --project apps/api alembic revision --autogenerate -m "描述變更"
uv run --project apps/api alembic upgrade head
```

（此提醒目前為文件形式，若需要自動提示可在 PostToolUse 中新增對應 hook）
