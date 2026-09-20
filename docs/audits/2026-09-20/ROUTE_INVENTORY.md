# 路由清冊與驗證覆蓋

清冊產生於 2026-09-20；對照 [主報告](WEB_AUDIT.md)。

## 統計

| 項目 | 數量 |
|---|---:|
| page_entries | 180 |
| page_groups | {'(admin)': 40, '(protected)': 84, '(public)': 48, '未分組': 8} |
| client_entries | 126 |
| dynamic_entries | 36 |
| router_files | 75 |
| route_declarations | 1104 |
| first_desktop_paths | 41 |
| mobile_paths | 9 |
| additional_checks | 7 |
| distinct_paths | 46 |

頁面群組是原始碼目錄分類，不能據此判定授權。API 計數以 Router 中 GET、POST、PUT、PATCH、DELETE decorator 為準，未計 WebSocket，也不等於唯一掛載路由數。

## 180 個頁面入口

「桌面到訪」含成功頁、錯誤頁與匿名登入導向，沒有表示登入後功能驗收。動態路由只表示樣本 URL 被訪問，不代表全部資料狀態或子流程皆已測試。「未到訪」仍已列冊；沒有宣稱完成端到端驗證。

| 路徑模板 | 群組 | Client 入口 | 桌面到訪 | 手機到訪 | 原始碼 |
|---|---|---|---|---|---|
| `/admin/activities` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/activities/page.tsx` |
| `/admin/api-keys` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/api-keys/page.tsx` |
| `/admin/cadre-import` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/cadre-import/page.tsx` |
| `/admin/calendar/google` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/calendar/google/page.tsx` |
| `/admin/classes` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/classes/page.tsx` |
| `/admin/data-lifecycle` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/data-lifecycle/page.tsx` |
| `/admin/diagnostics` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/diagnostics/page.tsx` |
| `/admin/discord` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/discord/page.tsx` |
| `/admin/elections/[id]/count` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/elections/[id]/count/page.tsx` |
| `/admin/elections/new` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/elections/new/page.tsx` |
| `/admin/elections` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/elections/page.tsx` |
| `/admin/feature-flags` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/feature-flags/page.tsx` |
| `/admin/impersonation` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/impersonation/page.tsx` |
| `/admin/inventory/items` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/inventory/items/page.tsx` |
| `/admin/inventory` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/inventory/page.tsx` |
| `/admin/inventory/procurement` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/inventory/procurement/page.tsx` |
| `/admin/inventory/transactions` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/inventory/transactions/page.tsx` |
| `/admin/loans/checkout` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/loans/checkout/page.tsx` |
| `/admin/loans` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/loans/page.tsx` |
| `/admin/loans/records` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/loans/records/page.tsx` |
| `/admin/modules` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/modules/page.tsx` |
| `/admin/navigation-profiles` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/navigation-profiles/page.tsx` |
| `/admin` | (admin) | 是 | 樣本 1 | 未到訪 | `apps/web/src/app/(admin)/admin/page.tsx` |
| `/admin/people` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/people/page.tsx` |
| `/admin/permissions` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/permissions/page.tsx` |
| `/admin/permissions/positions/new` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/permissions/positions/new/page.tsx` |
| `/admin/policies` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/policies/page.tsx` |
| `/admin/privacy` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/privacy/page.tsx` |
| `/admin/public-site` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/public-site/page.tsx` |
| `/admin/raffle` | (admin) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/raffle/page.tsx` |
| `/admin/reports` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/reports/page.tsx` |
| `/admin/settings` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/settings/page.tsx` |
| `/admin/support` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/support/page.tsx` |
| `/admin/system/observability` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/system/observability/page.tsx` |
| `/admin/system` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/system/page.tsx` |
| `/admin/term-rollover` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/term-rollover/page.tsx` |
| `/admin/trash` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/trash/page.tsx` |
| `/admin/user-lifecycle` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/user-lifecycle/page.tsx` |
| `/admin/users` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/users/page.tsx` |
| `/admin/webhooks` | (admin) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(admin)/admin/webhooks/page.tsx` |
| `/activities/[id]` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/activities/[id]/page.tsx` |
| `/analytics` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/analytics/page.tsx` |
| `/announcements/[id]/edit` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/announcements/[id]/edit/page.tsx` |
| `/announcements/new` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/announcements/new/page.tsx` |
| `/audit-logs` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/audit-logs/page.tsx` |
| `/backoffice` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/backoffice/page.tsx` |
| `/calendar` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/calendar/page.tsx` |
| `/council-proposals` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/council-proposals/page.tsx` |
| `/credential` | (protected) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/credential/page.tsx` |
| `/dashboard` | (protected) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(protected)/dashboard/page.tsx` |
| `/document-templates` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/document-templates/page.tsx` |
| `/documents/[id]/edit` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/documents/[id]/edit/page.tsx` |
| `/documents/delegations` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/documents/delegations/page.tsx` |
| `/documents/new` | (protected) | 是 | 樣本 1 | 未到訪 | `apps/web/src/app/(protected)/documents/new/page.tsx` |
| `/email/analytics` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/email/analytics/page.tsx` |
| `/email/lists` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/email/lists/page.tsx` |
| `/email/logs` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/email/logs/page.tsx` |
| `/email` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/email/page.tsx` |
| `/email/templates` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/email/templates/page.tsx` |
| `/exam-papers/admin` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/exam-papers/admin/page.tsx` |
| `/exam-papers` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/exam-papers/page.tsx` |
| `/finance` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/finance/page.tsx` |
| `/finance/receivables` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/finance/receivables/page.tsx` |
| `/governance/[id]` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/governance/[id]/page.tsx` |
| `/governance` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/governance/page.tsx` |
| `/judicial-petitions` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/judicial-petitions/page.tsx` |
| `/matters/[id]` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/matters/[id]/page.tsx` |
| `/matters` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/matters/page.tsx` |
| `/meal/orders` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/meal/orders/page.tsx` |
| `/meal` | (protected) | 是 | 樣本 1 | 未到訪 | `apps/web/src/app/(protected)/meal/page.tsx` |
| `/meal/vendor` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/meal/vendor/page.tsx` |
| `/meetings/[id]/control` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/meetings/[id]/control/page.tsx` |
| `/meetings/[id]/edit` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/meetings/[id]/edit/page.tsx` |
| `/meetings/[id]` | (protected) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/meetings/[id]/page.tsx` |
| `/meetings/[id]/vote` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/meetings/[id]/vote/page.tsx` |
| `/meetings/calendar` | (protected) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/meetings/calendar/page.tsx` |
| `/meetings` | (protected) | 是 | 樣本 1 | 未到訪 | `apps/web/src/app/(protected)/meetings/page.tsx` |
| `/merchandise-submissions/admin` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/merchandise-submissions/admin/page.tsx` |
| `/merchandise-submissions` | (protected) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/merchandise-submissions/page.tsx` |
| `/notifications` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/notifications/page.tsx` |
| `/operations` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/operations/page.tsx` |
| `/orgs/[id]` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/orgs/[id]/page.tsx` |
| `/orgs` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/orgs/page.tsx` |
| `/partner-map/admin/applications` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/partner-map/admin/applications/page.tsx` |
| `/partner-map/admin` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/partner-map/admin/page.tsx` |
| `/partner-map/my-businesses` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/partner-map/my-businesses/page.tsx` |
| `/petitions/[id]` | (protected) | 是 | 樣本 3 | 未到訪 | `apps/web/src/app/(protected)/petitions/[id]/page.tsx` |
| `/petitions/admin/types` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/petitions/admin/types/page.tsx` |
| `/petitions/manage` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/petitions/manage/page.tsx` |
| `/profile` | (protected) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/profile/page.tsx` |
| `/publications/new` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/publications/new/page.tsx` |
| `/publications` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/publications/page.tsx` |
| `/qr-code` | (protected) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/qr-code/page.tsx` |
| `/recommended-vendors/admin/categories` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/recommended-vendors/admin/categories/page.tsx` |
| `/recommended-vendors/admin` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/recommended-vendors/admin/page.tsx` |
| `/recommended-vendors` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/recommended-vendors/page.tsx` |
| `/regulations/[id]/amendment` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/regulations/[id]/amendment/page.tsx` |
| `/regulations/[id]/edit` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/regulations/[id]/edit/page.tsx` |
| `/regulations/archived` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/regulations/archived/page.tsx` |
| `/regulations/new` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/regulations/new/page.tsx` |
| `/regulations/pending` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/regulations/pending/page.tsx` |
| `/search` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/search/page.tsx` |
| `/seating/[zoneId]` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/seating/[zoneId]/page.tsx` |
| `/seating/admin/[productId]` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/seating/admin/[productId]/page.tsx` |
| `/serial-templates` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/serial-templates/page.tsx` |
| `/settings/account` | (protected) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/settings/account/page.tsx` |
| `/settings/data-saver` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/settings/data-saver/page.tsx` |
| `/settings/integrations` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/settings/integrations/page.tsx` |
| `/settings/navigation` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/settings/navigation/page.tsx` |
| `/settings/notifications` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/settings/notifications/page.tsx` |
| `/settings` | (protected) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/settings/page.tsx` |
| `/settings/privacy` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/settings/privacy/page.tsx` |
| `/settings/security` | (protected) | 是 | 樣本 1 | 未到訪 | `apps/web/src/app/(protected)/settings/security/page.tsx` |
| `/shop/admin` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/shop/admin/page.tsx` |
| `/shop/cart` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/shop/cart/page.tsx` |
| `/shop/class-orders` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/shop/class-orders/page.tsx` |
| `/shop/council-orders` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/shop/council-orders/page.tsx` |
| `/shop/orders/[id]` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/shop/orders/[id]/page.tsx` |
| `/shop/orders` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/shop/orders/page.tsx` |
| `/shop` | (protected) | 是 | 樣本 1 | 未到訪 | `apps/web/src/app/(protected)/shop/page.tsx` |
| `/surveys/[id]/edit` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/surveys/[id]/edit/page.tsx` |
| `/surveys/new` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/surveys/new/page.tsx` |
| `/tasks` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/tasks/page.tsx` |
| `/work-items` | (protected) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(protected)/work-items/page.tsx` |
| `/about` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/about/page.tsx` |
| `/announcements/[id]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/announcements/[id]/page.tsx` |
| `/announcements` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/announcements/page.tsx` |
| `/articles/[slug]` | (public) | 否 | 樣本 2 | 是 | `apps/web/src/app/(public)/articles/[slug]/page.tsx` |
| `/articles` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/articles/page.tsx` |
| `/contact` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/contact/page.tsx` |
| `/documents/[id]` | (public) | 否 | 樣本 3 | 未到訪 | `apps/web/src/app/(public)/documents/[id]/page.tsx` |
| `/documents` | (public) | 否 | 樣本 1 | 是 | `apps/web/src/app/(public)/documents/page.tsx` |
| `/legal/accessibility` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/legal/accessibility/page.tsx` |
| `/legal/cookie` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/legal/cookie/page.tsx` |
| `/legal` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/legal/page.tsx` |
| `/legal/privacy` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/legal/privacy/page.tsx` |
| `/legal/security-policy` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/legal/security-policy/page.tsx` |
| `/legal/terms` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/legal/terms/page.tsx` |
| `/links` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/links/page.tsx` |
| `/live/elections/[id]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/live/elections/[id]/page.tsx` |
| `/live/elections/[id]/vertical` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/live/elections/[id]/vertical/page.tsx` |
| `/meetings/join/[token]` | (public) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/meetings/join/[token]/page.tsx` |
| `/meetings/screen/[token]` | (public) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/meetings/screen/[token]/page.tsx` |
| `/news/[id]` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/news/[id]/page.tsx` |
| `/news` | (public) | 否 | 樣本 1 | 是 | `apps/web/src/app/(public)/news/page.tsx` |
| `/officers` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/officers/page.tsx` |
| `/` | (public) | 否 | 樣本 1 | 是 | `apps/web/src/app/(public)/page.tsx` |
| `/pages/[slug]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/pages/[slug]/page.tsx` |
| `/partner-map/[businessSlug]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/partner-map/[businessSlug]/page.tsx` |
| `/partner-map` | (public) | 否 | 樣本 1 | 是 | `apps/web/src/app/(public)/partner-map/page.tsx` |
| `/petitions/[id]/[verificationCode]` | (public) | 是 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/petitions/[id]/[verificationCode]/page.tsx` |
| `/petitions/new` | (public) | 是 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/petitions/new/page.tsx` |
| `/petitions` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/petitions/page.tsx` |
| `/petitions/public/[id]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/petitions/public/[id]/page.tsx` |
| `/petitions/public` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/petitions/public/page.tsx` |
| `/petitions/share` | (public) | 是 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/petitions/share/page.tsx` |
| `/profile/complete` | (public) | 是 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/profile/complete/page.tsx` |
| `/public/budgets/[id]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/public/budgets/[id]/page.tsx` |
| `/public/budgets` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/public/budgets/page.tsx` |
| `/public/documents/[id]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/public/documents/[id]/page.tsx` |
| `/public/documents` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/public/documents/page.tsx` |
| `/public/elections` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/public/elections/page.tsx` |
| `/public` | (public) | 否 | 樣本 1 | 是 | `apps/web/src/app/(public)/public/page.tsx` |
| `/public/regulations/[id]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/public/regulations/[id]/page.tsx` |
| `/public/regulations` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/public/regulations/page.tsx` |
| `/public/special-agreement` | (public) | 否 | 樣本 1 | 是 | `apps/web/src/app/(public)/public/special-agreement/page.tsx` |
| `/regulations/[id]/[...refs]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/regulations/[id]/[...refs]/page.tsx` |
| `/regulations/[id]` | (public) | 否 | 樣本 2 | 未到訪 | `apps/web/src/app/(public)/regulations/[id]/page.tsx` |
| `/regulations` | (public) | 否 | 樣本 1 | 是 | `apps/web/src/app/(public)/regulations/page.tsx` |
| `/surveys/[id]` | (public) | 否 | 未到訪 | 未到訪 | `apps/web/src/app/(public)/surveys/[id]/page.tsx` |
| `/surveys` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/surveys/page.tsx` |
| `/system-info` | (public) | 否 | 樣本 1 | 未到訪 | `apps/web/src/app/(public)/system-info/page.tsx` |
| `/auth/callback` | 未分組 | 是 | 未到訪 | 未到訪 | `apps/web/src/app/auth/callback/page.tsx` |
| `/auth/mfa` | 未分組 | 是 | 未到訪 | 未到訪 | `apps/web/src/app/auth/mfa/page.tsx` |
| `/blocked` | 未分組 | 是 | 未到訪 | 未到訪 | `apps/web/src/app/blocked/page.tsx` |
| `/login` | 未分組 | 否 | 樣本 1 | 是 | `apps/web/src/app/login/page.tsx` |
| `/maintenance` | 未分組 | 是 | 未到訪 | 未到訪 | `apps/web/src/app/maintenance/page.tsx` |
| `/module-status` | 未分組 | 是 | 未到訪 | 未到訪 | `apps/web/src/app/module-status/page.tsx` |
| `/raffle` | 未分組 | 否 | 未到訪 | 未到訪 | `apps/web/src/app/raffle/page.tsx` |
| `/unsubscribe` | 未分組 | 是 | 未到訪 | 未到訪 | `apps/web/src/app/unsubscribe/page.tsx` |

## 正式站到訪路徑

第一輪與補充檢查合計 46 個不同路徑。首輪原始日誌跨日未保留，表內記錄依當時工具輸出彙整；9/20 複查原始摘要見 evidence.json。

| 路徑 | 首輪桌面 | 手機 | 補充檢查 |
|---|---|---|---|
| `/` | 是 | 是 | — |
| `/about` | 是 | — | — |
| `/admin` | 是 | — | — |
| `/announcements` | 是 | — | — |
| `/articles` | 是 | — | — |
| `/articles/audit-no-such-article` | — | — | 是 |
| `/articles/hchs-lunch-guide` | 是 | 是 | — |
| `/contact` | 是 | — | — |
| `/dashboard` | 是 | — | — |
| `/documents` | 是 | 是 | — |
| `/documents/audit-no-such-document` | — | — | 是 |
| `/documents/new` | 是 | — | — |
| `/documents/嶺代綜字第 1150000001 號` | — | — | 是 |
| `/legal` | 是 | — | — |
| `/legal/accessibility` | 是 | — | — |
| `/legal/cookie` | 是 | — | — |
| `/legal/privacy` | 是 | — | — |
| `/legal/security-policy` | 是 | — | — |
| `/legal/terms` | 是 | — | — |
| `/links` | 是 | — | — |
| `/login` | 是 | 是 | — |
| `/meal` | 是 | — | — |
| `/meetings` | 是 | — | — |
| `/news` | 是 | 是 | — |
| `/news/58187290-0900-4de0-b994-dd595ed211e8` | 是 | — | — |
| `/officers` | 是 | — | — |
| `/partner-map` | 是 | 是 | — |
| `/petitions` | 是 | — | — |
| `/petitions/new` | 是 | — | 是 |
| `/petitions/public` | 是 | — | — |
| `/petitions/share` | 是 | — | — |
| `/profile/complete` | 是 | — | — |
| `/public` | 是 | 是 | — |
| `/public/budgets` | 是 | — | — |
| `/public/documents` | 是 | — | — |
| `/public/elections` | 是 | — | — |
| `/public/regulations` | 是 | — | — |
| `/public/special-agreement` | 是 | 是 | — |
| `/regulations` | 是 | 是 | — |
| `/regulations/0e8cdf26-42b2-44ac-83c8-5c58be432b0d` | — | — | 是 |
| `/regulations/audit-no-such-regulation` | — | — | 是 |
| `/settings/security` | 是 | — | — |
| `/shop` | 是 | — | — |
| `/surveys` | 是 | — | 是 |
| `/system-info` | 是 | — | — |
| `/this-page-does-not-exist-audit` | 是 | — | — |

## API Router 清冊

下表是完整宣告列冊，不是每個端點都已逐一完成授權、資料正確性與競態測試。深入閱讀範圍見主報告。

| Router 檔案 | GET | POST | PUT | PATCH | DELETE | 合計 |
|---|---:|---:|---:|---:|---:|---:|
| `apps/api/src/api/routers/activities.py` | 11 | 9 | 1 | 3 | 3 | 27 |
| `apps/api/src/api/routers/admin.py` | 8 | 10 | 1 | 3 | 3 | 25 |
| `apps/api/src/api/routers/admin_observability.py` | 5 | 3 | 0 | 0 | 0 | 8 |
| `apps/api/src/api/routers/admin_system.py` | 25 | 15 | 5 | 3 | 3 | 51 |
| `apps/api/src/api/routers/agent_observability.py` | 3 | 3 | 0 | 0 | 0 | 6 |
| `apps/api/src/api/routers/analytics.py` | 8 | 5 | 0 | 0 | 0 | 13 |
| `apps/api/src/api/routers/announcements.py` | 5 | 4 | 0 | 2 | 2 | 13 |
| `apps/api/src/api/routers/api_keys.py` | 2 | 2 | 0 | 0 | 0 | 4 |
| `apps/api/src/api/routers/audit.py` | 2 | 0 | 0 | 0 | 0 | 2 |
| `apps/api/src/api/routers/auth.py` | 5 | 3 | 0 | 0 | 0 | 8 |
| `apps/api/src/api/routers/calendar.py` | 6 | 5 | 0 | 4 | 5 | 20 |
| `apps/api/src/api/routers/council_proposals.py` | 4 | 2 | 0 | 1 | 0 | 7 |
| `apps/api/src/api/routers/dashboard.py` | 2 | 0 | 0 | 0 | 0 | 2 |
| `apps/api/src/api/routers/data_lifecycle.py` | 4 | 2 | 0 | 0 | 0 | 6 |
| `apps/api/src/api/routers/discord.py` | 16 | 11 | 0 | 4 | 6 | 37 |
| `apps/api/src/api/routers/discord_internal.py` | 2 | 4 | 1 | 0 | 0 | 7 |
| `apps/api/src/api/routers/documents.py` | 6 | 1 | 3 | 1 | 1 | 12 |
| `apps/api/src/api/routers/documents_approve.py` | 1 | 14 | 2 | 1 | 1 | 19 |
| `apps/api/src/api/routers/documents_attachments.py` | 3 | 2 | 0 | 1 | 1 | 7 |
| `apps/api/src/api/routers/documents_serial.py` | 4 | 3 | 0 | 2 | 2 | 11 |
| `apps/api/src/api/routers/elections.py` | 5 | 6 | 0 | 1 | 0 | 12 |
| `apps/api/src/api/routers/electronic_credentials.py` | 2 | 2 | 0 | 1 | 0 | 5 |
| `apps/api/src/api/routers/email.py` | 5 | 8 | 0 | 1 | 1 | 15 |
| `apps/api/src/api/routers/email_platform.py` | 6 | 6 | 0 | 2 | 3 | 17 |
| `apps/api/src/api/routers/exam_papers.py` | 3 | 2 | 0 | 1 | 1 | 7 |
| `apps/api/src/api/routers/feature_flags.py` | 3 | 2 | 0 | 1 | 0 | 6 |
| `apps/api/src/api/routers/finance.py` | 14 | 25 | 0 | 9 | 0 | 48 |
| `apps/api/src/api/routers/governance.py` | 18 | 17 | 2 | 9 | 3 | 49 |
| `apps/api/src/api/routers/impersonation.py` | 0 | 2 | 0 | 0 | 0 | 2 |
| `apps/api/src/api/routers/inventory.py` | 8 | 8 | 0 | 3 | 2 | 21 |
| `apps/api/src/api/routers/judicial_petitions.py` | 3 | 1 | 0 | 1 | 0 | 5 |
| `apps/api/src/api/routers/line_webhook.py` | 3 | 2 | 0 | 0 | 1 | 6 |
| `apps/api/src/api/routers/loans.py` | 5 | 4 | 0 | 3 | 1 | 13 |
| `apps/api/src/api/routers/matters.py` | 3 | 3 | 0 | 2 | 2 | 10 |
| `apps/api/src/api/routers/meal.py` | 16 | 19 | 0 | 5 | 2 | 42 |
| `apps/api/src/api/routers/meetings.py` | 11 | 38 | 0 | 12 | 4 | 65 |
| `apps/api/src/api/routers/merchandise_submissions.py` | 7 | 6 | 1 | 4 | 1 | 19 |
| `apps/api/src/api/routers/metrics_endpoint.py` | 1 | 0 | 0 | 0 | 0 | 1 |
| `apps/api/src/api/routers/mfa.py` | 3 | 9 | 0 | 0 | 2 | 14 |
| `apps/api/src/api/routers/navigation_profiles.py` | 3 | 1 | 0 | 1 | 1 | 6 |
| `apps/api/src/api/routers/notifications.py` | 8 | 5 | 3 | 1 | 1 | 18 |
| `apps/api/src/api/routers/orgs.py` | 6 | 3 | 0 | 1 | 1 | 11 |
| `apps/api/src/api/routers/partner_business_application.py` | 3 | 1 | 0 | 2 | 0 | 6 |
| `apps/api/src/api/routers/partner_map.py` | 17 | 11 | 1 | 6 | 6 | 41 |
| `apps/api/src/api/routers/people.py` | 2 | 4 | 0 | 2 | 1 | 9 |
| `apps/api/src/api/routers/petitions.py` | 16 | 13 | 1 | 8 | 2 | 40 |
| `apps/api/src/api/routers/policies.py` | 8 | 5 | 0 | 2 | 0 | 15 |
| `apps/api/src/api/routers/positions.py` | 2 | 2 | 0 | 1 | 2 | 7 |
| `apps/api/src/api/routers/privacy.py` | 2 | 2 | 0 | 0 | 0 | 4 |
| `apps/api/src/api/routers/public_api.py` | 3 | 0 | 0 | 0 | 0 | 3 |
| `apps/api/src/api/routers/publications.py` | 3 | 3 | 0 | 1 | 0 | 7 |
| `apps/api/src/api/routers/raffles.py` | 3 | 5 | 0 | 1 | 0 | 9 |
| `apps/api/src/api/routers/receivables.py` | 3 | 3 | 0 | 1 | 0 | 7 |
| `apps/api/src/api/routers/recommended_vendors.py` | 7 | 5 | 0 | 4 | 3 | 19 |
| `apps/api/src/api/routers/regulations.py` | 13 | 19 | 1 | 4 | 2 | 39 |
| `apps/api/src/api/routers/reports.py` | 3 | 0 | 0 | 0 | 0 | 3 |
| `apps/api/src/api/routers/saved_filters.py` | 1 | 1 | 0 | 1 | 1 | 4 |
| `apps/api/src/api/routers/school_class.py` | 9 | 11 | 0 | 2 | 6 | 28 |
| `apps/api/src/api/routers/search.py` | 1 | 1 | 0 | 0 | 0 | 2 |
| `apps/api/src/api/routers/seating.py` | 5 | 4 | 2 | 1 | 3 | 15 |
| `apps/api/src/api/routers/shop.py` | 15 | 13 | 0 | 8 | 7 | 43 |
| `apps/api/src/api/routers/site.py` | 13 | 7 | 0 | 5 | 4 | 29 |
| `apps/api/src/api/routers/support.py` | 11 | 13 | 0 | 5 | 0 | 29 |
| `apps/api/src/api/routers/survey.py` | 7 | 6 | 0 | 2 | 1 | 16 |
| `apps/api/src/api/routers/tasks.py` | 2 | 0 | 0 | 0 | 0 | 2 |
| `apps/api/src/api/routers/term_rollover.py` | 0 | 3 | 0 | 0 | 0 | 3 |
| `apps/api/src/api/routers/trash.py` | 2 | 0 | 0 | 0 | 0 | 2 |
| `apps/api/src/api/routers/user_google_tasks.py` | 3 | 1 | 0 | 0 | 1 | 5 |
| `apps/api/src/api/routers/user_lifecycle.py` | 1 | 3 | 0 | 0 | 0 | 4 |
| `apps/api/src/api/routers/user_positions.py` | 2 | 1 | 0 | 1 | 1 | 5 |
| `apps/api/src/api/routers/users.py` | 6 | 7 | 0 | 1 | 1 | 15 |
| `apps/api/src/api/routers/webhooks.py` | 3 | 1 | 0 | 1 | 1 | 6 |
| `apps/api/src/api/routers/work_items.py` | 1 | 2 | 0 | 1 | 0 | 4 |
| `apps/api/src/api/routers/workflows.py` | 3 | 2 | 0 | 0 | 0 | 5 |
| `apps/api/src/api/routers/ws.py` | 1 | 0 | 0 | 0 | 0 | 1 |
