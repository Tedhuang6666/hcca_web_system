# 全站頁面與 API 清冊

清冊基準：180 個 page.tsx、75 個 Router 檔案、1,104 個 HTTP＋4 個 WebSocket 宣告。

「正式站已訪問」只代表記錄了匿名頁面／導向，不代表完成所有表單與登入後操作。路由群組與 use client 均不等於權限判定。詳細 API 宣告、參數與 decorator 原文見 [route-inventory.json](route-inventory.json)。

## 頁面

| 路徑 | 群組 | 入口 | 正式站覆蓋 | 原始碼 |
|---|---|---|---|---|
| `/admin/activities` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/activities/page.tsx>) |
| `/admin/api-keys` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/api-keys/page.tsx>) |
| `/admin/cadre-import` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/cadre-import/page.tsx>) |
| `/admin/calendar/google` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/calendar/google/page.tsx>) |
| `/admin/classes` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/classes/page.tsx>) |
| `/admin/data-lifecycle` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/data-lifecycle/page.tsx>) |
| `/admin/diagnostics` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/diagnostics/page.tsx>) |
| `/admin/discord` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/discord/page.tsx>) |
| `/admin/elections/[id]/count` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/elections/[id]/count/page.tsx>) |
| `/admin/elections/new` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/elections/new/page.tsx>) |
| `/admin/elections` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/elections/page.tsx>) |
| `/admin/feature-flags` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/feature-flags/page.tsx>) |
| `/admin/impersonation` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/impersonation/page.tsx>) |
| `/admin/inventory/items` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/inventory/items/page.tsx>) |
| `/admin/inventory` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/inventory/page.tsx>) |
| `/admin/inventory/procurement` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/inventory/procurement/page.tsx>) |
| `/admin/inventory/transactions` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/inventory/transactions/page.tsx>) |
| `/admin/loans/checkout` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/loans/checkout/page.tsx>) |
| `/admin/loans` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/loans/page.tsx>) |
| `/admin/loans/records` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/loans/records/page.tsx>) |
| `/admin/modules` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/modules/page.tsx>) |
| `/admin/navigation-profiles` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/navigation-profiles/page.tsx>) |
| `/admin` | (admin) | client | 已訪問；導向 /login?next=%2Fadmin | [page.tsx](<../../../apps/web/src/app/(admin)/admin/page.tsx>) |
| `/admin/people` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/people/page.tsx>) |
| `/admin/permissions` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/permissions/page.tsx>) |
| `/admin/permissions/positions/new` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/permissions/positions/new/page.tsx>) |
| `/admin/policies` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/policies/page.tsx>) |
| `/admin/privacy` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/privacy/page.tsx>) |
| `/admin/public-site` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/public-site/page.tsx>) |
| `/admin/raffle` | (admin) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/raffle/page.tsx>) |
| `/admin/reports` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/reports/page.tsx>) |
| `/admin/settings` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/settings/page.tsx>) |
| `/admin/support` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/support/page.tsx>) |
| `/admin/system/observability` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/system/observability/page.tsx>) |
| `/admin/system` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/system/page.tsx>) |
| `/admin/term-rollover` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/term-rollover/page.tsx>) |
| `/admin/trash` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/trash/page.tsx>) |
| `/admin/user-lifecycle` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/user-lifecycle/page.tsx>) |
| `/admin/users` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/users/page.tsx>) |
| `/admin/webhooks` | (admin) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(admin)/admin/webhooks/page.tsx>) |
| `/activities/[id]` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/activities/[id]/page.tsx>) |
| `/analytics` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/analytics/page.tsx>) |
| `/announcements/[id]/edit` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/announcements/[id]/edit/page.tsx>) |
| `/announcements/new` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/announcements/new/page.tsx>) |
| `/audit-logs` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/audit-logs/page.tsx>) |
| `/backoffice` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/backoffice/page.tsx>) |
| `/calendar` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/calendar/page.tsx>) |
| `/council-proposals` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/council-proposals/page.tsx>) |
| `/credential` | (protected) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/credential/page.tsx>) |
| `/dashboard` | (protected) | server | 已訪問；導向 /login?next=%2Fdashboard | [page.tsx](<../../../apps/web/src/app/(protected)/dashboard/page.tsx>) |
| `/document-templates` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/document-templates/page.tsx>) |
| `/documents/[id]/edit` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/documents/[id]/edit/page.tsx>) |
| `/documents/delegations` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/documents/delegations/page.tsx>) |
| `/documents/new` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/documents/new/page.tsx>) |
| `/email/analytics` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/email/analytics/page.tsx>) |
| `/email/lists` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/email/lists/page.tsx>) |
| `/email/logs` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/email/logs/page.tsx>) |
| `/email` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/email/page.tsx>) |
| `/email/templates` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/email/templates/page.tsx>) |
| `/exam-papers/admin` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/exam-papers/admin/page.tsx>) |
| `/exam-papers` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/exam-papers/page.tsx>) |
| `/finance` | (protected) | client | 已訪問；導向 /login?next=%2Ffinance | [page.tsx](<../../../apps/web/src/app/(protected)/finance/page.tsx>) |
| `/finance/receivables` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/finance/receivables/page.tsx>) |
| `/governance/[id]` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/governance/[id]/page.tsx>) |
| `/governance` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/governance/page.tsx>) |
| `/judicial-petitions` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/judicial-petitions/page.tsx>) |
| `/matters/[id]` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/matters/[id]/page.tsx>) |
| `/matters` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/matters/page.tsx>) |
| `/meal/orders` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/meal/orders/page.tsx>) |
| `/meal` | (protected) | client | 已訪問；導向 /login?next=%2Fmeal | [page.tsx](<../../../apps/web/src/app/(protected)/meal/page.tsx>) |
| `/meal/vendor` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/meal/vendor/page.tsx>) |
| `/meetings/[id]/control` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/meetings/[id]/control/page.tsx>) |
| `/meetings/[id]/edit` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/meetings/[id]/edit/page.tsx>) |
| `/meetings/[id]` | (protected) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/meetings/[id]/page.tsx>) |
| `/meetings/[id]/vote` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/meetings/[id]/vote/page.tsx>) |
| `/meetings/calendar` | (protected) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/meetings/calendar/page.tsx>) |
| `/meetings` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/meetings/page.tsx>) |
| `/merchandise-submissions/admin` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/merchandise-submissions/admin/page.tsx>) |
| `/merchandise-submissions` | (protected) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/merchandise-submissions/page.tsx>) |
| `/notifications` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/notifications/page.tsx>) |
| `/operations` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/operations/page.tsx>) |
| `/orgs/[id]` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/orgs/[id]/page.tsx>) |
| `/orgs` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/orgs/page.tsx>) |
| `/partner-map/admin/applications` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/partner-map/admin/applications/page.tsx>) |
| `/partner-map/admin` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/partner-map/admin/page.tsx>) |
| `/partner-map/my-businesses` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/partner-map/my-businesses/page.tsx>) |
| `/petitions/[id]` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/petitions/[id]/page.tsx>) |
| `/petitions/admin/types` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/petitions/admin/types/page.tsx>) |
| `/petitions/manage` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/petitions/manage/page.tsx>) |
| `/profile` | (protected) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/profile/page.tsx>) |
| `/publications/new` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/publications/new/page.tsx>) |
| `/publications` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/publications/page.tsx>) |
| `/qr-code` | (protected) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/qr-code/page.tsx>) |
| `/recommended-vendors/admin/categories` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/recommended-vendors/admin/categories/page.tsx>) |
| `/recommended-vendors/admin` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/recommended-vendors/admin/page.tsx>) |
| `/recommended-vendors` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/recommended-vendors/page.tsx>) |
| `/regulations/[id]/amendment` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/regulations/[id]/amendment/page.tsx>) |
| `/regulations/[id]/edit` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/regulations/[id]/edit/page.tsx>) |
| `/regulations/archived` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/regulations/archived/page.tsx>) |
| `/regulations/new` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/regulations/new/page.tsx>) |
| `/regulations/pending` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/regulations/pending/page.tsx>) |
| `/search` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/search/page.tsx>) |
| `/seating/[zoneId]` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/seating/[zoneId]/page.tsx>) |
| `/seating/admin/[productId]` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/seating/admin/[productId]/page.tsx>) |
| `/serial-templates` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/serial-templates/page.tsx>) |
| `/settings/account` | (protected) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/settings/account/page.tsx>) |
| `/settings/data-saver` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/settings/data-saver/page.tsx>) |
| `/settings/integrations` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/settings/integrations/page.tsx>) |
| `/settings/navigation` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/settings/navigation/page.tsx>) |
| `/settings/notifications` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/settings/notifications/page.tsx>) |
| `/settings` | (protected) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/settings/page.tsx>) |
| `/settings/privacy` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/settings/privacy/page.tsx>) |
| `/settings/security` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/settings/security/page.tsx>) |
| `/shop/admin` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/shop/admin/page.tsx>) |
| `/shop/cart` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/shop/cart/page.tsx>) |
| `/shop/class-orders` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/shop/class-orders/page.tsx>) |
| `/shop/council-orders` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/shop/council-orders/page.tsx>) |
| `/shop/orders/[id]` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/shop/orders/[id]/page.tsx>) |
| `/shop/orders` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/shop/orders/page.tsx>) |
| `/shop` | (protected) | client | 已訪問；導向 /login?next=%2Fshop | [page.tsx](<../../../apps/web/src/app/(protected)/shop/page.tsx>) |
| `/surveys/[id]/edit` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/surveys/[id]/edit/page.tsx>) |
| `/surveys/new` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/surveys/new/page.tsx>) |
| `/tasks` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/tasks/page.tsx>) |
| `/work-items` | (protected) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(protected)/work-items/page.tsx>) |
| `/about` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/about/page.tsx>) |
| `/announcements/[id]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/announcements/[id]/page.tsx>) |
| `/announcements` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/announcements/page.tsx>) |
| `/articles/[slug]` | (public) | server | 公開實例 hchs-lunch-guide | [page.tsx](<../../../apps/web/src/app/(public)/articles/[slug]/page.tsx>) |
| `/articles` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/articles/page.tsx>) |
| `/contact` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/contact/page.tsx>) |
| `/documents/[id]` | (public) | server | 公開實例／不存在路徑；D15 另有隔離驗證 | [page.tsx](<../../../apps/web/src/app/(public)/documents/[id]/page.tsx>) |
| `/documents` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/documents/page.tsx>) |
| `/legal/accessibility` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/legal/accessibility/page.tsx>) |
| `/legal/cookie` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/legal/cookie/page.tsx>) |
| `/legal` | (public) | server | 已訪問；導向 /legal/privacy | [page.tsx](<../../../apps/web/src/app/(public)/legal/page.tsx>) |
| `/legal/privacy` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/legal/privacy/page.tsx>) |
| `/legal/security-policy` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/legal/security-policy/page.tsx>) |
| `/legal/terms` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/legal/terms/page.tsx>) |
| `/links` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/links/page.tsx>) |
| `/live/elections/[id]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/live/elections/[id]/page.tsx>) |
| `/live/elections/[id]/vertical` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/live/elections/[id]/vertical/page.tsx>) |
| `/meetings/join/[token]` | (public) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/meetings/join/[token]/page.tsx>) |
| `/meetings/screen/[token]` | (public) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/meetings/screen/[token]/page.tsx>) |
| `/news/[id]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/news/[id]/page.tsx>) |
| `/news` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/news/page.tsx>) |
| `/officers` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/officers/page.tsx>) |
| `/` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/page.tsx>) |
| `/pages/[slug]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/pages/[slug]/page.tsx>) |
| `/partner-map/[businessSlug]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/partner-map/[businessSlug]/page.tsx>) |
| `/partner-map` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/partner-map/page.tsx>) |
| `/petitions/[id]/[verificationCode]` | (public) | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/petitions/[id]/[verificationCode]/page.tsx>) |
| `/petitions/new` | (public) | client | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/petitions/new/page.tsx>) |
| `/petitions` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/petitions/page.tsx>) |
| `/petitions/public/[id]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/petitions/public/[id]/page.tsx>) |
| `/petitions/public` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/petitions/public/page.tsx>) |
| `/petitions/share` | (public) | client | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/petitions/share/page.tsx>) |
| `/profile/complete` | (public) | client | 已訪問；導向 /login | [page.tsx](<../../../apps/web/src/app/(public)/profile/complete/page.tsx>) |
| `/public/budgets/[id]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/public/budgets/[id]/page.tsx>) |
| `/public/budgets` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/public/budgets/page.tsx>) |
| `/public/documents/[id]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/public/documents/[id]/page.tsx>) |
| `/public/documents` | (public) | server | 已訪問；導向 /documents | [page.tsx](<../../../apps/web/src/app/(public)/public/documents/page.tsx>) |
| `/public/elections` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/public/elections/page.tsx>) |
| `/public` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/public/page.tsx>) |
| `/public/regulations/[id]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/public/regulations/[id]/page.tsx>) |
| `/public/regulations` | (public) | server | 已訪問；導向 /regulations | [page.tsx](<../../../apps/web/src/app/(public)/public/regulations/page.tsx>) |
| `/public/special-agreement` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/public/special-agreement/page.tsx>) |
| `/regulations/[id]/[...refs]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/regulations/[id]/[...refs]/page.tsx>) |
| `/regulations/[id]` | (public) | server | 不存在路徑；有效內容未完整驗收 | [page.tsx](<../../../apps/web/src/app/(public)/regulations/[id]/page.tsx>) |
| `/regulations` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/regulations/page.tsx>) |
| `/surveys/[id]` | (public) | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/(public)/surveys/[id]/page.tsx>) |
| `/surveys` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/surveys/page.tsx>) |
| `/system-info` | (public) | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/(public)/system-info/page.tsx>) |
| `/auth/callback` | ungrouped | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/auth/callback/page.tsx>) |
| `/auth/mfa` | ungrouped | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/auth/mfa/page.tsx>) |
| `/blocked` | ungrouped | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/blocked/page.tsx>) |
| `/login` | ungrouped | server | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/login/page.tsx>) |
| `/maintenance` | ungrouped | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/maintenance/page.tsx>) |
| `/module-status` | ungrouped | client | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/module-status/page.tsx>) |
| `/raffle` | ungrouped | server | 未逐頁瀏覽；已列冊 | [page.tsx](<../../../apps/web/src/app/raffle/page.tsx>) |
| `/unsubscribe` | ungrouped | client | 已訪問；200 | [page.tsx](<../../../apps/web/src/app/unsubscribe/page.tsx>) |

## 本輪正式站已訪問的 42 個不同路徑

動態參數使用公開內容或明確不存在的測試識別碼；未嘗試猜測私有 UUID。

- `/` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/about` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/admin` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/announcements` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/articles` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/articles/hchs-lunch-guide` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/contact` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/dashboard` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/documents` — 最後批次狀態 200；觀察到 pageerror
- `/documents/not-existing-audit-document` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/documents/嶺代綜字第 1150000001 號` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/finance` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/legal` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/legal/accessibility` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/legal/cookie` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/legal/privacy` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/legal/security-policy` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/legal/terms` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/links` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/login` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/meal` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/news` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/not-existing-audit-page` — 最後批次狀態 404；無記錄到 pageerror（不代表功能完整正確）
- `/officers` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/partner-map` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/petitions` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/petitions/new` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/petitions/public` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/petitions/share` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/profile/complete` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/public` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/public/budgets` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/public/documents` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/public/elections` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/public/regulations` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/public/special-agreement` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/regulations` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/regulations/not-existing-audit-regulation` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/shop` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/surveys` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/system-info` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）
- `/unsubscribe` — 最後批次狀態 200；無記錄到 pageerror（不代表功能完整正確）

## API 按 Router 檔案盤點

這是原始碼 decorator 宣告數，不是去重後正式站掛載端點數。動態掛載與權限邊界仍須依 router／dependency 查核。未逐一呼叫全部 1,108 個宣告；寫入路徑只在隔離診斷或既有測試中執行。

| Router | GET | POST | PATCH | PUT | DELETE | WS |
|---|---:|---:|---:|---:|---:|---:|
| [activities.py](<../../../apps/api/src/api/routers/activities.py>) | 11 | 9 | 3 | 1 | 3 | 0 |
| [admin.py](<../../../apps/api/src/api/routers/admin.py>) | 8 | 10 | 3 | 1 | 3 | 0 |
| [admin_observability.py](<../../../apps/api/src/api/routers/admin_observability.py>) | 5 | 3 | 0 | 0 | 0 | 0 |
| [admin_system.py](<../../../apps/api/src/api/routers/admin_system.py>) | 25 | 15 | 3 | 5 | 3 | 0 |
| [agent_observability.py](<../../../apps/api/src/api/routers/agent_observability.py>) | 3 | 3 | 0 | 0 | 0 | 0 |
| [analytics.py](<../../../apps/api/src/api/routers/analytics.py>) | 8 | 5 | 0 | 0 | 0 | 0 |
| [announcements.py](<../../../apps/api/src/api/routers/announcements.py>) | 5 | 4 | 2 | 0 | 2 | 0 |
| [api_keys.py](<../../../apps/api/src/api/routers/api_keys.py>) | 2 | 2 | 0 | 0 | 0 | 0 |
| [audit.py](<../../../apps/api/src/api/routers/audit.py>) | 2 | 0 | 0 | 0 | 0 | 0 |
| [auth.py](<../../../apps/api/src/api/routers/auth.py>) | 5 | 3 | 0 | 0 | 0 | 0 |
| [calendar.py](<../../../apps/api/src/api/routers/calendar.py>) | 6 | 5 | 4 | 0 | 5 | 0 |
| [council_proposals.py](<../../../apps/api/src/api/routers/council_proposals.py>) | 4 | 2 | 1 | 0 | 0 | 0 |
| [dashboard.py](<../../../apps/api/src/api/routers/dashboard.py>) | 2 | 0 | 0 | 0 | 0 | 0 |
| [data_lifecycle.py](<../../../apps/api/src/api/routers/data_lifecycle.py>) | 4 | 2 | 0 | 0 | 0 | 0 |
| [discord.py](<../../../apps/api/src/api/routers/discord.py>) | 16 | 11 | 4 | 0 | 6 | 0 |
| [discord_internal.py](<../../../apps/api/src/api/routers/discord_internal.py>) | 2 | 4 | 0 | 1 | 0 | 0 |
| [documents.py](<../../../apps/api/src/api/routers/documents.py>) | 6 | 1 | 1 | 3 | 1 | 0 |
| [documents_approve.py](<../../../apps/api/src/api/routers/documents_approve.py>) | 1 | 14 | 1 | 2 | 1 | 0 |
| [documents_attachments.py](<../../../apps/api/src/api/routers/documents_attachments.py>) | 3 | 2 | 1 | 0 | 1 | 0 |
| [documents_serial.py](<../../../apps/api/src/api/routers/documents_serial.py>) | 4 | 3 | 2 | 0 | 2 | 0 |
| [elections.py](<../../../apps/api/src/api/routers/elections.py>) | 5 | 6 | 1 | 0 | 0 | 0 |
| [electronic_credentials.py](<../../../apps/api/src/api/routers/electronic_credentials.py>) | 2 | 2 | 1 | 0 | 0 | 0 |
| [email.py](<../../../apps/api/src/api/routers/email.py>) | 5 | 8 | 1 | 0 | 1 | 0 |
| [email_platform.py](<../../../apps/api/src/api/routers/email_platform.py>) | 6 | 6 | 2 | 0 | 3 | 0 |
| [exam_papers.py](<../../../apps/api/src/api/routers/exam_papers.py>) | 3 | 2 | 1 | 0 | 1 | 0 |
| [feature_flags.py](<../../../apps/api/src/api/routers/feature_flags.py>) | 3 | 2 | 1 | 0 | 0 | 0 |
| [finance.py](<../../../apps/api/src/api/routers/finance.py>) | 14 | 25 | 9 | 0 | 0 | 0 |
| [governance.py](<../../../apps/api/src/api/routers/governance.py>) | 18 | 17 | 9 | 2 | 3 | 0 |
| [impersonation.py](<../../../apps/api/src/api/routers/impersonation.py>) | 0 | 2 | 0 | 0 | 0 | 0 |
| [inventory.py](<../../../apps/api/src/api/routers/inventory.py>) | 8 | 8 | 3 | 0 | 2 | 0 |
| [judicial_petitions.py](<../../../apps/api/src/api/routers/judicial_petitions.py>) | 3 | 1 | 1 | 0 | 0 | 0 |
| [line_webhook.py](<../../../apps/api/src/api/routers/line_webhook.py>) | 3 | 2 | 0 | 0 | 1 | 0 |
| [loans.py](<../../../apps/api/src/api/routers/loans.py>) | 5 | 4 | 3 | 0 | 1 | 0 |
| [matters.py](<../../../apps/api/src/api/routers/matters.py>) | 3 | 3 | 2 | 0 | 2 | 0 |
| [meal.py](<../../../apps/api/src/api/routers/meal.py>) | 16 | 19 | 5 | 0 | 2 | 0 |
| [meetings.py](<../../../apps/api/src/api/routers/meetings.py>) | 11 | 38 | 12 | 0 | 4 | 1 |
| [merchandise_submissions.py](<../../../apps/api/src/api/routers/merchandise_submissions.py>) | 7 | 6 | 4 | 1 | 1 | 0 |
| [metrics_endpoint.py](<../../../apps/api/src/api/routers/metrics_endpoint.py>) | 1 | 0 | 0 | 0 | 0 | 0 |
| [mfa.py](<../../../apps/api/src/api/routers/mfa.py>) | 3 | 9 | 0 | 0 | 2 | 0 |
| [navigation_profiles.py](<../../../apps/api/src/api/routers/navigation_profiles.py>) | 3 | 1 | 1 | 0 | 1 | 0 |
| [notifications.py](<../../../apps/api/src/api/routers/notifications.py>) | 8 | 5 | 1 | 3 | 1 | 0 |
| [orgs.py](<../../../apps/api/src/api/routers/orgs.py>) | 6 | 3 | 1 | 0 | 1 | 0 |
| [partner_business_application.py](<../../../apps/api/src/api/routers/partner_business_application.py>) | 3 | 1 | 2 | 0 | 0 | 0 |
| [partner_map.py](<../../../apps/api/src/api/routers/partner_map.py>) | 17 | 11 | 6 | 1 | 6 | 0 |
| [people.py](<../../../apps/api/src/api/routers/people.py>) | 2 | 4 | 2 | 0 | 1 | 0 |
| [petitions.py](<../../../apps/api/src/api/routers/petitions.py>) | 16 | 13 | 8 | 1 | 2 | 0 |
| [policies.py](<../../../apps/api/src/api/routers/policies.py>) | 8 | 5 | 2 | 0 | 0 | 0 |
| [positions.py](<../../../apps/api/src/api/routers/positions.py>) | 2 | 2 | 1 | 0 | 2 | 0 |
| [privacy.py](<../../../apps/api/src/api/routers/privacy.py>) | 2 | 2 | 0 | 0 | 0 | 0 |
| [public_api.py](<../../../apps/api/src/api/routers/public_api.py>) | 3 | 0 | 0 | 0 | 0 | 0 |
| [publications.py](<../../../apps/api/src/api/routers/publications.py>) | 3 | 3 | 1 | 0 | 0 | 0 |
| [raffles.py](<../../../apps/api/src/api/routers/raffles.py>) | 3 | 5 | 1 | 0 | 0 | 0 |
| [receivables.py](<../../../apps/api/src/api/routers/receivables.py>) | 3 | 3 | 1 | 0 | 0 | 0 |
| [recommended_vendors.py](<../../../apps/api/src/api/routers/recommended_vendors.py>) | 7 | 5 | 4 | 0 | 3 | 0 |
| [regulations.py](<../../../apps/api/src/api/routers/regulations.py>) | 13 | 19 | 4 | 1 | 2 | 0 |
| [reports.py](<../../../apps/api/src/api/routers/reports.py>) | 3 | 0 | 0 | 0 | 0 | 0 |
| [saved_filters.py](<../../../apps/api/src/api/routers/saved_filters.py>) | 1 | 1 | 1 | 0 | 1 | 0 |
| [school_class.py](<../../../apps/api/src/api/routers/school_class.py>) | 9 | 11 | 2 | 0 | 6 | 0 |
| [search.py](<../../../apps/api/src/api/routers/search.py>) | 1 | 1 | 0 | 0 | 0 | 0 |
| [seating.py](<../../../apps/api/src/api/routers/seating.py>) | 5 | 4 | 1 | 2 | 3 | 0 |
| [shop.py](<../../../apps/api/src/api/routers/shop.py>) | 15 | 13 | 8 | 0 | 7 | 0 |
| [site.py](<../../../apps/api/src/api/routers/site.py>) | 13 | 7 | 5 | 0 | 4 | 0 |
| [support.py](<../../../apps/api/src/api/routers/support.py>) | 11 | 13 | 5 | 0 | 0 | 0 |
| [survey.py](<../../../apps/api/src/api/routers/survey.py>) | 7 | 6 | 2 | 0 | 1 | 0 |
| [tasks.py](<../../../apps/api/src/api/routers/tasks.py>) | 2 | 0 | 0 | 0 | 0 | 0 |
| [term_rollover.py](<../../../apps/api/src/api/routers/term_rollover.py>) | 0 | 3 | 0 | 0 | 0 | 0 |
| [trash.py](<../../../apps/api/src/api/routers/trash.py>) | 2 | 0 | 0 | 0 | 0 | 0 |
| [user_google_tasks.py](<../../../apps/api/src/api/routers/user_google_tasks.py>) | 3 | 1 | 0 | 0 | 1 | 0 |
| [user_lifecycle.py](<../../../apps/api/src/api/routers/user_lifecycle.py>) | 1 | 3 | 0 | 0 | 0 | 0 |
| [user_positions.py](<../../../apps/api/src/api/routers/user_positions.py>) | 2 | 1 | 1 | 0 | 1 | 0 |
| [users.py](<../../../apps/api/src/api/routers/users.py>) | 6 | 7 | 1 | 0 | 1 | 0 |
| [webhooks.py](<../../../apps/api/src/api/routers/webhooks.py>) | 3 | 1 | 1 | 0 | 1 | 0 |
| [work_items.py](<../../../apps/api/src/api/routers/work_items.py>) | 1 | 2 | 1 | 0 | 0 | 0 |
| [workflows.py](<../../../apps/api/src/api/routers/workflows.py>) | 3 | 2 | 0 | 0 | 0 | 0 |
| [ws.py](<../../../apps/api/src/api/routers/ws.py>) | 1 | 0 | 0 | 0 | 0 | 3 |
