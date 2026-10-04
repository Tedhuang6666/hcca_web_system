import Link from "next/link";
import { ArrowRight, ClipboardCheck, Landmark, ReceiptText, ShieldCheck } from "lucide-react";

import {
  fetchPublicBudget,
  fetchPublicBudgets,
  fetchPublicBudgetTotals,
  fetchPublicExpenses,
} from "@/lib/publicSeoFetch";
import type { PublicBudgetDetail, PublicBudgetListItem } from "@/lib/types";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "財務總覽",
  description: "查看公開預算、執行金額、剩餘預算與近期支出紀錄。",
  path: "/public/budgets",
  type: "website",
});

type BudgetExecutionLine = {
  id: string;
  budgetId: string;
  budgetName: string;
  name: string;
  allocated: number;
  spent: number;
  remaining: number;
};

function formatAmount(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}

function budgetExecutionLines(
  budget: PublicBudgetDetail,
  summary: PublicBudgetListItem,
): BudgetExecutionLine[] {
  const nodes = new Map(budget.nodes.map((node) => [node.id, node]));
  const parentIds = new Set(
    budget.nodes.flatMap((node) => (node.parent_id ? [node.parent_id] : [])),
  );

  return budget.nodes
    .filter((node) => !parentIds.has(node.id))
    .filter((node) => node.allocated_amount > 0 || node.used_amount > 0)
    .map((node) => {
      const path: string[] = [];
      let current: (typeof budget.nodes)[number] | undefined = node;
      while (current) {
        path.unshift(current.name);
        current = current.parent_id ? nodes.get(current.parent_id) : undefined;
      }
      return {
        id: `${summary.id}-${node.id}`,
        budgetId: summary.id,
        budgetName: summary.name,
        name: path.join(" ＞ "),
        allocated: node.allocated_amount,
        spent: node.used_amount,
        remaining: node.remaining_amount,
      };
    });
}

function budgetHref(budget: PublicBudgetListItem) {
  return budget.review_submission_id
    ? `/public/budgets/${budget.id}?review_submission_id=${budget.review_submission_id}`
    : `/public/budgets/${budget.id}`;
}

export default async function PublicBudgetsPage() {
  const [budgets, expenses] = await Promise.all([
    fetchPublicBudgets(),
    fetchPublicExpenses(10),
  ]);
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
  const budgetTotal = executionLines.reduce((total, line) => total + line.allocated, 0);
  const spentTotal = executionLines.reduce((total, line) => total + line.spent, 0);
  const remainingTotal = budgetTotal - spentTotal;
  const incomeTotal = budgetTotals.reduce((total, row) => total + (row?.income_total ?? 0), 0);
  const expenseTotal = budgetTotals.reduce((total, row) => total + (row?.expense_total ?? 0), 0);

  return (
    <div className="public-budget-index public-finance">
      <header className="public-budget-index__header">
        <div>
          <span className="public-finance__eyebrow">學生會財務公開</span>
          <h1>財務總覽</h1>
          <p>預算、支出與餘額放在同一頁。金額依已核准且公開的預算與支出紀錄彙整。</p>
        </div>
        <span>
          <Landmark size={20} aria-hidden="true" />
          {budgets.length} 份可檢視預算
        </span>
      </header>

      {currentPeriod ? (
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
            <p>收入<strong>{formatAmount(incomeTotal)}</strong></p>
            <p>支出<strong>{formatAmount(expenseTotal)}</strong></p>
          </div>
          <div className="public-finance__lines" aria-label="預算項目執行情況">
            {executionLines.map((line) => {
              const ratio = line.allocated > 0
                ? Math.round((line.spent / line.allocated) * 100)
                : 0;
              const barWidth = Math.min(Math.max(ratio, 0), 100);
              return (
                <article key={line.id}>
                  <div className="public-finance__line-label">
                    <span>
                      <strong>{line.name}</strong>
                      <small>{line.budgetName}</small>
                    </span>
                    <b>{ratio}%</b>
                  </div>
                  <span
                    className="public-finance__progress"
                    role="img"
                    aria-label={`${line.name} 執行率 ${ratio}%`}
                  >
                    <i style={{ width: `${barWidth}%` }} />
                  </span>
                  <dl>
                    <div><dt>預算</dt><dd>{formatAmount(line.allocated)}</dd></div>
                    <div><dt>已列帳</dt><dd>{formatAmount(line.spent)}</dd></div>
                    <div><dt>剩餘</dt><dd>{formatAmount(line.remaining)}</dd></div>
                  </dl>
                </article>
              );
            })}
            {executionLines.length === 0 && (
              <p className="public-finance__empty-line">這個期間尚未公開預算明細。</p>
            )}
          </div>
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

      <aside className="public-budget-index__notice" aria-label="公開資料範圍">
        <ShieldCheck size={18} aria-hidden="true" />
        <p><strong>支出品項與憑證會公開。</strong>預算管理者開放預算後，任何人都能查看用途、品名、數量、單價與收據；登錄人、銀行帳戶與核銷備註不會出現在這裡。</p>
      </aside>

      <section className="public-finance__expenses" aria-labelledby="public-finance-expenses-heading">
        <header className="public-finance__section-heading">
          <div>
            <span>最近登錄</span>
            <h2 id="public-finance-expenses-heading">支出紀錄</h2>
          </div>
          <span>最近 {expenses.length} 筆</span>
        </header>
        {expenses.length > 0 ? (
          <div className="public-finance__expense-table" role="region" aria-label="最近支出紀錄，可左右捲動" tabIndex={0}>
            <table>
              <thead><tr><th>日期</th><th>用途與品項</th><th>預算項目</th><th>數量與單價</th><th>憑證</th><th>金額</th></tr></thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td><time dateTime={expense.entry_date}>{formatDate(expense.entry_date)}</time></td>
                    <td><strong>{expense.purpose}</strong><small>{expense.item_name}</small></td>
                    <td>
                      <Link href={`/public/budgets/${expense.budget_id}`}>
                        {expense.budget_name}<small>{expense.budget_item}</small>
                      </Link>
                    </td>
                    <td>{expense.quantity} {expense.unit}<small>{expense.unit_price ? formatAmount(expense.unit_price) : "單價未提供"}</small></td>
                    <td>{expense.evidence?.length ? expense.evidence.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer">查看 {item.filename}</a>) : "—"}</td>
                    <td className="public-finance__expense-amount">{formatAmount(expense.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="public-finance__empty-expenses">
            <ReceiptText size={20} aria-hidden="true" />
            <p>目前沒有已列入公開預算的支出紀錄。</p>
          </div>
        )}
      </section>

      <section className="public-finance__budget-list" aria-labelledby="public-finance-budget-list-heading">
        <header className="public-finance__section-heading">
          <div>
            <span>明細與審理進度</span>
            <h2 id="public-finance-budget-list-heading">預算案</h2>
          </div>
        </header>
        {budgets.length > 0 ? (
          <div className="public-budget-index__list" aria-label="公開預算案">
            {budgets.map((budget) => (
              <Link key={`${budget.id}-${budget.review_submission_id || "approved"}`} href={budgetHref(budget)} className="public-budget-index__row">
                <span>{budget.period_name}</span>
                <div>
                  <h3>{budget.name}</h3>
                  {budget.review_title && <p>{budget.review_title}</p>}
                </div>
                <span className={budget.visibility === "council_review" ? "is-review" : ""}>
                  {budget.visibility === "council_review" ? (
                    <><ClipboardCheck size={16} aria-hidden="true" />議員審理草案</>
                  ) : (
                    <>查看核准明細 <ArrowRight size={16} aria-hidden="true" /></>
                  )}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="public-finance__empty-budgets">目前沒有可檢視的預算案。</p>
        )}
      </section>
    </div>
  );
}
