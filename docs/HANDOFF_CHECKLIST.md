# HCCA 交接檢查清單

每個任務依 [驗證矩陣](AI_WORKFLOW.md) 選檢查，不用為文案修改跑整套資料庫測試。
以下每一項都要有依據；未跑寫明原因。

- [ ] 實際行為符合使用者驗收條件，正常／失敗／權限邊界適當覆蓋。
- [ ] 既有符號已做 impact，結果的 worktree 正確；HIGH／CRITICAL 已告知，UNKNOWN 已補查。
- [ ] 相關 lint／型別／測試／build 的實跑結果已記錄；沒有降低品質門檻來通過。
- [ ] 儲存 schema 變更有 migration、upgrade 與 drift 結果；純程式變更不產空 migration。
- [ ] API 契約與前端相容層一致；生成檔由工具產生，未直接手改。
- [ ] UI 變更檢查手機／鍵盤與載入／空／錯誤狀態；附實際瀏覽器驗證結果。
- [ ] `detect-changes --scope all --repo .` 結果完整，沒有把 partial／truncated／工具失敗當成通過。
- [ ] `git diff --check` 通過；stage 只有本次修改，未含秘密、個資、快取或其他來源變更。
- [ ] 自行中文 commit，無任何署名；未在沒有指示時 push／部署。
- [ ] 最後回覆包含變更、驗證、限制、commit；仍有事項則留具體下一步。

若本機服務不可用，完成可做的檢查並明示限制，不能把 CI 尚未執行寫成已通過。
不要把歷史 audit 的零漏洞、測試數或已修項目沿用到當前 HEAD。
本機狀態與更新紀錄見 [LOCAL_TOOLING.md](LOCAL_TOOLING.md)。
