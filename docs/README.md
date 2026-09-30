# 文件入口與可信度

## 日常維護（現行入口）

- [專案地圖](../PROJECT_CONTEXT.md)：找實作／測試位置。
- [共同規範](../AGENTS.md)：架構、GitNexus、工作樹與提交規則。
- [操作與驗證](AI_WORKFLOW.md)：依任務選具體步驟與驗證。
- [本機工具狀態](LOCAL_TOOLING.md)：同一台主機上的工具、插件、限制與更新方式。
- [交接檢查清單](HANDOFF_CHECKLIST.md)：收尾與未完成事項格式。

## 按主題讀取（不預載全部）

- 部署：[SMART_DEPLOY.md](SMART_DEPLOY.md)，核對當次使用的 compose 與部署腳本。
- 效能：[PERFORMANCE_OBSERVABILITY.md](PERFORMANCE_OBSERVABILITY.md)、[CACHE_POLICY.md](CACHE_POLICY.md)、[RENDERING_MATRIX.md](RENDERING_MATRIX.md)。
- 基礎設施：[infra/README.md](../infra/README.md)、[observability/README.md](../observability/README.md)。
- 安全：[持續安全測試與首輪證據](SECURITY_TESTING.md)。
- 獨立 bot：[apps/discord-bot/README.md](../apps/discord-bot/README.md)。

`audits/`、`BASELINE_METRICS.md`、`HOST_MIGRATION_PERFORMANCE_REPORT_20260818.md` 是特定時間的證據，
不代表目前 HEAD 的驗證結果。先讀報告日期、commit、重現條件，再決定是否仍適用。

此主機還有未追蹤的營運／事故／設計筆記，保留原檔供按需參考；它們可能包含過時路徑與主機資訊，
不作新模型的必讀入口。需要引用其中指令時先與目前程式、服務狀態核對。
所有入口文件連結由 `bash scripts/check.sh docs` 檢查，不依賴讀完整個 docs 目錄。
