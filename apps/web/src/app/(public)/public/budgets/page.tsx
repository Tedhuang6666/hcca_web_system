import { Landmark } from "lucide-react";

import PublicBudgetExecutionTable from "@/components/finance/PublicBudgetExecutionTable";
import { budgetExecutionLines } from "@/components/finance/publicBudgetExecution";
import {
  fetchPublicBudget,
  fetchPublicBudgets,
  fetchPublicBudgetTotals,
} from "@/lib/publicSeoFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "財務總覽",
  description: "查看公開預算、執行金額、剩餘預算與近期支出紀錄。",
  path: "/public/budgets",
  type: "website",
});

function formatAmount(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

export default async function PublicBudgetsPage() {
  const budgetResult = await fetchPublicBudgets();
  const budgets = budgetResult.data ?? [];
  const budgetLoadFailed = budgetResult.data === null;
  const approvedBudgets = budgets.filter((budget) => budget.visibility === "approved");
  const currentPeriod = approvedBudgets[0]?.period_name;
  const currentBudgets = approvedBudgets.filter((budget) => budget.period_name === currentPeriod);
  const [budgetDetails, budgetTotals] = await Promise.all([
    Promise.all(currentBudgets.map((budget) => fetchPublicBudget(budget.id))),
    Promise.all(currentBudgets.map((budget) => fetchPublicBudgetTotals(budget.id))),
  ]);
  const executionLines = budgetDetails.flatMap((detail, index) => {
    const summary = currentBudgets[index];
    return detail && summary ? budgetExecutionLines(detail, summary) : [];
  });
  const budgetTotal = executionLines.reduce(
    (total, line) => total + line.allocated,
    0,
  );
  const spentTotal = executionLines.reduce(
    (total, line) => total + line.spent,
    0,
  );
  const remainingTotal = budgetTotal - spentTotal;
  const incomeTotal = budgetTotals.reduce((total, row) => total + (row?.income_total ?? 0), 0);
  const expenseTotal = budgetTotals.reduce((total, row) => total + (row?.expense_total ?? 0), 0);

  return (
    <div className="public-budget-index public-finance">
      <header className="public-budget-index__header">
        <div>
          <span className="public-finance__eyebrow">學生會財務公開</span>
          <h1>財務總覽</h1>
        </div>
        {!budgetLoadFailed && <span>
          <Landmark size={20} aria-hidden="true" />
          {budgets.length} 份可檢視預算
        </span>}
      </header>

      {budgetLoadFailed ? (
        <section className="public-budget-index__empty" role="status">
          <Landmark size={24} aria-hidden="true" />
          <div>
            <h2>目前無法讀取公開預算資料</h2>
            <p>請稍後重新整理；目前無法確認是否有已公開預算。</p>
          </div>
        </section>
      ) : currentPeriod ? (
        <section className="public-finance__overview" aria-labelledby="public-finance-overview-heading">
          <header className="public-finance__section-heading">
            <div>
              <span>{currentPeriod}</span>
              <h2 id="public-finance-overview-heading">預算執行概況</h2>
            </div>
            <span>{currentBudgets.length} 份核准預算</span>
          </header>
          <div className="public-finance__totals">
            <article>
              <span>核准預算</span>
              <strong>{formatAmount(budgetTotal)}</strong>
            </article>
            <article>
              <span>已列帳支出</span>
              <strong>{formatAmount(spentTotal)}</strong>
            </article>
            <article className={remainingTotal < 0 ? "is-over-budget" : ""}>
              <span>{remainingTotal < 0 ? "超出預算" : "剩餘預算"}</span>
              <strong>{formatAmount(Math.abs(remainingTotal))}</strong>
            </article>
          </div>
          <div className="public-finance__cash-flow" aria-label="本期間收入與支出總額">
            <span>本期收支總額</span>
            <p className="is-income">收入<strong>{formatAmount(incomeTotal)}</strong></p>
            <p className="is-expense">支出<strong>{formatAmount(expenseTotal)}</strong></p>
          </div>
          <PublicBudgetExecutionTable lines={executionLines} />
          <p className="public-finance__calculation-note">
            核准預算的支出登錄後即計入執行額與決算；舊制報帳仍依原紀錄狀態列帳。
          </p>
        </section>
      ) : (
        <section className="public-budget-index__empty">
          <Landmark size={24} aria-hidden="true" />
          <div>
            <h2>目前沒有公開中的核准預算</h2>
            <p>預算核准並公開後，總額、執行狀況與支出紀錄會顯示在這裡。</p>
          </div>
        </section>
      )}

    </div>
  );
}
