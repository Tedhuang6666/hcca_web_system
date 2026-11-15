import { publicBudgetTotals, type PublicBudgetExecutionLine } from "./publicBudgetExecution";

function formatAmount(value: number) {
  return `${value < 0 ? "-" : ""}NT$${Math.abs(value).toLocaleString("zh-TW")}`;
}

export default function PublicBudgetFinancialSummary({ lines }: { lines: PublicBudgetExecutionLine[] }) {
  const totals = publicBudgetTotals(lines);
  const executionRate = totals.expenseBudget > 0
    ? totals.expenseSpent / totals.expenseBudget * 100
    : null;

  return (
    <div className="public-finance__summary">
      <section aria-label="核准預算">
        <h3>核准預算</h3>
        <dl className="public-finance__totals">
          <div><dt>預計收入</dt><dd>{formatAmount(totals.incomeBudget)}</dd></div>
          <div><dt>核准支出預算</dt><dd>{formatAmount(totals.expenseBudget)}</dd></div>
          <div className={totals.expenseSpent > totals.expenseBudget ? "is-over-budget" : ""}>
            <dt>預算執行率</dt><dd>{executionRate === null ? "—" : `${executionRate.toFixed(1)}%`}</dd>
          </div>
        </dl>
      </section>
      <section aria-label="已登錄收支">
        <h3>已登錄收支</h3>
        <dl className="public-finance__totals">
          <div><dt>已登錄收入</dt><dd>{formatAmount(totals.incomeReceived)}</dd></div>
          <div><dt>已列帳支出</dt><dd>{formatAmount(totals.expenseSpent)}</dd></div>
          <div><dt>已登錄收支差額（非帳戶餘額）</dt><dd>{formatAmount(totals.difference)}</dd></div>
        </dl>
        <p>未含期初餘額、未入帳款項及代墊清算。</p>
      </section>
    </div>
  );
}
