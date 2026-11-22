# HCCA Shared

這是保留的 workspace 成員，目前 tracked Python 程式沒有匯入它。API 回應沿用各領域既有
schema，不使用 `{success, data}` 包裝。新增共用型別前，先確認實際消費者並補上跨套件測試。

## 原則

- 保持 ORM-agnostic，不從 `api.models` 匯入。
- 不放 HTTP 路由、DB session 或業務流程。
- 若未來採用共用型別，沿用 `XxxCreate`、`XxxUpdate`、`XxxOut`、`XxxListItem` 命名。
- 若型別回應 ORM，設定 `ConfigDict(from_attributes=True)`。

## 驗證

```bash
uv run --project apps/api ruff check libs/shared/src
uv run --project apps/api ruff format --check libs/shared/src
```
