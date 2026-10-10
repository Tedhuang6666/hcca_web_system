# 商品預購系統介面與邏輯盤點

盤點日期：2026-10-10（Asia/Taipei）。程式基準：`3e79f7e9`。
本文件是現況盤點與改造規格；功能尚未依此重寫。證據來自目前程式、GitNexus、
既有前端測試及本機瀏覽器的合成資料。未查詢正式訂購資料或執行資料合併。

## 已確認的目標

一般使用者只需選活動、選商品規格、設定數量，隨時看到自己的完整預購及待繳金額。
班代以「活動 × 班級名單」為工作中心，在同一張名單修改數量、登記收款與領取。
保留班代代收款、繳回班聯及領取紀錄；不再要求使用者理解訂單、分單或訂單狀態。

核心不變量：**每位使用者在每個預購活動只有一份有效預購紀錄**。
同商品同規格只顯示目前總數量，追加與減量都更新這份紀錄。
操作歷程及金流紀錄分開保存，不以新增另一張訂單代替歷程。

## 主要結論

目前共六個商品功能頁、一個購物車相容轉址，以及 52 個 `/shop` HTTP 端點。
學生主清單已把訂單合併顯示，但建立、修改、收款、統計、匯出及跨模組關聯仍以訂單為中心。
再調整文案或摺疊訂單明細，無法達到本次目標。

| 優先度 | 現況及直接證據 | 對使用者的影響 | 改造方式 |
| --- | --- | --- | --- |
| P0 | `create_direct_order()` 每次代訂都新增訂單，沒有依人與活動更新既有紀錄 | 同活動追加後產生多筆，班代必須處理合併、修改哪筆及逐筆收款 | 自購與代訂共用同一個預購更新服務及唯一鍵 |
| P0 | `get_current_registration()` 只取最新一筆；商品頁也只用 `registrations.find()` | 商品頁與我的預購顯示不同的數量 | 讀取完整的活動預購，移除 latest-order 選擇 |
| P0 | 商品頁以 `registrations.length` 顯示「幾個活動」 | 同活動兩筆會顯示「2 個活動」 | 依活動唯一紀錄回應；過渡期至少依活動 ID 去重 |
| P0 | 收款只有 `is_class_collected`、正式繳費只有 `is_paid` | 補收靠新增未收款訂單；無法表達同份預購內的部分收款 | 保存收款、退款及繳回金額，畫面依差額顯示下一步 |
| P0 | 已收款或已確認的訂單禁止自購修改、代訂修改與取消 | 要改數量需撤銷收款或追加另一筆訂單 | 數量與金流分離；開放期間更新數量，已收金額保持不變 |
| P0 | `Order` 沒有 `(activity_id, user_id)` 唯一限制；活動 ID 可為空 | 規則靠部分服務維持，其他建立入口仍可重複 | 明確定義預購活動 ID，完成舊資料歸戶後建立 DB 唯一約束 |
| P1 | 公開框架 `ShopWorkspaceNavigation` 顯示所有有權限的角色入口 | 同一人多角色時像後台功能目錄，手機再分角色與子入口兩層 | 公開頁保留商品瀏覽；工作頁只顯示目前任務及一個角色切換 |
| P1 | 班代分為收款、代訂、明細；代訂還有商品清單、待送出清單 | 修改同學預購需離開名單，重新選人與商品 | 名單每列直接展開數量編輯；保留班級、活動、搜尋及捲動位置 |
| P1 | 班聯總覽與商品後台統計重複呈現訂單數／繳費狀態 | 需要理解兩套統計入口，且訂單數不等於訂購人數 | 統一成活動統籌的班級款項、商品數量、預購名冊 |
| P1 | 結單儲存在分類 × 班級，活動內逐分類呼叫 | 可出現同活動部分分類已結單、部分未結單 | 以活動 × 班級一次設定停止修改，商品分類只做瀏覽用途 |
| P1 | 目前只有「依活動通知領取」文案，沒有領取數量、時間與經手人欄位／端點 | 班代無法完成使用者要求的領取記錄 | 增加預購品項領取紀錄，主名單提供一鍵全部領取 |

證據入口：[預購服務](../../apps/api/src/api/services/shop/_orders.py)、
[商品頁](../../apps/web/src/app/(protected)/shop/page.tsx)、
[預購模型](../../apps/api/src/api/models/shop.py)。上述不一致已用合成資料在瀏覽器確認，
不是從正式資料推估。公開頁的班代／班聯入口有權限過濾，問題是資訊層級與擺放位置，
不代表匿名訪客取得管理權限。

## 全部頁面與頁內操作

| URL／介面 | 現有操作與邏輯 | 建議去向 |
| --- | --- | --- |
| `/` 商品區塊 | 公開首頁載入 catalog，以商品卡連至 `/shop?product=…` | 保留商品或活動宣傳入口，直接開正確活動與商品，不列管理工具 |
| `/shop` | 公開活動分類、系列篩選、商品卡；商品 Modal 選規格／數量即時儲存；班級更正、優惠、我的預購捷徑 | 活動選擇＋商品＋自己的預購摘要；同頁修改／移除，不需再進入訂單資訊 |
| `/shop?product=…` | 定位分類後開啟商品 Modal；未登入可看商品，登入帶 next 返回 | 保留分享連結及登入返回，補足穩定活動定位 |
| `/shop/cart` | 只有 `redirect('/shop')`；現行 HTTP 購物車／結帳路由已移除 | 保留舊連結轉址；清掉殘留購物車服務、schema、表及測試中的舊流程 |
| `/shop/orders` | 全部個人訂單分頁取回後前端合併活動；顯示品項、已繳、待補繳；多筆時展開登記資訊 | 合併到活動頁的「我的預購」；如保留跨活動查詢，只列活動摘要，點回活動 |
| `/shop/orders/[id]` | 訂單字號、狀態、雙層付款、備註、逐品項修改連結及票券劃位 | 退出一般預購主流程；舊連結轉至該人的活動預購；票券功能需另外承接 |
| `/shop/class-orders` 收款 | 活動／座號名單前端合併訂單；一個收款按鈕發出多個 PATCH；補收、撤銷收款、代訂 | 成為班代唯一主工作區；同一列修改數量、收款、領取，操作以一份預購為單位 |
| 同頁代訂 | 選同學→商品→規格→數量→加入清單→送出；可先加入待送出再換下一位；失敗保留未成功草稿 | 名單展開編輯目前數量；桌機可切換商品欄位批量輸入，手機保留直向名單 |
| 同頁明細 | 商品收款彙總、逐訂單表、字號／姓名搜尋、來源／狀態篩選、勾選逐筆收款、修改與取消 Modal | 品項統計成次要摘要；刪除訂單表與逐筆操作，歷程放在同學列的次要入口 |
| 同頁結單 | 活動分組顯示，但實際逐分類關閉／重開；可能部分成功 | 活動及班級的單一操作，明確顯示是否仍可修改及截止時間 |
| `/shop/council-orders` | 班級繳款／商品總量／查找訂單三頁籤；多項進階篩選；整班逐活動設正式繳費；逐分類結單；Excel 匯出 | 保留班聯統籌：班級繳回金額與差額、商品總量、預購名冊；查人不查訂單字號 |
| `/shop/admin` 商品目錄 | 主題→系列→商品→規格群組→選項；商品可直接隸屬主題；圖片、媒體、複製規格、上／下架、庫存、限購、期限、劃位及分享連結 | 活動→商品即可完成設定；分類與系列改選填篩選，規格與照片在商品內完成 |
| 同頁優惠 | 自動優惠、優惠碼、指定帳號／商品、金額／件數門檻、指定單價、公開性、期限及使用次數 | 保留必要優惠；學生只看套用結果與次要優惠碼輸入，班代操作不再背另一套流程 |
| 同頁統計 | 年級／班級／個人、商品、狀態、日期及付款篩選，呈現訂單數／件數／金額 | 併入班聯統籌，改計人數與商品數量 |
| 同頁清除全部訂購資料 | 不可逆刪除訂單及衍生資料，回補庫存與優惠次數 | 退出日常操作；一般重訂購改數量或活動封存，保留歷史 |
| layout／loading／error | 公開框架與平台框架切換，角色導覽、權限載入／拒絕、錯誤重試及骨架 | 保留權限與重試；統一工作區導航，不再由公開頁排全部管理入口 |

主要來源：[商品 layout](../../apps/web/src/app/(protected)/shop/layout.tsx)、
[我的預購](../../apps/web/src/app/(protected)/shop/orders/page.tsx)、
[訂單詳情](../../apps/web/src/app/(protected)/shop/orders/[id]/page.tsx)、
[班代工作區](../../apps/web/src/app/(protected)/shop/class-orders/page.tsx)、
[班聯總覽](../../apps/web/src/app/(protected)/shop/council-orders/page.tsx)、
[商品後台](../../apps/web/src/app/(protected)/shop/admin/page.tsx)。

## 各角色應有的操作路徑

### 一般使用者

從活動連結進來，直接看本活動商品及自己已登記的數量。單一活動不再要求選活動；
無規格商品直接調數量，有規格商品展開規格。數量顯示「目前共幾件」，不以「追加幾件」
要求使用者自行計算；0 表示移除該品項。

同頁的「我的預購」列完整品項、應繳、已交班代、待補繳及領取進度。
數量修改成功顯示已儲存與新的合計，失敗保留輸入並可重試；重新進入仍讀同一份紀錄。
金額按活動算，班聯尚未確認繳回不再讓已向班代繳費的人誤以為仍欠款。
手機縮小標題與班級說明的高度，把可操作商品放進首屏；主操作保持至少 44px。

### 班代

儀表板／主選單直接進入自己的班級預購名單；活動是唯一必要上下文。
只有一班或一個活動時直接選定，多班才顯示班級切換。搜尋座號／姓名後操作該列：

| 座號／姓名 | 商品與規格、目前數量 | 應收／已收／待補收 | 領取進度 | 操作 |
| --- | --- | --- | --- | --- |
| 01 示範同學 | 上衣 M × 2 | 600／300／300 | 0／2 | 修改數量、收剩餘 300、全部領取 |
| 02 示範同學 | 尚未預購 | 0／0／0 | 無品項 | 登記數量 |

點「修改數量」在該列或同頁抽屜編輯；沿用目前活動、班級、同學及既有品項。
一般品項可直接輸入總數量，完成後仍留在名單原位置。
取消某品項設 0；已收款減量會標示待退額，不默默清掉收款紀錄。
桌機提供商品欄位模式方便整班輸入，手機每人一列並展開規格，避免水平捲動大表。

「收剩餘款」預填差額、一次保存；需要部分收款時展開金額欄位。
已收、撤銷及退款有經手人／時間／金額歷程；撤銷以反向紀錄處理，不覆寫舊紀錄。
整班狀態可看未登記、待收、待補收、待領取；不要以訂單來源或訂單狀態當主要篩選。

班級摘要顯示總數量、已代收、已繳回、待繳回；「登記繳回」就在同工作區的摘要內。
班聯確認實收金額後記錄繳回完成，確認期間新增收款仍留在待繳回差額。
若需單據，附在該次繳回紀錄，不要求另開訂單。

領取預設一鍵「全部領取」，複雜情況才展開各品項已領數量；防止領取超過預購數量。
分批領取、追加後待領、撤銷錯誤領取都更新同份預購與領取歷程。

### 班聯／活動統籌

直接進入活動，預設看各班已代收、申報繳回、實際確認、待繳回及領取進度。
商品總量列商品／規格的預購數量、已領及待領；名冊以人為單位，匯出能用來核對與發放。
活動設定是次要工具，包含開放時間、截止、商品與優惠；不與學生購買入口並排展示。

導覽結構建議：公開站「商品預購」→活動商品頁；登入後「我的預購」、
符合身份的「班級預購」及「活動統籌」直接可達。多角色帳號可切換工作區，
只顯示目前角色的主要操作；切換角色保留活動上下文，不複製多排入口。
保留現有米白／金色設計系統，把改善重點放在密度、層級與操作位置。

## 必須一起改的業務與資料規則

| 邏輯 | 現況 | 新規則與保留項目 |
| --- | --- | --- |
| 活動歸戶 | `activity_id` 優先；空值時 `category:<id>`；空活動又可能回到一般商品 | 每份預購有穩定、不可為空的預購活動 ID；未綁平台 Activity 的主題也明確歸成預購活動，不合進所有一般商品 |
| 商品目錄 | 主題、系列、商品、規格；分類可綁平台 Activity | 分類與系列只用於找商品，不決定如何分單；一商品隸屬一個預購活動 |
| 建立／更新 | 自購更新最新 Order，代訂另建 Order；修改代訂還建立暫時 Order 再搬明細 | 同一服務設定目標使用者的活動預購總數；姓名與操作者不同時記錄代訂人，不產第二份預購 |
| 唯一性／重試 | 沒有活動 × 人唯一約束；代訂 POST 重送可再新增 | DB 唯一鍵及冪等寫入；收款／領取／繳回操作有獨立冪等鍵，網路重送不重複記金額／數量 |
| 並發修改 | 自購鎖 User、Product；代訂與逐筆替換另有路徑 | 統一鎖定順序並提供版本衝突回應；學生與班代同時修改時提示重新確認，不默默覆寫 |
| 金額 | 多張訂單加總；歷史單價與優惠快照；布林支付狀態 | 應收依預購及定價規則計算；收款、退款、繳回分離，已收金額不隨追加數量重算 |
| 收款／繳回 | 班代只是備忘，正式入帳由班聯設 `is_paid`；整班確認會更新該活動全部有效單 | 保留兩種事實：向學生收到多少、班聯實際收到多少；繳回確認針對金額快照，不把尚未收款的追加一起算已繳 |
| 領取 | 目前缺少獨立資料 | 按預購品項保存已領數量與歷程；追加增加待領，減量不得小於已領，需走有原因的更正 |
| 截止／結單 | 商品期限、平台活動狀態、分類 × 班級關閉共同判定 | 活動開放／截止及班級停止修改有統一狀態；收款與領取仍可在截止後完成，特殊更正需授權與原因 |
| 庫存／限購 | 有不限量預設，也支援庫存保留、售完、每人上限 | 預購預設不限量；保留確實需要的上限，依總數量驗證；調整數量只更新差額，合併舊資料不可再次扣庫存 |
| 優惠 | 百分比／固定額／指定單價；帳號、商品、件數、金額、次數及活動限制；自動優惠可與碼疊加 | 整份活動預購計門檻，不受代訂與自購次數影響；使用次數以同份預購計，保留指定帳號隔離與既有金額快照 |
| 取消／退款 | 取消整筆訂單及回補庫存；財務應收另有退款 API | 取消商品是數量改為 0；金錢退款獨立紀錄；已領取後退訂需經更正流程，不能直接消失 |
| 統計 | 人、活動、商品、班級等篩選仍計 `order_count` | 計訂購人數、商品／規格數量及各種金額；個人、班級、班聯與匯出使用同一資料來源 |
| 權限 | router 身份／權限及物件範圍；班代任職班級、活動總召範圍 | 保留本人、本班及活動管理範圍；簡化 UI 不能刪這些檢查，班代不得操作他班或正式班聯確認 |
| 班級異動 | 支援學籍名冊與歸戶更正，訂單保留班級快照 | 既有預購與金流的班級歸屬不能跟轉班默默移動；有款項者需明確移轉與可追查紀錄 |

概念資料結構：`預購活動 → 個人預購 → 商品／規格／總數量`，以及個人預購的
收款／退款／領取歷程、活動 × 班級的繳回紀錄。內部 ID 與歷史映射仍可存在，
不再出現在學生／班代主畫面，也不再承擔「一人同活動可開多單」的業務語意。
實作時決定沿用平台 Activity 或建立輕量預購活動；必要條件是所有主題都有穩定歸戶，
不能為省欄位把未綁活動的不同預購混在一起。

## 跨模組與舊連結

| 位置 | 既有依賴 | 改造必須處理 |
| --- | --- | --- |
| [財務應收](../../apps/api/src/api/services/receivable.py)、`/finance/receivables` | `source_type=shop_order`、`source_id=Order.id`；同步正式已繳／退款金額 | 更新來源映射與金額同步，避免合併後重複應收或丟失退款；班代收款不等同班聯入帳 |
| [劃位](../../apps/api/src/api/services/seating.py)、`/seating/[zoneId]`、`/seating/admin/[productId]` | `order_id`、`order_item_id`、票數配額；返回訂單詳情 | 票券與實體商品區分操作；若票券仍使用本模組，移轉至預購品項 ID 或保持歷史相容，不能刪掉已劃座位 |
| [報表](../../apps/api/src/api/services/shop/_export.py) | 一列訂單品項，包含字號與整單金額；缺少名冊發放所需的姓名／座號／規格等欄位 | 輸出活動、班級、座號、姓名、商品、規格、數量及款項／領取摘要；整份總額不能逐品項重複加總 |
| [Outbox](../../apps/api/src/api/services/outbox.py)、[Discord 通知](../../apps/api/src/api/services/discord_bot.py) | `shop.order_confirmed`、`/shop/orders` 或訂單 ID 連結 | 改活動預購連結；舊通知仍能到正確資料；數量增減不每次寄新的「訂單確認」 |
| [即時事件](../../apps/api/src/api/services/realtime_events.py) | `order.updated`，包含使用者／班級房間與 order ID | 活動預購更新後同步名單和個人預購；維持房間授權，不跨班廣播個人明細 |
| [到期待辦](../../apps/api/src/api/services/shop_tasks.py)、[工作入口](../../apps/api/src/api/services/task_inbox.py) | 商品到期、訂單數統計、商品後台連結 | 改以活動預購人數／待辦及直接工作區連結，不依訂單筆數判斷工作量 |
| [治理事件](../../apps/api/src/api/services/governance_events.py)、ActivityLink | `shop_order`／`order` 類型及舊 ID | 保留舊映射、追查與既有事件連結 |
| [資料生命週期](../../apps/api/src/api/services/data_lifecycle.py)、[個資匯出](../../apps/api/src/api/services/privacy.py) | 舊 Order 類型、取消狀態及使用者資料匯出 | 改保留與匯出規則，不把新金流／領取紀錄遺漏或提前清理 |
| 導覽／分享／麵包屑／通知偏好／Line | `/shop`、`/shop/orders`、`/shop/class-orders`；「購票」「訂單」「我的登記」等舊稱呼 | 統一預購用語與入口，保留舊 URL 導向，修正 `?from=council` 目前返回個人預購的問題 |
| `/merchandise-submissions` 及其 admin | 校商投稿／審核是獨立領域，出現在同一校園服務導覽 | 不與預購混成一個操作流程；主工作區不需要展示投稿工具 |

## GitNexus 影響證據與限制

MCP `list_repos` 確認同名索引有兩筆；本次綁定 WSL `/home/ted98/projects/main`，
CLI 全部帶 `--repo .`。首次 status 發現內容過時，依專案完整重建入口更新。
期間另有既有商品 API 修改提交為 `3e79f7e9`，已保留並重建至此基準；最後 status
顯示 indexed commit 與 HEAD 相同、covered files 內容一致。

| 目標 | 工具回應 | 補查後的直接呼叫與影響 |
| --- | --- | --- |
| `Order`（限定 `models/shop.py`） | MEDIUM，59 個 upstream 項目、13 個直接 import；lower-bound | 商品、schema、財務、劃位、匯出、背景與生命週期等；不是可整批刪除的孤立資料表 |
| `get_current_registration`（限定 service） | LOW，兩個直接 callers | `apply_registration_promotion`、`set_current_registration_product`；文字補查還有 router 的取得與優惠預覽入口 |
| `set_current_registration_product` | UNKNOWN，未解析 upstream callers；context 可解析庫存、限購、優惠及應收依賴 | router `update_current_registration_product` → service；商品 Modal → `shopApi.setCurrentRegistrationProduct` → PUT |
| `create_direct_order` | UNKNOWN，未解析 upstream callers | router `create_class_order` → service；班代 `submitOrder` → `shopApi.createClassOrder` → POST；另有 DB 測試呼叫 |
| `checkout` | UNKNOWN | 文字查詢只找到 service exports／既有 DB 測試，現行 router 沒有 cart／checkout 端點；仍用 `CartItem` 作代訂的內部資料載體 |

圖譜 query 未回傳完整流程，重建也有 parser candidate cap 及全庫流程擷取上限警告。
因此零 callers 或零流程不代表無影響，跨語言 HTTP／service re-export 以原始碼與測試補查。
此盤點的工程判斷：唯一性與讀寫是 P0；金流、舊資料合併、劃位及轉班移轉屬於較高影響，
實作前仍須對當時版本的被改符號重跑 impact，不能把本報告的 LOW 當整個改造低風險。

## 改造次序與驗收

1. 先統一預購活動與個人預購的讀寫服務，讓自購、班代代訂、追加、減量及重試共用同一紀錄。
2. 新 migration 按人／活動歸戶舊資料；保留單價、優惠、收款、正式入帳、退款、座位及舊 ID 映射。
   已收、已入帳、已退款及已劃位資料不可直接刪除或重新扣庫存；歸戶不明與價格政策衝突列入人工處理。
   在明確的測試 PostgreSQL 驗證回填前後的人數、各品項數量、庫存及款項守恆；不修改已套用歷史 migration。
3. 建立唯一約束、收款／繳回／領取紀錄及並發版本，修改 API 契約並重建 OpenAPI 與前端型別。
4. 改一般使用者活動頁及班代名單，移除訂單詳情、逐筆建立／收款／取消與多層代訂流程。
5. 更新班聯統計、報表、通知、劃位及舊連結；確認無消費者後移除購物車持久化與舊服務。

以上是交付次序，同一版本上線前必須讓寫入、回填與舊呼叫端相容；
不允許過渡期間仍由舊 POST 入口持續產生重複紀錄。

| 驗收情境 | 預期結果 |
| --- | --- |
| 自購 1 件後班代改成 2 件，刷新與重新登入 | 同一活動一份紀錄、總數量 2，商品頁／個人頁／班級名單／匯出一致 |
| 同一寫入因斷線重送；兩人同時編輯 | 不重複建立，不重複收款／領取；版本衝突有清楚回應 |
| 已收 300 元後增加到應收 600 元 | 仍是一份預購，已收維持 300，待補收 300 |
| 班代只收到 200 元或誤記後撤銷 | 保存實際金額及修正歷程，差額正確，不要求分成不同訂單 |
| 減量低於已收金額 | 顯示待退金額，退款後保留歷程；不把餘額誤算成零或負的待收 |
| 班代申報繳回 500 元後又收到 100 元 | 班聯只確認該次 500，追加 100 仍待繳回；不整班無條件標全部已繳 |
| 一人預購 2 件，先領 1 件，再追加 1 件 | 總預購 3、已領 1、待領 2；不能因追加重設領取進度 |
| 截止／班級停止修改後 | 阻止一般數量變更，但允許應有收款、繳回、領取；例外更正遵守範圍與原因 |
| 兩活動同名商品、未綁平台活動、商品移分類或轉班 | 預購／款項／領取保持正確活動與班級，不依目前分類猜歷史 |
| 未登入、非本人、他班班代、非活動管理者 | 對應 401／403／404；UI 隱藏不能取代後端範圍驗證 |
| 手機、鍵盤、空名冊、未預購、載入失敗、部分批次失敗 | 可直接找到下一步；錯誤保留輸入及上下文，批次結果按同學列回報 |

## 本次實跑證據

- 相關前端 Vitest：5 檔、19 個測試通過。執行目錄 `apps/web`：
  `node node_modules/vitest/vitest.mjs run src/lib/shop-preorders.test.ts src/lib/shop-order-items.test.ts src/components/shop/OrdersPage.test.tsx src/components/shop/ClassOrdersPage.test.tsx src/lib/api/shop.test.ts`。
  最初從根目錄用 npm exec 執行因未載入 Web alias 設定而失敗，改用正確 cwd 後通過。
  這證明目前合併顯示／草稿等既有行為，尚不代表新的一人一活動規則成立。
- 本機 Next dev + Playwright Chrome，1440×1000／390×844，使用合成 API、名冊及身份，
  觀察商品頁、我的預購、班代名單及訂單詳情。確認同活動兩筆造成「2 個活動」、
  商品卡 1 件而活動合併 2 件，以及公開／平台框架切換與多層入口。
  截圖與可重現腳本在 `output/playwright/shop-inventory-20261010/`（本機驗證產物，不納入提交）。
  初次 fixture 欠缺 `product_rows` 造成錯誤頁，已修正；另一次等待桌機表格時仍在手機 viewport，
  改成桌機 viewport 後完成。console 出現 caret style 相關的 hydration 訊息及初次未攔截的 WS 403；成因未完全隔離，
  不判作商品業務缺陷，也不宣稱瀏覽器全流程通過。
- `bash scripts/check.sh doctor`：exit 1，Codex CLI 與 Docker 環境項失敗；Git、Python、uv、
  Node、npm、Web TypeScript 與 GitNexus 入口可用。本次可完成來源盤點與本機畫面觀察。
- `bash scripts/check.sh docs`：exit 0，入口／連結／設定檢查、4 個腳本測試及 shell 語法檢查通過。
  本報告的 20 個檔案連結另逐一確認存在；52 個 HTTP 項目與 router AST 完全一致。
- 提交前 `bash scripts/check.sh graph`：exit 0，涵蓋 2 個文件；辨識 README 的 2 個 section，
  沒有 partial／truncated 回應。新增盤點文件尚無圖譜符號映射，按 UNKNOWN 處理，
  已以上述連結與 AST 核對補查；不據此宣稱未來業務重構低風險。
- `git diff --check` 及 staged diff whitespace 檢查通過，stage 僅 README 與本報告。
- 未執行完整 Web lint／coverage／build、API DB 測試、migration upgrade／drift；
  本次只提交盤點文件，尚未修改業務或 schema。未驗證真實收款／繳回／領取或正式瀏覽器身份流程。

## HTTP 介面完整清單

以下由目前 router 的 Python AST 列出，路徑包含 `/shop` prefix。
保留的 catalog、商品、規格與優惠操作應服務新預購模型；`orders` 主流程需整合／退出，
分類結單需改活動層級。端點存在不代表每個角色可調用，仍以 router 與 service 授權為準。

| Method | Path | Handler |
| --- | --- | --- |
| `POST` | `/shop/images` | `upload_image` |
| `GET` | `/shop/categories` | `list_categories` |
| `GET` | `/shop/activities` | `list_shop_activities` |
| `POST` | `/shop/categories` | `create_category` |
| `PATCH` | `/shop/categories/{category_id}` | `update_category` |
| `DELETE` | `/shop/categories/{category_id}` | `delete_category` |
| `GET` | `/shop/series` | `list_series` |
| `POST` | `/shop/series` | `create_series` |
| `PATCH` | `/shop/series/{series_id}` | `update_series` |
| `DELETE` | `/shop/series/{series_id}` | `delete_series` |
| `GET` | `/shop/catalog` | `get_catalog` |
| `GET` | `/shop/products` | `list_products` |
| `GET` | `/shop/products/{product_id}` | `get_product` |
| `GET` | `/shop/promotions` | `list_promotions` |
| `GET` | `/shop/promotions/available` | `list_available_promotions` |
| `POST` | `/shop/promotions` | `create_promotion` |
| `PATCH` | `/shop/promotions/{promotion_id}` | `update_promotion` |
| `DELETE` | `/shop/promotions/{promotion_id}` | `delete_promotion` |
| `POST` | `/shop/products` | `create_product` |
| `PATCH` | `/shop/products/{product_id}` | `update_product` |
| `POST` | `/shop/products/{product_id}/activate` | `activate_product` |
| `POST` | `/shop/products/{product_id}/deactivate` | `deactivate_product` |
| `DELETE` | `/shop/products/{product_id}` | `delete_product` |
| `POST` | `/shop/products/{product_id}/variant-groups` | `add_variant_group` |
| `PATCH` | `/shop/variant-groups/{group_id}` | `update_variant_group` |
| `DELETE` | `/shop/variant-groups/{group_id}` | `delete_variant_group` |
| `POST` | `/shop/variant-groups/{group_id}/options` | `add_variant_option` |
| `PATCH` | `/shop/variant-options/{option_id}` | `update_variant_option` |
| `DELETE` | `/shop/variant-options/{option_id}` | `delete_variant_option` |
| `GET` | `/shop/registrations` | `list_current_registrations` |
| `GET` | `/shop/registrations/current` | `get_current_registration` |
| `POST` | `/shop/registrations/current/promotion/preview` | `preview_current_registration_promotion` |
| `PUT` | `/shop/registrations/current/promotion` | `apply_current_registration_promotion` |
| `PUT` | `/shop/registrations/current/products/{product_id}` | `update_current_registration_product` |
| `GET` | `/shop/orders` | `list_orders` |
| `GET` | `/shop/orders/class` | `list_class_orders` |
| `GET` | `/shop/orders/class/summary` | `class_order_summary` |
| `POST` | `/shop/orders/class` | `create_class_order` |
| `DELETE` | `/shop/orders` | `clear_all_order_data` |
| `GET` | `/shop/orders/summary` | `order_summary` |
| `GET` | `/shop/orders/quantities` | `order_quantities` |
| `GET` | `/shop/orders/{order_id}` | `get_order` |
| `POST` | `/shop/orders/{order_id}/cancel` | `cancel_order` |
| `PATCH` | `/shop/orders/{order_id}` | `update_order_items` |
| `PATCH` | `/shop/orders/{order_id}/collection` | `update_class_collection` |
| `PATCH` | `/shop/orders/classes/{class_id}/payment` | `update_class_payment` |
| `PATCH` | `/shop/orders/{order_id}/payment` | `update_order_payment` |
| `GET` | `/shop/reports/orders.xlsx` | `export_orders_excel` |
| `GET` | `/shop/reports/orders.csv` | `export_orders_csv` |
| `POST` | `/shop/categories/{category_id}/close` | `close_category` |
| `DELETE` | `/shop/categories/{category_id}/close` | `reopen_category` |
| `GET` | `/shop/close-status` | `get_close_status` |
