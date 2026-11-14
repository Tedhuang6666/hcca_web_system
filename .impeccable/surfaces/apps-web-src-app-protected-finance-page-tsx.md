---
version: 1
slug: "apps-web-src-app-protected-finance-page-tsx"
primary_target: "apps/web/src/app/(protected)/finance/page.tsx"
related_targets: ["apps/web/src/components/finance/BudgetWorkspace.tsx","apps/web/src/components/finance/BudgetConsolidatedTable.tsx","apps/web/src/components/finance/BudgetAdvanceReceipts.tsx","apps/web/src/components/finance/budget-workbook.css","apps/web/src/app/(protected)/finance/receivables/page.tsx","apps/web/src/app/(public)/public/budgets/page.tsx","apps/web/src/app/(public)/public/budgets/[id]/page.tsx","apps/web/src/app/globals.css"]
---

Scope: `/finance`, `/public/budgets`, and `/public/budgets/[id]`. The independent class/shop collection page is outside this budget workflow.

Mode: Operate. Preserve the HCCA warm-white and matte-gold system.

Audience: Finance staff maintaining an uploaded semester budget, and public readers checking actual income and expenses.

Primary job: Upload an updated workbook, record actual income or expenses, and publish the resulting data.

Primary actions: Upload an xlsx full snapshot (default) or additions, register receipts and expenses from the current table, and control publication. Remove reimbursement queues, proposals, procurement, reviews, fund/account administration and advance receipt exports from the budget interface. Keep existing records.

Content hierarchy: Budget/period selection, upload, searchable income/expense table, actual receipt records, actual expenses and evidence. Keep quantities, source notes and version differences available without repeating them across columns.

Responsive behavior: A six-column table on desktop becomes labelled rows on mobile, without document overflow. Forms use a single column on mobile. Controls remain at least 44px.

PDF evidence: Opening public expense details immediately loads PDF.js, with white pages on a light neutral viewer, page/zoom controls and an original-file link. Never require a second preview click.

Data semantics: Recognize signed workbooks (positive income, negative expense), retain legacy amount-cell color classification, prefer the updated total worksheet, and carry existing actual transactions through new full snapshots. Monetary storage remains integer NTD; retain original fractional amounts/prices in notes when rounding.

Constraints: Preserve router permissions, organization scope, period restrictions and historical records. Public income records expose amounts and dates, excluding internal notes and recorder identifiers. New receipt records need the budget-income migration before release.
