# HCCA 持續安全測試

授權目標為 `https://hcca.tw`。本流程將公開站的低頻探針與隔離環境的攻擊回歸分開執行。
GitHub workflow 位於 [security-regression.yml](../.github/workflows/security-regression.yml)：
合併／推送到 default branch 後，每日台北時間 05:41 執行，也可手動觸發。
本次只提交本機變更，沒有 push、部署或啟用遠端排程；排程尚未在 GitHub 實跑。
排程另以 subfinder 做被動資產探索，與 [候選清單](../security/known-domains.txt) 比較。
發現新網域時工作會失敗並保留候選報告，供確認歸屬／用途；不自動將新網域加入 active scan。
被動來源未回傳候選時記為未完成，不將空清單當作資產消失或安全。

## 可重跑入口

```bash
# 六個固定 GET；最多每秒一個請求，不追轉址，不保存 response body、Cookie 或 token。
python3 scripts/security-baseline.py --output /tmp/hcca-public-baseline.json
# nuclei 3.8.0：只執行庫內已審閱的兩個認證探針。
python3 scripts/security-nuclei.py --output /tmp/hcca-nuclei.json
# 專用 loopback 測試 DB／Redis + Java 17 + ZAP 2.17.0；自行 migration、啟停隔離 API。
# TEST_DATABASE_URL 必須是 PostgreSQL *_test；REDIS_URL 必須指向專用測試 Redis DB。
uv run --locked --project apps/api python scripts/security-zap.py \
  --zap /path/to/ZAP_2.17.0/zap.sh --output /tmp/hcca-zap.json
# 掃描器自身的範圍、故障、停止條件與報告保護回歸。
python3 -m unittest discover -s scripts/tests -p 'test_security_*.py'
```

正式站兩支探針 exit `0` 代表所列檢查完成且沒有命中，`1` 代表待確認的發現，`2` 代表未完成。
DNS／連線失敗、轉址、403、429、5xx 不會被寫成安全。遇到 403、429、5xx 或連線錯誤即停止
後續基線請求；排程不在基線失敗後繼續 nuclei。nuclei 另核對兩個 URL 的實際請求紀錄與錯誤，
空結果檔本身不能證明掃描成功。工具原始 request／response 不會進入保留的報告。

本機回歸先啟動專用 PostgreSQL／Redis，再設定 `TEST_DATABASE_URL`（loopback、`*_test`）、
`REDIS_URL`、`REDIS_CACHE_URL`、`REDIS_REALTIME_URL`、Celery broker／backend 為測試用途；
不使用開發或正式資料。測試清單見 workflow，包含認證、RBAC、跨組織權限、IDOR、MFA、
API key、設定保護與 heartbeat 漏洞回歸。以 `bash scripts/check.sh api-test <測試檔>` 執行。
CI 的服務是每次工作新建的 PostgreSQL 16／Redis 7；PR 只執行隔離回歸，不觸發正式站探針。
回歸後執行隔離 ZAP：固定四個公開 GET 入口與三條 active rules，不啟動 spider 或瀏覽器；
程序先占有 loopback socket，再交給自己啟動的 API，不能掃到該 port 上的其他服務。
子程序在私有暫存目錄執行，不載入 repository `.env`，也不繼承應用整合 secrets。
ZAP 摘要只保留規則 ID、風險等級、請求／警示數量，原始 cookie／body 隨暫存目錄刪除。
三條規則須有完成紀錄且請求數大於零；錯誤／缺漏為 exit `2`，中高風險警示為 exit `1`；
exit `0` 表示限定規則完成且沒有中高風險警示，低風險與資訊提示仍列在摘要。

## 各階段如何決定下一步

| 階段 | 執行方式與證據 | 進入下一階段的條件 |
| --- | --- | --- |
| 資產探索 | subfinder／憑證透明度紀錄，保留候選網域與來源 | 候選須確認用途與歸屬；不能將第三方 CNAME 當作自有主機 |
| DNS／HTTP／連接埠 | DNS、httpx；獨立測試主機才能對明確連接埠使用 nmap | `hcca.tw` 指向 Cloudflare，共用 CDN IP 不做主機連接埠掃描 |
| 攻擊面盤點 | 公開入口與程式路由、身份需求、物件歸屬交叉核對 | 200 的登入頁或 SPA fallback 不是越權證據 |
| nuclei／ZAP | 正式站僅庫內兩個 GET nuclei 探針；ZAP active scan 使用自啟的 loopback API／測試 DB | 限定三條注入規則；其他 active rules 須個別評估測試資料與外部效果 |
| ffuf／feroxbuster | 小型已審閱路徑表，單執行緒、1 req/s、限時、不遞迴、不追轉址 | 敏感路徑只檢查 HEAD 狀態，不下載秘密或備份內容 |
| 人工分析 | 程式呼叫鏈＋HTTP 證據；需要互動登入時以 Burp／Caido 重放測試帳號請求 | 必須區分 CSRF、登入、角色、組織與物件權限 |
| Auth／Authorization／IDOR | 未登入、無權限 B、合法 owner A／admin；寫入後檢查 DB | 拒絕案例必須通過 CSRF；本人成功案例證明業務端點確實可達 |
| 疑似漏洞驗證 | 先在隔離資料做可重現、最小影響 PoC，再寫失敗回歸 | 只有可重現的漏洞才記為 confirmed；列出前提與影響 |
| sqlmap／Metasploit | 只針對已確認的對應注入點／服務疑點，在隔離環境使用 | 沒有疑點時記為不適用；不自動資料抽取、取得 shell、持久化或破壞資料 |
| 修復／重測 | 先 impact、修改、同 PoC 重測、相關安全回歸、GitNexus、commit | 修復未部署時，只能宣稱本機修復完成 |

新增疑點時記錄：資產／入口、前置身份、最小重現、預期／實際狀態、資料是否改變、
嚴重性依據、修復 commit、重測證據、待部署狀態。避免保存個資或完整敏感回應。
GitHub artifacts 保留 14 天；workflow 有錯誤會失敗，不以 `continue-on-error` 隱藏結果。
現有 Bandit、Semgrep、CodeQL 與相依套件掃描仍沿用原 workflows。

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

## 尚待啟用與驗證

本機提交不會修復正式站。每日資產探索／正式站探針／隔離回歸及 ZAP workflow
必須進入 GitHub default branch 才有排程，且仍需觀察首次 Actions 結果。
依根目錄規範，目前未 push、合併或部署；正式站登入測試仍缺少專用測試身份，
origin 連接埠盤點也未取得獨立 origin 目標。這些均未宣稱完成。
