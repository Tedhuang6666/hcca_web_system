# API 執行與間歇斷線排查

Docker 的 `RestartCount=0` 不能排除容器內 Gunicorn worker 重啟。若日誌出現
`Maximum request limit ... exceeded`，比對 `Worker exiting`、`Application startup complete`
與 Caddy `no upstreams available` 的時間；健康檢查與前端輪詢也會消耗請求配額。
單一 API 容器的 worker 回收空窗重疊時，多個功能都可能同時逾時。

`GUNICORN_MAX_REQUESTS=0` 預設停用按請求數回收，符合
[Gunicorn 預設行為](https://gunicorn.org/reference/settings/#max_requests)。啟動與 reload hooks
會把最終生效的請求配額與 jitter 強制歸零，環境變數、`GUNICORN_CMD_ARGS` 與 CLI 覆寫
亦不能重新啟用；有覆寫時會記錄警告。更新透過 blue-green 就緒後切流量，不能用 jitter
當成服務不中斷的保證。部署後仍須觀察 worker PID、錯誤與記憶體趨勢。

從 repository 根目錄執行 `bash scripts/check.sh api`，包含無須 DB 的真實 Gunicorn 回歸
測試：預設設定連續處理 1,200 次請求不回收，三種覆寫來源與 reload 後亦維持禁制。
這項禁制只消除請求配額造成的回收；不能防止 OOM、程序崩潰、主機故障或人為重啟。
若要承受這些故障，仍需獨立實例與就緒檢查的流量接手，並做正式環境故障演練。

延遲分別測 VPS 內 API、本機 Caddy origin 與公開網域，確認回應是預期的 200 再比較。
容器 IP 直連要帶合法 Host，TrustedHost 回傳的 400 不能代表 API 效能。Cloudflare 的
`/cdn-cgi/trace` 可協助區分到邊緣的網路延遲與 origin 處理時間；該回應含訪客 IP，
只記錄必要的節點代碼與耗時。
