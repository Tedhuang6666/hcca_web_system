"use client";

import { useCallback, useState } from "react";
import { FileCheck2, Paperclip, ReceiptText } from "lucide-react";

import EvidencePreview from "@/components/finance/EvidencePreview";
import Modal from "@/components/ui/Modal";
import type { PublicBudgetExpenseOut } from "@/lib/types";

export type PublicBudgetExecutionLine = {
  id: string;
  budgetName: string;
  name: string;
  allocated: number;
  spent: number;
  remaining: number;
  depth: number;
  isGroup: boolean;
  isBudgetStart: boolean;
  expenses: PublicBudgetExpenseOut[];
};

function formatAmount(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function formatDate(value: string) {
  return value.replaceAll("-", "/");
}

export default function PublicBudgetExecutionTable({
  lines,
}: {
  lines: PublicBudgetExecutionLine[];
}) {
  const [selectedLine, setSelectedLine] = useState<PublicBudgetExecutionLine | null>(null);
  const closeDetails = useCallback(() => setSelectedLine(null), []);

  return (
    <>
      <div className="public-finance__lines" role="region" aria-label="預算執行表，可左右捲動" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">預算條目</th>
              <th scope="col">編列</th>
              <th scope="col">已用</th>
              <th scope="col">剩餘</th>
              <th scope="col">執行率</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const ratio = line.allocated > 0
                ? Math.round((line.spent / line.allocated) * 100)
                : 0;
              const barWidth = Math.min(Math.max(ratio, 0), 100);
              return (
                <tr
                  key={line.id}
                  className={`${line.isGroup ? "is-group" : ""} ${ratio > 100 ? "is-over-budget" : ""}`}
                >
                  <th scope="row" style={{ paddingLeft: `${0.85 + line.depth * 1.25}rem` }}>
                    {line.isGroup ? (
                      <strong>{line.name}</strong>
                    ) : (
                      <button
                        type="button"
                        className="public-finance__line-trigger"
                        aria-haspopup="dialog"
                        aria-label={`查看「${line.name}」的支出紀錄與憑證`}
                        onClick={() => setSelectedLine(line)}
                      >
                        <strong>{line.name}</strong>
                        <ReceiptText size={15} aria-hidden="true" />
                      </button>
                    )}
                    {line.isBudgetStart && <small>{line.budgetName}</small>}
                  </th>
                  <td>{line.isGroup ? "—" : formatAmount(line.allocated)}</td>
                  <td className="is-expense">{line.isGroup ? "—" : formatAmount(line.spent)}</td>
                  <td>{line.isGroup ? "—" : formatAmount(line.remaining)}</td>
                  <td>
                    {line.isGroup ? "—" : (
                      <span className="public-finance__execution-rate">
                        <span
                          className="public-finance__progress"
                          role="img"
                          aria-label={`${line.name} 執行率 ${ratio}%`}
                        >
                          <i style={{ width: `${barWidth}%` }} />
                        </span>
                        <b>{ratio}%</b>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td className="public-finance__empty-line" colSpan={5}>
                  這個期間尚未公開預算明細。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedLine && (
        <Modal
          title={`${selectedLine.name}｜支出紀錄`}
          onClose={closeDetails}
          size="2xl"
        >
          <div className="public-budget-execution-modal">
            <p className="public-budget-execution-modal__summary">
              <span>{selectedLine.budgetName}</span>
              <span>{selectedLine.expenses.length} 筆支出紀錄</span>
            </p>
            {selectedLine.expenses.length > 0 ? (
              <div className="public-budget-detail__expense-list">
                {selectedLine.expenses.map((expense) => (
                  <article key={expense.id}>
                    <div className="public-budget-detail__expense-heading">
                      <div>
                        <time dateTime={expense.entry_date}>{formatDate(expense.entry_date)}</time>
                        <h3>{expense.purpose}</h3>
                      </div>
                      <strong>{formatAmount(expense.total_amount)}</strong>
                    </div>
                    {expense.items.length > 0 && (
                      <ul aria-label={`${expense.purpose} 購買品項`}>
                        {expense.items.map((item) => (
                          <li key={item.id}>
                            <span>
                              <strong>{item.name}</strong>
                              <small>
                                {item.quantity} {item.unit} × {formatAmount(item.unit_price)}
                                {item.tax_rate > 0 ? `（稅率 ${item.tax_rate}%）` : ""}
                              </small>
                            </span>
                            <b>{formatAmount(item.amount)}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div
                      className="public-budget-detail__expense-evidence"
                      aria-label={`${expense.purpose} 憑證`}
                    >
                      <span><Paperclip size={14} aria-hidden="true" />收據與憑證</span>
                      {expense.evidence.length > 0 ? expense.evidence.map((evidence) => (
                        <EvidencePreview
                          key={evidence.id}
                          url={evidence.url}
                          filename={evidence.filename}
                        >
                          <FileCheck2 size={14} aria-hidden="true" />{evidence.filename}
                        </EvidencePreview>
                      )) : <small>此筆支出尚未附憑證。</small>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="public-budget-execution-modal__empty">
                <ReceiptText size={21} aria-hidden="true" />
                <p>這個預算項目目前沒有可公開的支出紀錄。</p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
