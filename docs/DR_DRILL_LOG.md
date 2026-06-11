# DR Drill Log

## 2026-06-11 Database Restore

- Source: local `campus_platform` PostgreSQL 16 database, read-only during dump
- Target: isolated `campus_platform_restore_drill`
- Backup/restore: `pg_dump --format=custom` and `pg_restore`
- Verification: 158 public tables and Alembic revision `20260608010000`
- Migration rollback: downgraded one revision and upgraded back to head successfully
- Restore RTO: 8 seconds
- Snapshot RPO: 0 seconds for this on-demand drill
- Result: PASS

Command:

```bash
SOURCE_DB=campus_platform \
TARGET_DB=campus_platform_restore_drill \
DB_PASSWORD=postgres \
scripts/dr-database-drill.sh
```

The production RPO remains 24 hours until the scheduled off-site backup is enabled and separately
verified. Blue-green traffic rollback still requires `.env.production` and the production proxy;
the repository workflow is documented in `docs/ZERO_DOWNTIME_DEPLOY.md`.
