# HCCA Shared

後端 workspace 共用函式庫，放置不依賴 FastAPI router 或 SQLAlchemy ORM 的
Pydantic schema、回應結構與基礎型別。

## 原則

- 保持 ORM-agnostic，不從 `api.models` 匯入。
- 不放 HTTP 路由、DB session 或業務流程。
- schema 遵循 `XxxCreate`、`XxxUpdate`、`XxxOut`、`XxxListItem` 命名。
- ORM 轉換用 schema 必須設定 `ConfigDict(from_attributes=True)`。

## 驗證

```bash
uv run --project apps/api ruff check libs/shared/src
uv run --project apps/api ruff format --check libs/shared/src
```
