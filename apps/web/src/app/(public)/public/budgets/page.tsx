import { Landmark } from "lucide-react";

import PublicBudgetExecutionTable from "@/components/finance/PublicBudgetExecutionTable";
import { publicBudgetWorkbookLines } from "@/components/finance/publicBudgetExecution";
import {
  fetchPublicBudget,
  fetchPublicBudgets,
} from "@/lib/publicSeoFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "財務總覽",
  description: "查看各項活動編列的預算、實際支出與公開憑證。",
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
  const budgetDetails = await Promise.all(currentBudgets.map((budget) => fetchPublicBudget(budget.id)));
  const executionLines = budgetDetails.flatMap((detail, index) => {
    const summary = currentBudgets[index];
    return detail && summary ? publicBudgetWorkbookLines(detail, summary) : [];
  });
  const expenseLines = executionLines.filter((line) => !line.income);
  const budgetTotal = expenseLines.reduce(
    (total, line) => total + line.allocated,
    0,
  );
  const spentTotal = expenseLines.reduce(
    (total, line) => total + line.spent,
    0,
  );
  const executionRate = budgetTotal > 0 ? spentTotal / budgetTotal * 100 : null;
  const executionLoadFailed = budgetDetails.some((detail) => detail === null);

  return (
    <div className="public-budget-index public-finance">
      <header className="public-budget-index__header">
        <div>
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
      ) : executionLoadFailed ? (
        <section className="public-budget-index__empty" role="alert">
          <h2>目前無法讀取收支明細</h2>
          <form action="/public/budgets" method="get"><button className="btn btn-secondary">重新載入</button></form>
        </section>
      ) : currentPeriod ? (
        <section className="public-finance__overview" aria-labelledby="public-finance-overview-heading">
          <header className="public-finance__section-heading">
            <div>
              <h2 id="public-finance-overview-heading">{currentPeriod}</h2>
            </div>
            <span>{currentBudgets.length} 份核准預算</span>
          </header>
          <div className="public-finance__totals">
            <article>
              <span>核准支出預算</span>
              <strong>{formatAmount(budgetTotal)}</strong>
            </article>
            <article>
              <span>已列帳支出</span>
              <strong>{formatAmount(spentTotal)}</strong>
            </article>
            <article className={spentTotal > budgetTotal ? "is-over-budget" : ""}>
              <span>預算執行率</span>
              <strong>{executionRate === null ? "—" : `${executionRate.toFixed(1)}%`}</strong>
            </article>
          </div>
          <PublicBudgetExecutionTable lines={executionLines} />
        </section>
      ) : (
        <section className="public-budget-index__empty">
          <Landmark size={24} aria-hidden="true" />
          <div>
            <h2>目前沒有公開中的核准預算</h2>
          </div>
        </section>
      )}

    </div>
  );
}
