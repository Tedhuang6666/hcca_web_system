# API 執行與間歇斷線排查

Docker 的 `RestartCount=0` 不能排除容器內 Gunicorn worker 重啟。若日誌出現
`Maximum request limit ... exceeded`，比對 `Worker exiting`、`Application startup complete`
與 Caddy `no upstreams available` 的時間；健康檢查與前端輪詢也會消耗請求配額。
單一 API 容器的 worker 回收空窗重疊時，多個功能都可能同時逾時。

`GUNICORN_MAX_REQUESTS=0` 預設停用按請求數回收，符合
[Gunicorn 預設行為](https://gunicorn.org/reference/settings/#max_requests)。確認記憶體洩漏且有
資源監測後才啟用非零門檻與 `GUNICORN_MAX_REQUESTS_JITTER`；jitter 不能保證回收不會重疊。
部署後仍須觀察 worker PID、錯誤與記憶體趨勢；若環境明確設定非零門檻，會覆寫程式預設值。

從 repository 根目錄執行 `bash scripts/check.sh api`，包含無須 DB 的真實 Gunicorn 回歸
測試：預設設定連續處理 1,200 次請求不回收，明確啟用的回收設定仍有效。
這不能替代部署後的正式流量觀察。

延遲分別測 VPS 內 API、本機 Caddy origin 與公開網域，確認回應是預期的 200 再比較。
容器 IP 直連要帶合法 Host，TrustedHost 回傳的 400 不能代表 API 效能。Cloudflare 的
`/cdn-cgi/trace` 可協助區分到邊緣的網路延遲與 origin 處理時間；該回應含訪客 IP，
只記錄必要的節點代碼與耗時。
