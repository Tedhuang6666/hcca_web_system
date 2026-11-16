# API 局部規範

繼承根目錄 [AGENTS.md](../../AGENTS.md)。下列命令從 repository 根目錄執行。

- 已拆成 service 套件的領域目前為 `document/`、`governance/`、`shop/`；其他 service 先依實際來源檔判斷，並追 re-export 到實作。
- 修改依賴看 `apps/api/pyproject.toml`，lint／pytest／coverage／mypy gate 的共同設定在根 `pyproject.toml`。
- `uv run --project` 不切換 cwd。Alembic 必須用 `uv run --locked --directory apps/api alembic ...`。
- PostgreSQL fixture 由正式 migration 基線建立隔離 schema，再清空種子列供案例自行建資料。
  基線與完整封存歷史的 schema／種子相等性另跑 `scripts/tests/test_migration_baseline.py`。
- 權限失敗要測 401/403；有權限但不是本人／同組織時也要測。依 API 現有契約決定 403 或 404。
- Celery 保持同步 task 入口；沿用現有 DB／event-loop bridge。queue 變更檢查所有 compose consumer。
- 先找相近 test fixture；不要手造不合法 CSRF token，不 mock AsyncSession 掩蓋 SQL 或 transaction 問題。
- 本機 API 測試使用明確指定的 PostgreSQL `*_test` DB；未啟動服務時記錄阻塞，不改測試為永遠成功。

```bash
bash scripts/check.sh api
# TEST_DATABASE_URL 已由本機環境設定；不要將 URL／密碼寫進回報。
bash scripts/check.sh api-test apps/api/tests/test_documents_router.py
```

schema 變更的 migration、空 DB upgrade、drift check 與契約流程見
[AI_WORKFLOW.md](../../docs/AI_WORKFLOW.md)。
