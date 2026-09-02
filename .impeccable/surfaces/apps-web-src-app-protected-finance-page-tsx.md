---
version: 1
slug: "apps-web-src-app-protected-finance-page-tsx"
primary_target: "apps/web/src/app/(protected)/finance/page.tsx"
related_targets: ["apps/web/src/components/finance/BudgetWorkspace.tsx","apps/web/src/app/(protected)/finance/receivables/page.tsx","apps/web/src/app/(public)/public/budgets/page.tsx","apps/web/src/app/(public)/public/budgets/[id]/page.tsx","apps/web/src/app/globals.css"]
---

Scope: `/finance`, `/finance/receivables`, `/public/budgets`, and `/public/budgets/[id]`.

Mode: Operate. This extends the established HCCA warm-white and matte-gold product world.

Audience: Student-government finance staff, reviewers, budget owners, and public readers. They need to move cases forward without learning accounting-system jargon.

Primary job: Make the next required action obvious across reimbursement, approval, procurement, payment, settlement, budget planning, and publication.

Primary actions: Create reimbursement, review queued cases, maintain budget versions, publish an approved initial budget, and mark receivables collected.

Content hierarchy: Current ledger and period, actionable work, six-step case runway, detailed work form, status/version history, then configuration. Budget views group line items as item/detail rows with quantity, unit price, tax-inclusive total, item subtotal, and notes. Public pages contain approved budget data only.

Visual direction: Editorial finance workbench with compact module navigation, numbered form sections, sticky monetary/readiness summaries, restrained gold actions, green completion states, and responsive card fallbacks for operational tables.

Responsive behavior: Desktop uses a two-column module shell and grouped spreadsheet-style tables. Mobile uses horizontally scrollable module navigation, single-column forms, stacked metrics, and grouped budget cards without document-level horizontal overflow.

Constraints: Preserve existing permissions, audit status semantics, router/service boundaries, and public/private data separation. Public budget pages never expose evidence or user identifiers; evidence upload and line-item editing remain authenticated back-office actions.

Memorable moment: One continuous runway connects submission to approval, budget control, payment, evidence, and final settlement.
