# HCCA 持續安全測試

授權目標為 `https://hcca.tw`。本流程將公開站的低頻探針與隔離環境的攻擊回歸分開執行。
GitHub workflow 位於 [security-regression.yml](../.github/workflows/security-regression.yml)：
合併／推送到 default branch 後，每日台北時間 05:41 執行 DNS、SQLi／XSS 與認證邊界探針；
週日 06:11 跑 HTTP 基線，06:51 跑固定路徑枚舉，也可手動選擇單一測試類型。
使用者已確認應用部署完成；這不代表後續本機安全修正已部署。2026-09-30 查得遠端
`origin/main` 為 `798e3b281f52a6b4a5157c9bbcac1805885a65cb`；依使用者先前選擇，後續安全提交
維持本機、不推送；遠端每日排程仍是舊版。本機 WSL 可安裝下述 user timers 執行最新版探針，
不必推送到遠端。本機仍保留使用者的 `uv.lock` 變更。不執行 subfinder／amass 被動資產探索。

## 可重跑入口

```bash
# 固定 73 個子網域標籤的主動 DNS 發現；記錄解析候選的 CNAME，不連線至候選主機。
python3 scripts/security-dns.py --output /tmp/hcca-dns.json
# 核准搜尋入口的四個主動輸入探針；固定每 10 秒一個請求，不保存回應本文。
python3 scripts/security-active.py --output /tmp/hcca-active.json
# 十二條固定路徑的主動 HEAD 枚舉；每 45 秒一個請求，不下載回應本文。
python3 scripts/security-paths.py --interval 45 --output /tmp/hcca-paths.json
# 九個固定 HTTP 存取控制／安全標頭 GET 探針；每 45 秒一個請求，不保存回應本文。
python3 scripts/security-baseline.py --interval 45 --output /tmp/hcca-http.json
# WSL 本機分時排程：daily（DNS／輸入／認證）、每週基線或每週路徑枚舉。
python3 scripts/security-schedule.py --mode daily
python3 scripts/security-schedule.py --mode http-baseline
python3 scripts/security-schedule.py --mode path-enumeration
# 安裝／檢查本機 systemd user timers；輸出留在 ~/.local/state/hcca-security。
bash scripts/install-security-timers.sh
systemctl --user list-timers --all --no-pager
# 專用 loopback 測試 DB／Redis + Java 17 + ZAP 2.17.0；自行 migration、啟停隔離 API。
# TEST_DATABASE_URL 必須是 PostgreSQL *_test；REDIS_URL 必須指向專用測試 Redis DB。
uv run --locked --project apps/api python scripts/security-zap.py \
  --zap /path/to/ZAP_2.17.0/zap.sh --output /tmp/hcca-zap.json
# 掃描器自身的範圍、故障、停止條件與報告保護回歸。
python3 -m unittest discover -s scripts/tests -p 'test_security_*.py'
```

正式站 workflow 只做主動 DNS／HTTP 探測，不執行 subfinder／amass 等被動資產探索。每日查根網域、
兩個隨機 wildcard 控制與 73 個固定子網域標籤；解析成功的候選另查 CNAME，只記錄供人工判讀，
不連線至 CNAME 目標。每日再做四個搜尋輸入攻擊探針與兩個已審閱 Nuclei 認證邊界探針；
前一支探針逾時或回報發現時，後續獨立探針仍會執行，workflow 最終仍會標為失敗並上傳報告。
每週日 06:11 執行九個固定 GET 存取控制／安全標頭檢查，06:51 執行十二條固定 HEAD 路徑探針；
兩組每次請求間隔 45 秒，將每個五分鐘窗口的請求數控制在已知 WAF 自動封鎖門檻以下。
HEAD 路徑命中只標成待人工確認候選，不下載內容。HTTP 工具固定在 `hcca.tw`，不追轉址、不帶登入資訊。
403、429、5xx、Cloudflare challenge、轉址或連線錯誤會停止該掃描並回報 incomplete。
搜尋探針每次最多四個請求、相隔 10 秒；400 只記錄為輸入遭拒，不能據此分辨應用或 WAF。
報告不保存回應本文、Cookie 或 token。

本機 user timers 與 GitHub workflow 使用相同時刻及分組。timer 設為 `Persistent=true` 的每日探針，
若錯過會在 user manager 下次啟動時補跑；週基線與路徑枚舉不補跑，避免離線後同時送出多組探針。
排程器只傳遞 PATH、HOME、locale 與時區，不繼承 `.env`、資料庫 URL、應用 secrets 或代理環境；
報告目錄權限為 0700，報告檔為 0600。user manager 必須運作才能觸發 timers；WSL 關閉期間不會即時執行。
安裝器會啟用 `loginctl` user linger，讓 WSL user manager 在登出後仍保留 timer；若整個 WSL distribution
被停止或 Windows 關機，仍要等下次啟動才可能補跑每日探針。
停用排程可執行：

```bash
systemctl --user disable --now hcca-security-daily.timer \
  hcca-security-http-baseline.timer hcca-security-path-enumeration.timer
# 若也要停止 user manager 在登出後常駐，且確認沒有其他 user timers 依賴它，再執行：
loginctl disable-linger "$(id -un)"
```

本機回歸先啟動專用 PostgreSQL／Redis，再設定 `TEST_DATABASE_URL`（loopback、`*_test`）、
`REDIS_URL`、`REDIS_CACHE_URL`、`REDIS_REALTIME_URL`、Celery broker／backend 為測試用途；
不使用開發或正式資料。測試清單見 workflow，包含認證、RBAC、跨組織權限、IDOR、MFA、
API key、設定保護與 heartbeat 漏洞回歸。以 `bash scripts/check.sh api-test <測試檔>` 執行。
CI 的服務是每次工作新建的 PostgreSQL 16／Redis 7；PR 只執行隔離回歸，不觸發正式站探針。
回歸後執行隔離 ZAP：固定四個公開 GET 入口與三條 active rules，不啟動 spider 或瀏覽器，
並明確停用所有 passive rules；
程序先占有 loopback socket，再交給自己啟動的 API，不能掃到該 port 上的其他服務。
子程序在私有暫存目錄執行，不載入 repository `.env`，也不繼承應用整合 secrets。
ZAP 摘要只保留規則 ID、風險等級、請求／警示數量，原始 cookie／body 隨暫存目錄刪除。
三條規則須有完成紀錄且請求數大於零；錯誤／缺漏為 exit `2`，中高風險警示為 exit `1`；
exit `0` 表示限定規則完成且沒有中高風險警示，低風險與資訊提示仍列在摘要。

## 各階段如何決定下一步

| 階段 | 執行方式與證據 | 進入下一階段的條件 |
| --- | --- | --- |
| 資產探索 | `scripts/security-dns.py` 對 73 個固定標籤主動解析、檢查兩個隨機 wildcard，並以 DoH 記錄解析候選的 CNAME；不跑被動列舉 | 只記錄 DNS 候選，不連到未知子網域或 CNAME 目標；確認第一方歸屬後才加入 HTTP 範圍 |
| DNS／HTTP／連接埠 | 固定標籤 DNS 與 `hcca.tw` HTTP；獨立測試主機才用 nmap | `hcca.tw` 指向 Cloudflare，共用 CDN IP 不做主機連接埠掃描；第三方 CNAME 不掃 |
| 攻擊面盤點 | 公開入口與程式路由、身份需求、物件歸屬交叉核對 | 200 的登入頁或 SPA fallback 不是越權證據 |
| 主動探測 | 正式站每日固定 DNS、四個搜尋輸入、兩個 Nuclei 認證邊界請求；ZAP active scan 使用自啟的 loopback API／測試 DB | 不對正式站跑廣泛 ZAP fuzz；單一探針錯誤不能遮蔽其他獨立結果 |
| 路徑枚舉 | `scripts/security-paths.py` 使用 12 條審閱路徑、單執行緒、每 45 秒一個 HEAD、無遞迴、不追轉址 | 每週單獨執行；敏感路徑不下載內容，命中只列待人工確認 |
| 人工分析 | 程式呼叫鏈＋HTTP 證據；需要互動登入時以 Burp／Caido 重放測試帳號請求 | 必須區分 CSRF、登入、角色、組織與物件權限 |
| Auth／Authorization／IDOR | 未登入、無權限 B、合法 owner A／admin；寫入後檢查 DB | 拒絕案例必須通過 CSRF；本人成功案例證明業務端點確實可達 |
| 疑似漏洞驗證 | 先在隔離資料做可重現、最小影響 PoC，再寫失敗回歸 | 只有可重現的漏洞才記為 confirmed；列出前提與影響 |
| sqlmap／Metasploit | 只針對已確認的對應注入點／服務疑點，在隔離環境使用 | 沒有疑點時記為不適用；不自動資料抽取、取得 shell、持久化或破壞資料 |
| 修復／重測 | 先 impact、修改、同 PoC 重測、相關安全回歸、GitNexus、commit | 修復未部署時，只能宣稱本機修復完成 |

新增疑點時記錄：資產／入口、前置身份、最小重現、預期／實際狀態、資料是否改變、
嚴重性依據、修復 commit、重測證據、待部署狀態。避免保存個資或完整敏感回應。
GitHub artifacts 保留 14 天；workflow 有錯誤會失敗，不以 `continue-on-error` 隱藏結果。
現有 Bandit、Semgrep、CodeQL 與相依套件掃描仍沿用原 workflows。

## Burp／Caido 跨帳號 IDOR 重放

以專用測試帳號 A 建立可刪除的測試物件，先確認 A 本人能讀取，再在 Repeater 將同一請求的
登入狀態替換成未授權帳號 B；只改身份，不改物件 ID、方法或參數。正式站只做已核准的唯讀
GET，測試物件需為人工建立且不含真實個資；PATCH／POST 一律在隔離測試資料驗證，並使用有效
CSRF cookie／header，避免 CSRF 擋在物件授權檢查之前。若 B 得到不應有的資料或成功寫入，立即
停止，不再枚舉其他 ID；保留狀態碼與遮蔽後的最小證據，不匯出 Cookie、token 或私密本文。

依目前 `apps/api/tests/test_idor.py` 的回歸案例，重放矩陣如下：

| 入口（正式站 `/api` 前綴） | A／授權身份 | 未授權 B | 寫入驗證 |
| --- | --- | --- | --- |
| `GET /shop/orders/{order_id}` | 訂單本人 200；超管／允許的管理身份可讀 | 404 | 唯讀，不變更訂單 |
| `GET /petitions/{case_id}` | 陳情人 200 | 403 | 唯讀，不讀取或保存陳情內容 |
| `GET /surveys/{survey_id}/responses` | 需以有 `survey:manage` 或活動負責人身份作正向控制 | 403 | 唯讀 |
| `PATCH /notifications/inbox/{notification_id}/read` | 本人 200 | 404，且仍未讀 | 僅隔離資料；確認 DB 前後狀態 |
| `POST /shop/orders/{order_id}/cancel` | 本人 200，測試訂單變為已取消 | 403，訂單仍待處理 | 僅隔離資料；拒絕後確認 DB 狀態未改 |
| `POST /receivables/{id}/mark-paid` | A 有 `finance:record`：200 | B 只有 `finance:view`：403 | 僅隔離資料；拒絕後狀態仍為 unpaid |

本機 ASGI 測試路徑省略部署 gateway 的 `/api` 前綴。正式站目前沒有專用 A／B 測試帳號，
因此上表的跨帳號正式站步驟尚未執行；不要用一般使用者帳號或真實訂單替代。

## 2026-09-30 首輪結果（台北）

- `hcxa.tw` 經兩個 DNS resolver 回報 NXDOMAIN，使用者更正為 `hcca.tw`。
- `hcca.tw` HTTPS 首頁 200，HTTP 308 → HTTPS；DNS 為 Cloudflare。
- 憑證透明度列出 `hcca.tw`、`*.hcca.tw`、`www.hcca.tw`、`test.hcca.tw`、`posthug.hcca.tw`。
  wildcard 是憑證範圍，不代表所有子網域存在；候選子網域未擴大 active scan。
- subfinder 2.16.0（crtsh／hackertarget）得到上述三個子網域；httpx 1.12.0 HEAD 主站 200。
  ffuf 2.3.0 完成 12 個固定 HEAD（1 req/s、單執行緒、最多 60 秒）：敏感檔案路徑與
  API 文件均 404，公開入口 200，FastAPI 的 GET-only 路由對 HEAD 回 405。
  404 也可能由防護層產生，不能單憑它推論 origin 沒有該檔案。
- 公開基線 6/6：`/`、`/login` 200，CSP／HSTS／nosniff／防嵌入／Referrer-Policy 符合檢查；
  `/api/auth/me`、`/api/notifications/inbox` 401；`/api/docs`、`/api/openapi.json` 404。
- nuclei 3.8.0：庫內模板語法驗證通過；2 個 HTTP 請求完成、0 網路錯誤、0 命中。
  這只是兩個認證探針，不等於整站零漏洞或完整 CVE 掃描。
- 原有 2 個 IDOR 寫入測試會被缺少有效 CSRF cookie 擋住，原本的 403 斷言誤報通過。
  加強斷言後先觀察到 2 failed，再改用共用合法 CSRF client，加入未登入／owner 成功與 DB 狀態斷言。
- 認證／權限／IDOR／MFA／API key 等 119 tests 在新建的 PostgreSQL 16／Redis 7 中通過。
- Bandit 中度警示 B108 經隔離 PoC 確認：Celery 固定 heartbeat 檔跟隨 symlink／hardlink，
  能覆寫 worker 身份可寫的連結目標。前提是能先在同一檔案系統建立該連結，**未證明可由網站遠端觸發**。
  兩個 PoC 修復前均失敗；改成私有暫存檔＋原子替換後通過。路徑與 healthcheck 契約維持不變。
  Bandit 的固定 `/tmp` 路徑警示仍保留，不以 suppression 假裝工具零警示。
- heartbeat 正常寫入、兩種連結攻擊與替換失敗清理共 5 tests 通過。
- WAF 規則 23 tests 通過；本輪合計 147 個 PostgreSQL pytest 案例，另有 9 個掃描器回歸。
- 正式站瀏覽器確認 `/admin` 時，頁面導向 `/blocked`，顯示 WAF auto-block（8 hits／300s）。
  立刻停止正式站檢查並關閉瀏覽器，沒有更換 IP、繞過 token 或清除封鎖。
  本次瀏覽器登入導向驗證因此未完成；不能將 HEAD `/admin` 200 當作已確認越權。
  程式規則確認日常八個 GET 探針不包含敏感路徑特徵；ffuf 的敏感路徑枚舉不放進每日排程。
- GitNexus 對兩個 pytest entrypoint 的 impact 為 UNKNOWN；文字引用確認由 pytest／CI 收集。
  `write_heartbeat` 起初查無符號；完整重建後定位正確，impact 仍為 UNKNOWN，補查 Celery include、
  beat task 字串、測試與 prod healthcheck。
  完整索引的流程採樣仍有先天缺漏，不能用零 caller 證明沒有影響。

附加驗證：掃描器邊界／故障處理 9 tests、API Ruff／format／mypy（10 個 gate 模組）、
Celery queue 拓撲、文件檢查與 actionlint 1.7.12 通過。actionlint 未呼叫 shellcheck；
遠端 Actions 尚未執行。全工作樹 `git diff --check` 受到原有 `uv.lock` CRLF 變更的
4219 個 whitespace 診斷影響，此檔保留且不提交；本次 stage 內容另行檢查。
提交前本次 stage 的 `git diff --cached --check` 通過；GitNexus MCP 的完整列表沒有
partial／truncated 旗標。圖譜含同時進行的 coordination／calendar 變更，未納入本次提交。
147 tests 合併實跑通過，保留 5 個既有／刻意觸發的設定、Authlib 與 Pydantic warnings。

Burp／Caido 互動登入、獨立 origin 的 nmap、完整
跨帳號正式站測試與 sqlmap／Metasploit 未執行。正式站沒有提供專用測試帳號；具寫入效果的
攻擊驗證全部使用隔離資料。首輪未跑 migration，第二輪已補做空 UTF-8 DB 升級。
尚未執行整個 Web build 或全量 API suite；安全回歸不能替代這些檢查。

## 工具來源

nuclei 的模板選擇與限速依 [ProjectDiscovery 官方說明](https://projectdiscovery.io/open-source)，
版本固定於 [v3.8.0 release](https://github.com/projectdiscovery/nuclei/releases/tag/v3.8.0)，
CI 下載的 archive 以固定 SHA-256 驗證。庫內模板是自行審閱的兩個 GET，沒有自動更新社群模板、
OAST、瀏覽器、code protocol 或 cloud upload。
ZAP 計畫依 [Automation Framework 官方文件](https://www.zaproxy.org/docs/automate/automation-framework/)
及發行包內的 schema／範例；原生執行不依賴 Docker daemon。

## 第二輪：隔離 HTTP 與主動掃描

- 第一輪設定／heartbeat 修復 commit：`de8e8132`。仍未 push 或部署。
- 新建 UTF-8 PostgreSQL 測試庫，從空庫跑完整 Alembic upgrade，成功到 `20260929150000`。
  最初的臨時 SQL_ASCII 資料庫在中文 migration seed 與 JSONB 防禦測試失敗；這是環境限制，
  已另建 UTF-8 庫驗證，沒有修改 migration 或放寬斷言。
- 以實際 Uvicorn／HTTP 重現帳號封鎖繞過：有效 cookie 的帳號被 `user_block` 封鎖後，
  `/auth/me` 403，私人公文仍 200 且有完整資料；`/system/access-status` 已顯示 blocked。
  原因為可選登入依賴僅驗 token，漏掉帳號與信箱封鎖規則。
- 修復後可選登入沿用完整身份檢查，封鎖者只保留匿名存取能力；封鎖狀態端點使用專用、
  不可作業務授權的身份讀取依賴。真實 HTTP 重測：私人公文從 200 變 404，`/auth/me` 403，
  封鎖狀態仍正確。新增主要信箱、連結信箱、使用者 ID、其他組織 owner、解除／過期封鎖控制。
- 新增案例修復前有 3 個真正的權限斷言失敗；修復後相關 auth／defense／附件／隱私 65 tests 通過。
  影響分析不能只看 get_optional_user 的 LOW：文字引用補出 11 個 router，故以認證核心範圍驗證。
- 此 WSL 雖然沒有 Docker daemon，但找到了現存 ZAP 2.17.0 cross-platform archive，
  SHA-256 與官方 release asset 相符；搭配已驗證校驗碼的 Java 17 執行原生 ZAP。
  沒有沿用舊掃描結果；使用獨立 ZAP home，重新啟動實際掃描。
- ZAP 在 loopback 隔離 API 的法規搜尋、公文搜尋與公告清單執行 XSS、SQL injection、
  PostgreSQL timing 三條 active rules，分別發出 12／23／9 個請求，全部完成，0 active alerts。
  本階段刻意只在測試程序關閉 WAF／rate limit／load shedding，以測到應用本身；
  認證／授權仍啟用，不能將此結果等同正式部署或整站所有參數的掃描。
- passive alert 僅有 CSRF cookie 可被 JS 讀取（既有 double-submit 設計）與 session response
  識別提示；沒有把 CSRF cookie 改成 HttpOnly，亦不把資訊提示列成已確認漏洞。
- ZAP 的 Selenium／Firefox 與更新檢查警告保留；本次沒有使用瀏覽器型掃描規則。
  規則版本限於已驗證的發行包，不能宣稱包含當天所有新規則。
- ZAP 的空字元 payload 使 WAF 關閉的本機公文／法規搜尋回 500；另以 HTTP 獨立重現。
  這是輸入驗證缺漏，未確認為 SQL injection；正式站 WAF 有空字元規則，未在正式站重放。
  六個文字搜尋參數補上 pattern 驗證，仍允許中文與單引號；API 回覆 422，WAF 規則另行回歸。
  新的 ZAP runner 包含兩個空字元 requestor 斷言，與 44 次 active 探測均已在真實 HTTP 重跑通過。
- 產生 OpenAPI／TypeScript 契約後，query pattern 不改變 TypeScript 型別；沒有手改生成型別。
  bridge 產生器帶出的既有無關別名差異已撤回，保留此次 API 修改範圍。
- 合法控制輸入另找到法規清單的 tsquery 語法錯誤：中文／單引號組合會回 500。
  改用 PostgreSQL [plainto_tsquery](https://www.postgresql.org/docs/16/textsearch-controls.html#TEXTSEARCH-PARSING-QUERIES)
  解析一般文字，保留多詞 AND 搜尋；加入資料命中／排除控制，涵蓋引號、括號及運算符號。
  相關搜尋與法規 97 tests 通過。這是查詢解析修正，未確認為 SQL injection。
- 最終 ZAP 計畫補入法規清單與單引號 HTTP 控制；四個入口三條規則分別完成
  17／30／12 次請求（共 59），0 active alerts，所有 requestor 狀態斷言通過。
- 最終合併執行 420 個 PostgreSQL 回歸案例全數通過（17 個設定／套件棄用／既有 ORM warnings）；
  掃描器邊界與不完整結果判定 11 tests 通過。API Ruff／format／mypy gate、queue 拓撲、
  OpenAPI 契約比對、Web type-check、文件檢查及 actionlint 通過；actionlint 未執行 shellcheck。
- 中途新增案例曾留下公告快取，已在自身 cleanup 移除；NUL 測試最初被 WAF 攔截並觸發
  專用 Redis 的本機 IP 封鎖，已清除該測試條目、將該案例限定為 WAF 關閉後重測。
  這兩次失敗不是正式站狀態；沒有清除正式站封鎖。最終 420 tests 的 WAF 案例仍使用原有防護。
- GitNexus 對三個查詢 router 為 UNKNOWN，已補查 main 的掛載、前端 API 呼叫及 PostgreSQL tests；
  法規 service 的直接 caller 為法規清單 router（LOW）。索引的 flow sampling 仍有已知截斷，
  不將沒有圖譜流程誤解為沒有影響。

## 較早的交付快照

本機提交不會修復正式站。較早讀取 GitHub API 時，遠端 main 為 `dae40853`，
包含第一版 `de8e8132`；Security regression workflow（ID `371045084`）為 active，run list 為空。
因此第一版每日資產探索／正式站探針／隔離回歸已具備排程設定，但首次執行仍未驗證；
當時尚未納入 ZAP、封鎖身份與查詢修復。其後使用者確認修復已部署，詳見第三輪。
正式站登入測試仍缺少專用測試身份，origin 連接埠盤點也未取得獨立 origin 目標。

## 第三輪：部署後主動探測（2026-09-30）

- 使用者確認修復已部署。遠端 `main` 為 `798e3b28`，其提交鏈包含 `eac7264b`；
  Docker image build workflow 對該 SHA 成功。GitHub Deployments API 沒有部署紀錄，
  故部署完成的依據是使用者確認與公開 HTTP 行為，不推斷特定正式容器 digest。
- 部署後固定入口基線 6/6 通過：首頁／登入 200、需登入的 `/api/auth/me` 與
  `/api/notifications/inbox` 為 401、API 文件為 404，公開頁安全標頭符合規則。
  已審閱 nuclei 兩個認證探針完成 2/2、0 網路錯誤、0 命中。
- 主動探針限定 `GET /api/regulations/search`，共四次，每次相隔 10 秒，沒有登入、
  寫入、轉址或保存本文。一般查詢與單引號查詢為 200；布林 SQL 輸入與 XSS 反射輸入為 400；
  沒有看到隨機標記反射。400 的來源（應用驗證或 WAF）沒有保留本文以供辨識，故未推斷來源；
  本輪沒有確認 SQL injection 或 XSS。兩個輸入拒絕狀態不足以證明其他參數也安全。
- 使用者要求不做被動掃描時，GitHub workflow run `36717316860` 的資產探索與公開基線工作
  已先完成，隔離回歸工作被取消；之後沒有再啟動被動探測。本機已將未來 scheduled／手動
  workflow 改為主動 DNS／HTTP 探測，不執行 subfinder／amass；舊版曾經發出四個搜尋攻擊 GET，
  後續本機變更再納入固定標籤 DNS 發現、身份邊界 GET、HEAD 路徑枚舉與 Nuclei 主動探針。
  這個 workflow 更新尚未推送；GitHub 仍會使用遠端舊排程工作。
- 新探針只允許 `hcca.tw` 固定 HTTPS 路由、全域 IP、單一 GET 參數；每次間隔 10 秒，
  遇 403／429／5xx／轉址、網路錯誤、本文截斷或反射即停止。每回最多四次，摘要不保存本文、
  Cookie 或 token；400 僅記錄為輸入遭拒，不宣稱是哪層攔截。
- 主動探針範圍／輸出邊界 3 tests 通過；Ruff／format 與 actionlint 通過。
- 本輪重測：固定 HTTP 邊界 6/6 通過；12 條 HEAD 路徑全數完成，敏感檔案／API 文件候選均為 404，
  `/admin`、`/robots.txt`、`/sitemap.xml` 為 200。HEAD 結果不讀 body，404 也可能由 CDN/WAF 產生；
  `/admin` 200 只代表路徑可達，沒有驗證登入後資料的授權邊界。
- 主動 DNS 字典探測 13 個標籤與兩個隨機 wildcard 控制：只發現 `www.hcca.tw` 與
  `posthug.hcca.tw`。wildcard 控制為 NXDOMAIN；`www` 與根網域解析至相同 Cloudflare 位址，
  HEAD 回 301 至 `https://hcca.tw/`；`posthug` 的 CNAME 指向 `proxyhog.com`，未對它送 HTTP 請求。
- 本輪再次送出四個搜尋輸入 probe：control／單引號為 200，SQL 布林與 XSS 反射值為 400，
  沒有標記反射；Nuclei 兩個身份邊界探針 2/2 完成、0 命中。這些結果不能證明整站無漏洞。
- 本機 workflow 已把 13 個固定標籤 DNS 發現、六個固定 HTTP controls、12 條 HEAD 路徑、四個 SQLi／XSS
  payload 與兩個 Nuclei active probes 納入每日排程；隔離 ZAP 計畫關閉所有 passive rules，只保留三條 active rules。
  遠端尚未更新，新增排程仍待推送。Burp／Caido 跨帳號人工測試仍缺專用正式站測試帳號。
- 新增路徑探針邊界測試後，security scanner 共 21 tests 通過；新檔 Ruff／format 通過，
  workflow actionlint 以校驗碼驗證的 1.7.12 執行通過，未執行 shellcheck。
- 文件檢查未通過：同一工作樹內其他工作移除會議 router／test 檔，造成 `PROJECT_CONTEXT.md`
  三個既有連結失效。本輪保留那些變更，未改寫或恢復相關檔案。
- 主動 DNS 發現器於 14:01 UTC 重新解析根網域、兩個隨機 wildcard 名稱與 13 個固定標籤，
  wildcard 控制為 NXDOMAIN，只發現 `www.hcca.tw` 與 `posthug.hcca.tw`。`www` 解析與根網域相同，
  單一 HEAD 回 301 至根網域；`posthug` 的 CNAME 指向 `proxyhog.com`，未連線或掃描該第三方主機。
- DNS 範圍／wildcard／第三方候選測試加入後，安全工具測試共 26 tests 通過；新 DNS 檔 Ruff／format、
  workflow actionlint、YAML 與 ZAP JSON 解析通過。Nmap 仍未對 Cloudflare 共用 IP 執行掃描。

## 第四輪：權限修復與更新後的正式站探測（2026-09-30）

- 收款 API 曾把 `finance:view` 當成建立、更新、標記收款與退款的充分權限；權限定義將它描述為唯讀。
  本機改為要求 `finance:record`，並新增查看者遭拒且資料未變的測試；建立／更新／收款／退款的
  `finance:record` 成功案例保留。修正 commit 為 `c3117e26`，尚未推送或部署。
- 財務與收款 router 的 24 個相關測試在隔離 aiosqlite 資料庫通過；這不等同 PostgreSQL 驗證。
  本機缺少符合規範的 `TEST_DATABASE_URL`，且不能將未知的本機 PostgreSQL 連線當成測試庫。
- 公開 HTTP 基線擴至 9 個固定 GET，新增 `/api/receivables?limit=1`、
  `/api/receivables/summary`、`/api/receivables/export.csv`，只檢查狀態／標頭，不讀 response body。
  scanner 邊界測試 29 tests 通過，Ruff／format 通過，workflow YAML 可解析。
- 正式站這輪兩次基線嘗試分別於 14:38、14:46 UTC 在首頁 `/` 逾時，各只送出 1/9 個請求後停止；
  因此新增的三個收款 GET 尚未在本輪正式站重新驗證。先前匿名收款列表／摘要為 401，對隨機不存在
  UUID 的更新／收款／退款為 403；CSV 匯出狀態仍未確認。
- 無登入 Playwright 實際載入 `/admin` 後導向 `/login?next=%2Fadmin`；HEAD 看到 `/admin` 200 是
  前端頁面殼層，不能作為未授權存取證據。`robots.txt` 回 200 並列出登入後路由；單次 sitemap
  請求逾時，未再重試。
- 主動 DNS 再次發現 `www.hcca.tw` 與 `posthug.hcca.tw`；兩個 wildcard 控制為 NXDOMAIN。
  新報告對已解析候選追加 Cloudflare DoH CNAME 查詢：`www` 無可見 CNAME，`posthug` 指向
  `cc9892f216ee24b7cd0d.cf-prod-us-proxy.proxyhog.com`。未連到該第三方主機，也未對 Cloudflare
  共用 IP 做 nmap；不能由現有 DNS 證據推論該服務可被接管。
- 遠端 `origin/main` 仍為 `798e3b281f52a6b4a5157c9bbcac1805885a65cb`，因此新增的九項基線、CNAME
  報告與收款權限修正都只在本機。遠端每日排程尚未執行這些新探針。

## 第五輪：主動輸入驗證與分時持續排程（2026-09-30）

- 最新主動 DNS 完成：根網域解析正常，兩個隨機 wildcard 控制為 NXDOMAIN；只發現
  `www.hcca.tw` 與 `posthug.hcca.tw`。`posthug` CNAME 仍指向第三方 ProxyHog，未連線或掃描該主機。
- 單次唯讀 `GET /api/auth/me` 回 401；首頁 HEAD 等待 15 秒逾時。搜尋探針 control 200（9.8 秒）、
  單引號 200（1.3 秒，無 marker 反射），SQL boolean 探針等候 15 秒逾時後停止，未送出 XSS 探針。
  兩個 Nuclei 認證邊界請求均收到 headers deadline exceeded，0 個 finding；整輪結果是 incomplete。
  這些時間觀察可能來自 WAF／網路或應用查詢延遲，沒有證據確認 SQLi，也不宣稱通過。
- `search_regulations` 使用 SQLAlchemy 綁定參數，router 將 `keyword` 限制 100 字；另加隔離回歸案例，
  確認 boolean／UNION 文字不會變成 SQL 語法。新增的兩個案例在隔離 aiosqlite 通過；這不等同 PostgreSQL。
  同一測試檔全跑時 9 passed、3 failed，失敗的是既有含標點全文搜尋案例在 SQLite 的差異，不是新增案例。
  `check.sh api-test` 仍因 `TEST_DATABASE_URL` 未設定而拒絕執行；本機 PostgreSQL socket 雖接受連線但用途
  未確認，Docker daemon 不可用，因此未連到未知資料庫，也沒有 PostgreSQL／效能驗證。第一次直接測試
  在結尾記錄 OTLP exporter 401；之後按隔離測試設定 `OTEL_ENABLED=false` 重跑新增案例，2 個通過且沒有 exporter 輸出。
- 工作流程改為每日 05:41 台北時間做主動 DNS、四個輸入探針與兩個認證探針；週日 06:11 執行九個
  HTTP 基線 GET，06:51 執行十二個 HEAD 路徑探針。基線與路徑枚舉各間隔 45 秒，分開 40 分鐘，
  降低重現 WAF 8 hits／300 seconds 自動封鎖的風險。單一每日步驟失敗後，獨立認證探針仍執行，
  但整個 job 仍會失敗並上傳報告。workflow_dispatch 提供三種互斥測試模式。
- 新增 WSL systemd user timers 與排程器；每天執行 DNS／主動搜尋／Nuclei，每週分開做基線與路徑測試。
  排程器不繼承資料庫／應用 secrets 或代理環境，失敗不會跳過同一模式的其餘探針，報告設為目錄 0700、
  檔案 0600。安裝入口為 `bash scripts/install-security-timers.sh`；使用者管理器停止時不即時執行，
  每日 timer 下次啟動補跑，週探針則等下一個週日。
- 本機 user timers 已啟用，user linger 也已啟用；下一次每日探針為 10/01 05:41，週基線與路徑枚舉為
  10/04 06:11、06:51（台北時間）。首輪排程尚未執行；若 WSL distribution 整體停止，仍不會即時掃描。
- 本機安全掃描器與排程器回歸 36 tests 通過；新增 SQL boolean／UNION 測試 2 個在 aiosqlite 通過。
  API 靜態檢查、Ruff、格式與 systemd unit/calendar 驗證通過。
  Workflow YAML 與排程結構可解析；actionlint 未安裝，遠端 Actions 尚未執行。`check.sh api-test` 因
  缺少安全的 `TEST_DATABASE_URL` 在測試前停止；`check.sh docs` 因既有三個會議 router/test 連結失效而失敗。
  GitHub workflow 尚未推送，正式站新工作流程仍未在遠端啟用。
- 未確認 SQLi／XSS／IDOR 漏洞，沒有跑 sqlmap 或 Metasploit；發現的 SQL boolean 延遲候選不宜在沒有
  專用 PostgreSQL 測試庫前擴大攻擊。正式站跨帳號測試仍缺 A／B 專用帳號；本機 `uv.lock` 修改保留。

## 第六輪：擴大主動資產探索與排程器復驗（2026-10-01）

- 發現排程器子程序曾少接一層 `scripts/` 路徑，三個每日掃描都在啟動前以找不到檔案退出；修正在
  本機 commit `48a0a15c`。修正後手動每日組合完整執行，DNS、輸入探針與 Nuclei 都產生報告。
- 主動 DNS 字典由 13 擴至 73 個固定標籤，每秒最多解析一個名稱；仍不連線到候選主機。兩個隨機
  wildcard 控制為 NXDOMAIN，發現 `www.hcca.tw`、`posthug.hcca.tw`、`webmail.hcca.tw`。`www`
  與根網域使用相同 Cloudflare 位址；`posthug` 指向 ProxyHog，`webmail` 指向 Gandi，未掃描第三方服務。
- 根網域 NS 指向 Cloudflare、MX 指向 Gandi；DMARC TXT 存在。查無 CAA、MTA-STS 與 SMTP TLS
  報告記錄，列為郵件／DNS 設定觀察，不直接判定為網站漏洞。
- 修正後正式站搜尋輸入探針 control／單引號為 200，SQL 布林與 XSS 反射 payload 為 400，沒有唯一標記反射；
  Nuclei 的兩個未登入認證邊界請求完成、0 命中。回應碼無法區分應用與 WAF，沒有確認 SQLi／XSS。
- 固定路徑枚舉完成 12/12 HEAD：敏感檔案與 API 文件候選為 404，`/admin`、`/robots.txt`、
  `/sitemap.xml` 為 200。HEAD 不讀內容；`/admin` 200 不等同授權繞過，404 也不能證明 origin 沒有檔案。
- 匿名 HTTP 基線完成 9/9：首頁／登入頁 200，個人資料、通知與收款列表／摘要／CSV 匯出皆為 401，
  API 文件路徑為 404；安全標頭檢查沒有發現缺項。這驗證匿名邊界，不等同跨帳號 IDOR 測試。
- 公開 metadata GET 均為 200：robots.txt 列 45 條規則，sitemap 含 49 條站內頁面路徑。另對八個
  robots 禁止的登入頁面路由做無 Cookie GET，七個回 200、一個回 404；不讀本文。前端 route policy
  將受保護頁面標成需登入，相關 11 個 route-access tests 通過，私人 API 也都回 401；目前沒有敏感資料
  外洩證據，200 僅是待瀏覽器／API 交叉確認的頁面路徑候選。
- 目前 WSL user timers 已啟用並設定 linger；每日 05:41、週日 06:11 與 06:51（台北時間）。GitHub
  workflow 仍未推送，正式站持續排程由本機 WSL 執行。正式站跨帳號 IDOR 仍需兩個專用測試帳號；
  不對 Cloudflare 共用 IP 或第三方 CNAME 執行 nmap／HTTP 掃描。
- 安全掃描器 36 tests、Ruff／format／py_compile 通過。`check.sh docs` 仍只因既有 `PROJECT_CONTEXT.md`
  指向的三個缺失會議 router／test 檔連結失敗，本輪沒有碰觸這些無關檔案。
