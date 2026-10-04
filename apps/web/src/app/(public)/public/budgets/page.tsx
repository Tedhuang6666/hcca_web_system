import { ArrowRight, ClipboardCheck, Landmark, ReceiptText, ShieldCheck } from "lucide-react";
import Link from "next/link";

import PublicExpenseTable from "@/components/finance/PublicExpenseTable";
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
  budgetName: string;
  name: string;
  allocated: number;
  spent: number;
  remaining: number;
  depth: number;
  isGroup: boolean;
  isBudgetStart: boolean;
};

function formatAmount(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function budgetExecutionLines(
  budget: PublicBudgetDetail,
  summary: PublicBudgetListItem,
): BudgetExecutionLine[] {
  const nodes = new Map(budget.nodes.map((node) => [node.id, node]));
  const parentIds = new Set(budget.nodes.flatMap((node) => (
    node.parent_id ? [node.parent_id] : []
  )));
  let isBudgetStart = true;

  return budget.nodes
    .filter((node) => (
      node.allocated_amount > 0 || node.used_amount > 0 || parentIds.has(node.id)
    ))
    .map((node) => {
      let depth = 0;
      let current = node.parent_id ? nodes.get(node.parent_id) : undefined;
      while (current) {
        depth += 1;
        current = current.parent_id ? nodes.get(current.parent_id) : undefined;
      }
      const line = {
        id: `${summary.id}-${node.id}`,
        budgetName: summary.name,
        name: node.name,
        allocated: node.allocated_amount,
        spent: node.used_amount,
        remaining: node.remaining_amount,
        depth,
        isGroup: parentIds.has(node.id),
        isBudgetStart,
      };
      isBudgetStart = false;
      return line;
    });
}

function budgetHref(budget: PublicBudgetListItem) {
  return budget.review_submission_id
    ? `/public/budgets/${budget.id}?review_submission_id=${budget.review_submission_id}`
    : `/public/budgets/${budget.id}`;
}

export default async function PublicBudgetsPage() {
  const [budgetResult, expenseResult] = await Promise.all([
    fetchPublicBudgets(),
    fetchPublicExpenses(10),
  ]);
  const budgets = budgetResult.data ?? [];
  const expenses = expenseResult.data ?? [];
  const budgetLoadFailed = budgetResult.data === null;
  const expenseLoadFailed = expenseResult.data === null;
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
    (total, line) => total + (line.isGroup ? 0 : line.allocated),
    0,
  );
  const spentTotal = executionLines.reduce(
    (total, line) => total + (line.isGroup ? 0 : line.spent),
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
          <p>預算、支出與餘額放在同一頁。金額依已核准且公開的預算與支出紀錄彙整。</p>
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
          <div className="public-finance__lines" role="region" aria-label="預算執行表，可左右捲動" tabIndex={0}>
            <table>
              <thead><tr><th scope="col">預算條目</th><th scope="col">編列</th><th scope="col">已用</th><th scope="col">剩餘</th><th scope="col">執行率</th></tr></thead>
              <tbody>
            {executionLines.map((line) => {
              const ratio = line.allocated > 0
                ? Math.round((line.spent / line.allocated) * 100)
                : 0;
              const barWidth = Math.min(Math.max(ratio, 0), 100);
              return (
                <tr key={line.id} className={`${line.isGroup ? "is-group" : ""} ${ratio > 100 ? "is-over-budget" : ""}`}>
                  <th scope="row" style={{ paddingLeft: `${0.85 + line.depth * 1.25}rem` }}>
                    <strong>{line.name}</strong>
                    {line.isBudgetStart && <small>{line.budgetName}</small>}
                  </th>
                  <td>{line.isGroup ? "—" : formatAmount(line.allocated)}</td>
                  <td className="is-expense">{line.isGroup ? "—" : formatAmount(line.spent)}</td>
                  <td>{line.isGroup ? "—" : formatAmount(line.remaining)}</td>
                  <td>
                    {line.isGroup ? "—" : (
                      <span className="public-finance__execution-rate">
                        <span className="public-finance__progress" role="img" aria-label={`${line.name} 執行率 ${ratio}%`}>
                          <i style={{ width: `${barWidth}%` }} />
                        </span>
                        <b>{ratio}%</b>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {executionLines.length === 0 && (
              <tr><td className="public-finance__empty-line" colSpan={5}>這個期間尚未公開預算明細。</td></tr>
            )}
              </tbody>
            </table>
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
        <p><strong>已完成報帳的部門、報帳人與憑證會公開。</strong>任何人都能查看支出用途、品項、核銷時間與憑證；銀行帳戶與內部備註不會出現在這裡。</p>
      </aside>

      <section className="public-finance__expenses" aria-labelledby="public-finance-expenses-heading">
        <header className="public-finance__section-heading">
          <div>
            <span>最近登錄</span>
            <h2 id="public-finance-expenses-heading">支出紀錄</h2>
          </div>
          {!expenseLoadFailed && <span>最近 {expenses.length} 筆</span>}
        </header>
        {expenseLoadFailed ? (
          <div className="public-finance__empty-expenses" role="status">
            <ReceiptText size={20} aria-hidden="true" />
            <p>支出紀錄暫時無法載入，請稍後重新整理。</p>
          </div>
        ) : expenses.length > 0 ? (
          <PublicExpenseTable expenses={expenses} />
        ) : (
          <div className="public-finance__empty-expenses">
            <ReceiptText size={20} aria-hidden="true" />
            <p>目前沒有已列入公開預算的支出紀錄。</p>
          </div>
        )}
      </section>

      {!budgetLoadFailed && <section className="public-finance__budget-list" aria-labelledby="public-finance-budget-list-heading">
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
      </section>}
    </div>
  );
}
