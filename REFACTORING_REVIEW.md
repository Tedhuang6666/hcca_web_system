# 程式模組化與殘留盤點

盤點日期：2026-10-26。應用程式基準：`c3181375`；收尾基準：`557d2e77`。
兩者間只有其他工作新增的 Git ignore 規則，應用程式來源相同。
報告撰寫後另出現其他工作的商品頁／lookbook 程式與素材變更，未納入下列靜態統計、未修改或提交。

範圍涵蓋本 repository 的公開網站、登入後系統、管理後台、FastAPI、獨立 Discord bot、
shared、維護腳本、依賴宣告及文件入口。不是其他 repository 或正式主機的全面盤點。
本機 `hcca-showcase/` 經 package manifest 確認是影片製作工具，本次只辨識用途，未深入稽核。

本次只新增報告，沒有移除功能、重構程式、改 DB、更新依賴或部署。
下列「候選」仍需在真正移除時重新做 impact 與相關回歸。

## 判讀與建議順序

- **已確認**：可由目前檔案、引用或實跑探針直接重現。
- **候選**：缺乏目前使用證據，但仍有動態載入、外部消費者或營運用途的可能。
- **P1**：先處理會誤導維護、驗證或功能入口的問題。
- **P2**：分批進行模組化與去重，降低修改成本。
- **P3**：整理儲存、建置與歷史資料。

| 順序 | 項目 | 主要收益 | 修改風險 |
| --- | --- | --- | --- |
| 第一批 | R15、R16、R21：壞掉的 CLI、產生器、過時文件 | 避免依照舊入口產生錯誤 | 低至中 |
| 第二批 | R01、R13、R17、R18：孤立元件、依賴候選、舊工具、字型 | 減少無效維護面與安裝負擔 | 低至中，逐項確認 |
| 第三批 | R02、R03：只有測試的入口、購物車退役範圍 | 讓產品、程式與測試一致 | 中，先確認保留意圖 |
| 第四批 | R04、R05、R06：Email 去重、大頁拆分、CSS 分層 | 最直接降低重複與介面修改成本 | 中 |
| 第五批 | R07–R11、R12、R20：服務、依賴所有權、監控配置 | 明確模組邊界與單一來源 | 中至高；列印為 HIGH |

拆檔主要改善可維護性；沒有 bundle、映像或執行期量測前，不把行數減少換算成載入速度或記憶體收益。

## 前端與舊購物車

### R01 — 七個前端檔案是可退役候選（P2，候選）

TypeScript compiler API 解析靜態 import、re-export、字面量 dynamic import，從 Next 頁面、
layout、route、metadata 與 instrumentation 等入口追蹤；排除測試後，下列檔案不可達。
再以元件名稱與路徑補查文字引用，沒有找到頁面使用者：

| 檔案（`apps/web/src/` 下） | 行數 | 補查結果 |
| --- | ---: | --- |
| `components/finance/PublicExpenseTable.tsx` | 220 | 沒有頁面匯入 |
| `components/meal/UserPicker.tsx` | 88 | 沒有頁面匯入；學餐頁已無目前入口 |
| `components/meetings/NumberField.tsx` | 24 | 沒有頁面匯入；共用 NumberInput 仍在使用 |
| `components/regulations/LawTree.tsx` | 84 | 沒有頁面匯入；LawTreeEditor、LawArticleRow 仍有使用 |
| `components/theme/ThemeProvider.tsx` | 115 | 只供同目錄舊 Toggle 使用 |
| `components/theme/ThemeToggle.tsx` | 51 | 沒有頁面匯入 |
| `components/ui/OnboardingHint.tsx` | 104 | 引用只在自身型別與用法註解 |

合計 686 行。主題系統的現行入口是 `app/layout.tsx:5` 匯入的
`components/providers/ThemeProvider.tsx`，以及 Topbar 使用的 `components/ui/ThemeToggle.tsx`。
舊系統用 `hcca_theme`，現行系統用 `hcca-theme`，不是可以混接的同一個 context。

建議分小批移除候選，再跑 Web lint、型別、Vitest、build；主題部分另驗深淺色與首次載入。
靜態不可達不等於正式環境實測未使用；不要連同仍有引用的同名元件一起刪除。

### R02 — 班級更正申請元件只有測試使用（P1，已確認引用現況）

`components/shop/ClassCorrectionRequest.tsx:16` 不在頁面可達圖內，只有
`ClassCorrectionRequest.test.tsx:3` 匯入。`classApi.createCorrectionRequest` 的前端呼叫也只在此元件。
管理端 `ClassCorrectionRequestsPanel` 則確實掛在 `admin/classes/page.tsx:1853`。

這可能是漏掛入口，也可能是尚未退役完整的功能，不能直接當垃圾刪掉。
先確認一般學生是否仍需申請歸班：保留則接回適當頁面並驗完整申請到審核流程；
退役則一起處理使用端、API 與測試的契約，不用刪測試來掩蓋缺少入口。

### R03 — 舊購物車已退出 HTTP 流程，服務與 E2E 尚未一致（P1，已確認）

- `apps/api/tests/test_shop_router.py:607` 明確要求 `/shop/cart` 與 `/shop/cart/checkout` 回 404。
- `services/shop/_orders.py:308–438` 仍保留購物車 CRUD／序列化；`:780` 仍有 checkout。
  目前文字引用為套件 re-export、函式內部與 `test_shop_class.py`、`test_shop_deadlines.py`。
- `apps/web/e2e/ticket_purchase.spec.ts:1` 仍描述加入購物車、抽屜、結算頁，並尋找「加入購物車」按鈕。
- Web 的 `shop/cart/page.tsx` 是導向 `/shop` 的相容 redirect，仍有保留舊連結的用途。

建議先把 E2E 改成目前的商品登記、調整與訂單查詢流程；再決定舊 cart service 的退役範圍。
共用的價格、庫存、截止時間、訂單建立 helper 仍服務新流程，不能整段刪除 `_orders.py`。
Cart ORM／資料表若要退役，需另做資料保留與 migration；本次沒有查正式資料使用量。

## 可模組化與去重的位置

### R04 — Email 分層抽出後仍有重複實作（P2，已確認）

Python AST 比對去除函式名稱與 docstring 後，以下函式本體相同：

| Router | Service | 現況 |
| --- | --- | --- |
| `routers/email.py:607 _check_quota` | `services/email_dispatch.py:204 _check_quota` | router 版本沒有呼叫點；正式寄送走 service 版本 |
| `routers/email.py:664 _render_attachments` | `services/email_dispatch.py:224 render_attachments` | router 的試寄／重寄與 service 的 send_now 各用一份 |

建議移除無使用的 router 配額 helper，讓試寄／重寄共用 service 的附件 renderer。
`_render_requested_attachments` 的上傳者歸屬檢查、router 的批次寄送權限仍需保留。
附件 renderer 的直接呼叫者是 `_render_requested_attachments` 與 `_requeue_unsent`，
會影響試寄、樣本寄送、重寄；GitNexus 此符號為 LOW，不代表整個 Email 模組低風險。
驗收用 `test_email_routes.py`、`test_email_tasks.py`、`test_email_renderer.py`，覆蓋過期附件、
跨使用者附件、寄送配額，以及 commit 後才 enqueue 的既有語意。

### R05 — 七個頁面同時承擔太多狀態與畫面責任（P2，已確認）

| `apps/web/src/app/` 下檔案 | 行數 | `useState` 呼叫數 | 建議先抽出的邊界 |
| --- | ---: | ---: | --- |
| `(admin)/admin/public-site/page.tsx` | 2,600 | 30 | 導覽拖放、幹部名單編輯、站台設定表單 |
| `(protected)/email/page.tsx` | 2,480 | 48 | 收件人／變數表格、附件、預覽與送出；沿用 useDraftAutosave |
| `(protected)/shop/class-orders/page.tsx` | 2,223 | 49 | 查詢條件、代訂草稿、收款操作、訂單列表 |
| `(protected)/shop/page.tsx` | 1,931 | 43 | 商品瀏覽、登記編輯、目前登記查詢；沿用 shop-order-scope/items |
| `(protected)/merchandise-submissions/admin/page.tsx` | 1,922 | 20 | 審核列表、作品詳情、設定 |
| `(admin)/admin/classes/page.tsx` | 1,905 | 56 | 班級資料、幹部指派、成員、名單匯入 |
| `(protected)/shop/admin/page.tsx` | 1,888 | 86 | 分類／商品／規格編輯、上下架；沿用既有 ShopPromotionPanel |

呼叫數是整個檔案的語法出現數，包含子元件，不等於單一元件的狀態數。
先抽純資料轉換與獨立互動區塊，再整理按領域的 hook；頁面保留路由、身份與組裝責任。
不要把所有狀態整包搬進一個巨大 hook。`ui/targeting.tsx:86` 已有 useUserSearch，
新增搜尋共用邏輯前應先確認現成實作。
驗收除 Web 檢查外，需逐頁驗手機、鍵盤、載入／空／失敗狀態與原有送出行為。

### R06 — 全域 CSS 持續累加與覆寫（P2，已確認）

`app/globals.css` 有 8,536 行、216,104 bytes，並由根 layout 匯入。
另有 `design-system.css` 2,214 行、`public-design-system.css` 676 行、
`components/finance/finance.css` 2,232 行、`shop/shop-public.css` 2,583 行。

PostCSS 解析 globals 後，在相同 at-rule context 找到 39 組重複 selector。
例如 `.article-editor` 出現在第 3／3200 行；`.public-hero` 在 2221／6470；
`.btn-primary` 在 2790／6774。只有 3 組完整規則相同，其他可能是刻意補充或覆寫，不能直接去重。

建議把 tokens、通用 primitives、公開站、文章編輯器、開票動畫分別收斂，
再調整匯入位置與層疊順序。原始 CSS bytes 不是網路傳輸大小，拆檔也不保證 Next 產物變小。
需比對 build 的 CSS 產物，並在公開／登入／後台、深淺色與手機畫面做視覺回歸。

### R07 — 財務服務與 router 可依業務拆套件（P2，已確認）

`services/finance.py` 2,823 行，`routers/finance.py` 1,987 行，
同時處理帳本初始化、科目、分錄、預算、公開預算資料、報帳、採購及付款。
已有 `finance_budget_plan.py`、`finance_documents.py` 與前端財務元件可沿用。

建議先分 `ledger/journal`、`budget`、`claims/payment`、`public_queries`，
保留 `api.services.finance` 的既有匯出作遷移門面。
抽查 initialize_ledger 的直接呼叫者是 router create_ledger；修改整個模組前仍須逐符號 impact。
驗收以 `test_finance_router.py`、`test_finance_documents.py` 為起點，
包含帳本／組織範圍、借貸平衡、公開預算邊界與憑證存取。

### R08 — Shop 已拆套件，訂單檔仍集中過多責任（P2，已確認）

`services/shop/_orders.py` 2,341 行，`_promotions.py` 1,215 行，router 2,091 行。
`set_current_registration_product` 單一函式 198 行，同檔另有 cart、班級收款、序列化與統計。
其直接消費者包括 `_delegation.py` 的 set_product、update_owned_item；文字引用還需一起查 router。

先完成 R03，再把 registration、class settlement、serialization/query 各自集中。
截止日、價格、庫存、訂單範圍仍共用既有 helper；禁止為拆分複製另一套交易規則。
驗收需涵蓋 `test_shop_router.py`、`test_shop_class.py`、`test_shop_deadlines.py`、
`test_shop_delegation.py`、`test_shop_registration_totals.py`，以及現行商品登記 UI。

### R09 — 法規發布流程在 router 內過重（P2，已確認）

`routers/regulations.py` 2,166 行；`:1607 president_publish` 單一函式 330 行，
包含前版 snapshot、workflow、發布公文建立／發文、來源法規更新、audit、outbox 與 cache invalidation。
建議把發布業務編排放到 service，router 留輸入、入口權限與回應。
原有組織範圍、狀態轉移與發布條件要一起移動及保留。

GitNexus 對此 HTTP handler 為 UNKNOWN；FastAPI decorator 入口仍在，不能據此認定未使用。
驗收用 `test_regulations_router.py`、`test_regulation_service.py`、`test_regulations_cache.py`，
核對發布、禁止跨組織、無效狀態及 cache／outbox 的交易一致性。

### R10 — 正式列印混合資料、版面與資源處理（P2，HIGH）

`services/official_print.py` 2,039 行；`:585 render_document_print_html` 有 649 行。
適合按字型／資源、列印資料、文件類型版型與 PDF 輸出拆分，但列印版面需有輸出基準。

GitNexus impact 為 **HIGH**：直接影響 `routers/documents.py:print_document`、
`document/_delivery.py:_build_document_email_attachments`，往上牽動發文附件與完成發文流程。
先做不改輸出的抽取，再考慮模板化。驗收 `test_official_print.py`、發文附件相關測試，
並比較多頁公文、章戳、附件、字型與 PDF 分頁；不能只看 HTML 字串測試。

### R11 — Discord 指令可按領域拆 handler（P2，已確認）

API 的 `services/discord_commands.py:166 execute` 有 636 行；
獨立 bot 的 `commands.py` 961 行、`extended_commands.py` 512 行。
建議 API 按公文、法規、問卷、工作項目、營運指令拆分；bot 依 slash command 群組拆檔。
共用 actor／permission／audit 與固定 dispatch 入口，避免每個 handler 複製授權邏輯。

直接呼叫者是 `routers/discord_internal.py:execute_command`。GitNexus 回 LOW，
但標記 lower-bound 與 receiver typing 缺口，因此不採其風險為完整結論。
驗收 `test_discord_internal.py`、`test_document_approval_actions.py` 與領域相關測試。
獨立 bot 刻意不直接存取 DB，不應為了減少檔案把它合回 API。

## 依賴、工具與儲存

### R12 — Python 依賴所有權重複且不完整（P2，已確認／移除名單為候選）

根與 API `pyproject.toml` 有 17 個重複依賴名稱。
Redis 根宣告 `<9.0`、API `<6.0`，根註解又寫必須 `<6`；
Pillow、WeasyPrint、LINE SDK 等最低版本也不同。
API 的 pydantic-settings、S3 延遲載入的 boto3 則只在根宣告，須先釐清實際安裝依賴閉包。

AST 沒有找到 aioredis、bcrypt、passlib、coloredlogs、click、slowapi、pythonjsonlogger 的直接 import。
其中 `import redis.asyncio as aioredis` 使用的是 redis 套件，不是獨立 aioredis。
這份結果只是移除候選；CLI、plugin 與 transitive dependency 仍可能需要其中套件。

建議 API runtime 依賴由 API manifest 明確擁有，根保留 workspace 與開發工具設定。
先補齊直接依賴，再逐項移除與更新 lock；驗空環境安裝、API／Celery 啟動、相關測試與映像建置。
gunicorn 是映像啟動入口，psycopg2 是 Alembic driver，不能因沒有 Python import 就刪除。

### R13 — 根 Node 專案及 Web 部分依賴是精簡候選（P2，候選）

根 `package.json` 沒有 scripts／workspace，仍宣告 axios、Tailwind、PostCSS、PostHog、Playwright 等。
正式 Web、CI 與 Web Dockerfile 的安裝入口則使用 `apps/web/package.json`；Email MJML 另有自己的 manifest。
未找到根 axios 的程式使用點，根 Node manifest／lock 應先查是否仍供本機工具使用，再決定保留最小工具專案或退役。

Web 的 `react-spin-roulette` 沒有靜態 import 或文字使用點，可單獨做移除驗證。
`@types/qrcode` 可評估移到 devDependencies；`@opentelemetry/api` 雖無直接 import，
仍可能負責 peer dependency，不能一併當未使用套件移除。
驗收需包含所有根 scripts 的依賴解析、Web lint／型別／測試／build 與 lock 一致性。

### R14 — Shared 還保留 scaffold 與未採用的回應格式（P2，已確認引用現況）

`libs/shared/src/shared/__init__.py` 只有 hello；`schemas/common.py` 定義
SuccessResponse、ErrorResponse、PaginatedResponse 的 `{success, data}` 包裝。
目前 tracked Python 來源沒有 `shared` import，hello 也沒有呼叫點；實際 API 沿用自己的 schema。

建議移除 hello 與未採用的包裝，或明確標示 shared 為預留套件。
整個 workspace member 是否退役另行決定；不為了使用它而改現有 API 契約。
同時修正宣稱它已承擔共用 schema 的 README，並檢查 workspace／Dockerfile 的引用。

### R15 — API console script 指向不存在的 callable（P1，已重現）

`apps/api/pyproject.toml:58` 宣告 `api = "api:main"`，
但 `api/__init__.py` 刻意只有 docstring。
以 importlib.metadata.EntryPoint 載入此值，得到 `AttributeError: module 'api' has no attribute 'main'`。
現行 Web server 入口 `api.main:app` 不受此探針影響。

建議若不用 `api` 指令就移除它；若要保留，提供獨立 CLI callable。
不要在 package __init__ 匯入整個 FastAPI 來修補，避免 Celery 匯入成本回升。

### R16 — 模組產生器已脫離現行結構（P1，已確認）

`scripts/scaffold_module.sh` 會產生：

- 第 148 行：從 `api.dependencies.auth` 匯入 require_permission，現行定義在 dependencies.permissions。
- 第 149 行：從 `api.models.permission` 匯入 PermissionCode，該檔不存在；現行在 core.permission_codes。
- 第 192 行：使用不存在的 authed_client 共用 fixture；現行提供 authed_client_factory。
- 第 219 行：提示執行不存在的 `scripts/scaffold_frontend.sh`。
- migration 指引仍用根 cwd 的舊形式，應跟現行 `--directory apps/api` 入口一致。

建議先修產生器或將它退役，避免後續新增模組複製錯誤。
修復時在暫存目錄產生範例，驗證 imports、fixture、授權及 migration 指引，不在正式資料庫試跑。

### R17 — types.ts 舊重寫工具不宜留作一般入口（P2，候選）

`scripts/rewrite-types-ts.py:9` 固定讀 `/tmp/bridge_coverage.json`，並依文字格式改寫 types.ts。
目前 generate scripts、CI 與維護入口沒有呼叫它，現行 AI_WORKFLOW 也已標明它不是日常步驟。
建議退役或移入明確的歷史工具區；若仍需使用，改成顯式輸入與可預覽差異。
現行 `generate-bridge.mjs` 與手寫相容層仍需保留，不能改用全檔重寫。

### R18 — 一個根目錄字型沒有目前引用（P3，候選）

`KouzanGyoushoOTF.otf` 為 6,073,816 bytes；未找到程式、腳本、Dockerfile 使用點，
API 映像也沒有 COPY 此檔。可確認人工設計用途後移出 repository 或退役。
這只代表目前快照可減少約 6.07 MB，刪除檔案不會縮掉既有 Git 歷史。
其餘五個 bundled fonts 有列印或 OG 圖引用，不能按檔案大小批次刪除。

### R19 — 建置設定有孤立 stage 與輸出目錄排除落差（P3，已確認設定／實際體積未驗）

`apps/web/Dockerfile:4` 的 deps stage 沒有任何 `COPY --from=deps` 或衍生 stage 使用，
builder 另行 npm ci。可移除孤立 stage 讓結構清楚；不宣稱現行 BuildKit 真的重複執行兩次安裝。

`.dockerignore` 未明列 `hcca-showcase/`、`output/`、docs、瀏覽器 profile 等目前本機輸出目錄，
卻仍有特定舊稽核檔名；Git ignore 與 build context 的排除規則應分別核對。
需在 Docker 可用時量測真正送入的 context，依建置輸入建立排除規則，保留合法 PDF 模板與字型。
本次沒有 Docker，未宣稱這些目錄全部被傳送，亦未量測可節省大小。

### R20 — 監控配置有兩套有效來源（P2，已確認）

開發 Compose 掛 `observability/prometheus`／`observability/grafana`；
production 掛 `infra/prometheus`／`infra/grafana`，另掛 observability 的 alert rules。
不是可直接刪掉其中一個目錄的純備份。

Prometheus 的 worker target 名稱／port 不同；Grafana 一套明確設定 datasource uid，
另一套沒有 uid 且 tracesToLogsV2 使用不同大小寫的 datasourceUid。
建議集中共用資料源、rules、dashboard，環境差異透過小型 overlay 保留。
先盤點五份 Compose 的實際能力差異，再決定共同基底；bot 的獨立部署入口仍有用途。
驗收 Compose config、Celery consumer 拓撲、Prometheus targets 與 Grafana trace-to-log，
不能只以 YAML 可解析就認定監控運作正常。

## 文件與未完成實作

### R21 — 文件殘留包括過時地圖、營運路徑與乾淨 checkout 的缺頁（P1，已確認）

1. 本機 `apps/api/AGENTS.md`、hcca-maintenance skill 稱 services/auth、meal、meeting 已拆成套件；
   這三處已無 `.py` 來源／tracked 檔，只剩快取目錄；auth/providers 也需按來源而非目錄存在判斷。
   現行可維護套件是 document、governance、shop。
2. `docs/HANDOVER_TO_DEVELOPER.md:189` 還寫 services/document.py；
   前端目錄地圖未反映 route groups，api.ts 的說明也未反映領域 re-export。
3. `docs/OPERATIONS_GUIDE.md:68` 仍列 `/meal`、`/meal/vendor` 與完整學餐營運流程，
   與現行無獨立 meal router 的狀態不符。只能標記歷史或重寫，不能照文件補造舊功能。
4. tracked 的 `infra/README.md:7、8、29` 連向三份未追蹤的本機 docs 文件。
   本機連結檢查全部存在，但乾淨 checkout 缺少這些目標。應提供可版本化、無私密資訊的文件，
   或改連 tracked 的現行部署入口；不把整個本機 docs 強制加入 Git。
5. `scripts/check-agent-setup.py` 的 PUBLIC_DOCUMENTS 只有根、API、Web 三份 README，
   沒涵蓋 infra、observability、Discord bot 等 tracked 說明，因此現有 docs gate 綠燈不代表所有文件正確。

本機 docs 有 71 份 Markdown，維護入口、營運 SOP、ADR 與歷史報告並存。
建議保留單一文件地圖，對舊交接／營運文件加上「已取代」與替代入口；
稽核報告保留日期、commit、適用條件，避免當現況。
`.impeccable/` 的歷史設計紀錄、`pagespeed_results.md` 等先確認歷史用途後再歸檔，
不能只因舊日期、未被程式匯入或被 ignore 就認定可刪。

### R22 — 稽核鏈 S3 上傳仍是 stub（P1，已確認實作，非死碼）

`services/audit_chain_tasks.py:97 _upload_anchor_to_s3` 只有記 log 並回空字串，
docstring 明寫 stub；呼叫端卻在無例外後把 s3_status 設為 uploaded。
這是未完成能力與結果語意不一致，不是可清掉的無用函式。
應另案補實作或明確回報尚未實作，並驗成功、失敗及未設定三種情境。
本次沒有呼叫外部 S3，也沒有聲稱正式環境正在啟用此功能。

## 已排除的誤判

- 沒有普通 import 的 `audit_chain_tasks`、`backup_tasks`、`survey_tasks`、`watchdog_tasks`
  在 `core/celery_app.py` 以字串註冊與排程，仍是有效入口。
- 學餐 model 與既有資料結構是保留項目；沒有 router 不等於可直接刪表。
- `api-types.ts`、`api-bridge.ts` 是生成契約；檔案大不等於重複廢碼，本次未預讀全文。
- migrations、套件 re-export、舊 URL redirect、權限與物件歸屬檢查都有獨立責任，
  不用「瘦身」作為刪除理由。
- 原始碼、依賴、靜態資產、快取／影片與 Git 歷史是不同的空間來源，不能混算收益。

## 驗證與限制

本次實跑：

| 檢查 | 結果 |
| --- | --- |
| 任務開始 `git status --short` | 乾淨；期間另有 ignore 提交與商品展示工作，均保留 |
| GitNexus 完整重建 | 成功；綁目前工作樹；後續 status 確認涵蓋來源與 HEAD |
| query／context／impact | 已查購物、財務、Email、站台、列印、法規、Discord、班級與主題候選 |
| TypeScript import 可達性 | Web 629 個非測試 JS／TS 檔、248 個自動入口；8 個來源檔不可達，其中 1 個只被測試匯入 |
| Python AST／manifest／字面引用 | 確認兩組 Email 相同函式、17 個重複依賴、孤立 CLI 與候選引用 |
| PostCSS 規則分析 | 39 組相同 context 重複 selector，3 組完整相同規則；沒有自動刪除 |
| Markdown 目標檢查 | tracked 文件本機目標皆存在；另找出 3 個指向未追蹤檔案的連結 |
| `bash scripts/check.sh docs` | exit 0；4 個工具回歸測試通過 |
| Web `check:module-registry` | exit 0；20 個模組 ID 對齊 |
| `python3 scripts/validate-celery-topology.py` | exit 0；四份 Compose 的宣告 queue 均有 consumer |
| `bash scripts/check.sh doctor` | exit 1；Codex CLI 與 Docker 環境探針失敗，其他列出的基礎工具可用 |
| 提交前 `bash scripts/check.sh graph` | exit 0；全工作樹含其他工作的商品修改，回 HIGH／10 個流程，不歸入本次修改 |
| 隔離 Git index，僅納入本報告的 staged detect-changes | exit 0；1 個檔案、30 個 Markdown section、0 個流程、low；不動其他工作 stage |
| `git diff --check` 與報告內容／引用抽查 | 通過；22 個唯一項目，抽查的 source／test 路徑存在 |

GitNexus 重建對流程產生仍有採樣／深度截斷警告及跨語言、receiver typing 缺口。
因此 impact 為 UNKNOWN、沒有 caller 或沒有命中流程都不作安全刪除證明；
本報告補上 source、decorator、排程、文字引用與測試入口。
本次 detect-changes 可以辨識 Markdown section，但不代表已驗證文件指令與應用行為；
未收錄的文件／設定影響仍屬 UNKNOWN，依引用與格式檢查補查。

本次未跑完整 API pytest、migration、Web 全套測試／build、瀏覽器流程、正式流量與映像體積量測：
交付物只有盤點文件，沒有應用程式行為變更；資料庫與正式功能現況不在本次驗證結論內。
後續真正實作時，必須依各項驗收與專案驗證矩陣重跑，不能沿用本報告作為回歸通過證據。
