# 班級名冊備份與部署

`apps/api/data/class_rosters/115_grade2.csv` 是 115 學年度高一升高二編班名單的版本化備份，
包含原班／原座號、目標班／新座號，以及休學狀態。CSV 不包含姓名；平台會以學號連結已存在的
使用者帳號，尚未註冊的學號會先保留在班級名冊中。

## 本機驗證與匯入

```bash
uv run --project apps/api python apps/api/scripts/import_class_roster.py
uv run --project apps/api python apps/api/scripts/import_class_roster.py --apply
```

不帶 `--apply` 只會驗證資料，不會寫入資料庫。`--apply` 使用 `AsyncSession` 單一交易，確認
201–216 班級已存在後，對名冊做可重複執行的 upsert。腳本不會建立、刪除或修改班級；若任一班級
不存在或不是啟用的二年級班級，匯入會中止。

## 正式部署

正式 compose 的 `migrate` service 會依序執行 Alembic migration 與名冊匯入：

```bash
docker compose --env-file .env.production \
  -f docker-compose.prod.pull.yml --profile migrate run --rm migrate
```

`scripts/prod-pull-deploy.sh` 與 blue-green 部署會自動走同一個流程。部署腳本在 migration 前
仍會先建立並驗證 PostgreSQL 備份；若名冊驗證或匯入失敗，部署會停止，不會啟動不完整版本。

若要更換年度名單，新增對應 CSV 並調整匯入腳本的部署資料來源後再部署；不要覆寫既有年度 CSV。
