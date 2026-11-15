"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { ChevronDown, ExternalLink, Paperclip, ReceiptText } from "lucide-react";

import Modal from "@/components/ui/Modal";
import { apiUrl } from "@/lib/config";
import { PdfEvidenceViewer } from "./EvidencePreview";
import { groupPublicBudgetLines, type PublicBudgetExecutionLine } from "./publicBudgetExecution";

export type { PublicBudgetExecutionLine } from "./publicBudgetExecution";

function formatAmount(value: number) {
  return `${value < 0 ? "-" : ""}NT$${Math.abs(value).toLocaleString("zh-TW")}`;
}

function formatDate(value: string) {
  return value.replaceAll("-", "/");
}

const dateTimeFormatter = new Intl.DateTimeFormat("zh-TW-u-ca-gregory", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Taipei",
});

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : dateTimeFormatter.format(date);
}

function publicEvidenceUrl(url: string) {
  if (url.startsWith("/finance/")) return apiUrl(url);
  if (url.startsWith("/api/")) return url;
  return null;
}

export default function PublicBudgetExecutionTable({
  lines,
}: {
  lines: PublicBudgetExecutionLine[];
}) {
  const [selectedLine, setSelectedLine] = useState<PublicBudgetExecutionLine | null>(null);
  const closeDetails = useCallback(() => setSelectedLine(null), []);
  const groups = groupPublicBudgetLines(lines);

  return (
    <>
      <div className="public-finance__activities">
        {groups.map((group) => (
          <details className="public-finance__activity" key={group.id} open={groups.length === 1 || group.expenseSpent > group.expenseBudget}>
            <summary>
              <div className="public-finance__activity-name">
                <h3>{group.name}</h3>
                <span>{group.lines.length} 項</span>
              </div>
              <dl>
                <div><dt>預計收入</dt><dd>{formatAmount(group.incomeBudget)}</dd></div>
                <div><dt>支出預算</dt><dd>{formatAmount(group.expenseBudget)}</dd></div>
                <div><dt>已登錄收入</dt><dd>{formatAmount(group.incomeReceived)}</dd></div>
                <div><dt>已列帳支出</dt><dd className={group.expenseSpent > group.expenseBudget ? "is-over-budget" : ""}>{formatAmount(group.expenseSpent)}</dd></div>
                <div><dt>已登錄差額（非帳戶餘額）</dt><dd>{formatAmount(group.difference)}</dd></div>
              </dl>
              <ChevronDown size={18} aria-hidden="true" />
              {group.expenseBudget > 0 && <meter min={0} max={group.expenseBudget} value={Math.min(Math.max(group.expenseSpent, 0), group.expenseBudget)} aria-label={`${group.name}預算執行率`} />}
            </summary>
            <div className="public-finance__lines" role="region" aria-label={`${group.name}收支預算明細`} tabIndex={0}>
              <table>
                <caption className="sr-only">{group.budgetName}：{group.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">項目／細項</th>
                    <th scope="col" className="public-finance__secondary-column">數量</th>
                    <th scope="col" className="public-finance__secondary-column">單價</th>
                    <th scope="col">預算金額</th>
                    <th scope="col">支出／實收</th>
                    <th scope="col" className="public-finance__secondary-column">尚可動支預算</th>
                    <th scope="col" className="public-finance__secondary-column">備註</th>
                    <th scope="col">憑證</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line) => {
                    const overBudget = !line.income && line.spent > line.allocated;
                    const hasOwnActivity = line.allocated > 0
                      || line.spent > 0
                      || line.expenses.length > 0;
                    const showDetails = !line.isGroup || hasOwnActivity;
                    const quantity = line.allocations?.map((allocation) => allocation.quantity == null ? "—" : `${allocation.quantity}${allocation.unit || ""}`).join("、") || "—";
                    const unitPrice = line.allocations?.map((allocation) => allocation.unit_price == null ? "—" : formatAmount(allocation.unit_price)).join("、") || "—";
                    const note = line.allocations?.map((allocation) => allocation.note).filter(Boolean).join("；");
                    const evidenceCount = line.expenses.reduce((sum, expense) => sum + expense.evidence.length, 0);
                    return (
                      <tr
                        key={line.id}
                        className={`${line.isGroup ? "is-group" : ""} ${line.income ? "is-income-row" : ""} ${overBudget ? "is-over-budget" : ""}`}
                      >
                        <th scope="row" style={{ paddingLeft: `${0.85 + Math.max(0, line.depth - 1) * 1.25}rem` }}>
                          {showDetails ? (
                            <button
                              type="button"
                              className="public-finance__line-trigger"
                              aria-haspopup="dialog"
                              aria-label={`查看「${line.name}」的${line.income ? "收入紀錄" : "支出紀錄與憑證"}`}
                              onClick={() => {
                                setSelectedLine(line);
                              }}
                            >
                              <strong>{line.name}</strong>
                              <ReceiptText size={15} aria-hidden="true" />
                            </button>
                          ) : (
                            <strong>{line.name}</strong>
                          )}
                          <small className="public-finance__line-kind">{line.income ? (line.historical ? "收入 · 歷史收款" : "收入") : (overBudget ? `支出 · 超出預算 ${formatAmount(line.spent - line.allocated)}` : "支出")}</small>
                          {showDetails && <details className="public-finance__mobile-details">
                            <summary>編列明細</summary>
                            <dl>
                              <div><dt>數量</dt><dd>{quantity}</dd></div>
                              <div><dt>單價</dt><dd>{unitPrice}</dd></div>
                              {!line.income && <div><dt>尚可動支預算</dt><dd>{formatAmount(line.remaining)}</dd></div>}
                            </dl>
                            {note && <p>{note}</p>}
                          </details>}
                        </th>
                        <td className="public-finance__secondary-column">{quantity}</td>
                        <td className="public-finance__secondary-column">{unitPrice}</td>
                        <td data-label="預算金額">{showDetails && !line.historical ? formatAmount(line.allocated) : "—"}</td>
                        <td data-label={line.income ? "實收" : "已支出"} className={line.income ? "is-income" : "is-expense"}>{showDetails ? formatAmount(line.spent) : "—"}</td>
                        <td className="public-finance__secondary-column">{showDetails && !line.income ? formatAmount(line.remaining) : "—"}</td>
                        <td className="public-finance__workbook-note public-finance__secondary-column">{note ? <details><summary>查看備註</summary><p>{note}</p></details> : "—"}</td>
                        <td className="public-finance__line-evidence">{line.income || !showDetails ? "—" : evidenceCount > 0 ? <button className="public-finance__line-trigger" type="button" aria-haspopup="dialog" aria-label={`查看收據：${line.name}`} onClick={() => setSelectedLine(line)}>憑證 {evidenceCount} 份</button> : <span>尚無公開憑證</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ))}
        {groups.length === 0 && <p className="public-finance__empty-line">這個期間尚未公開預算明細。</p>}
      </div>

      {selectedLine && (
        <Modal
          title={`${selectedLine.name}｜${selectedLine.income ? "收入" : "支出"}紀錄`}
          onClose={closeDetails}
          size="2xl"
        >
          <div className="public-budget-execution-modal">
            <p className="public-budget-execution-modal__summary">
              <span>{selectedLine.budgetName}</span>
              <span>{selectedLine.income ? (selectedLine.incomeRecords?.length ?? 0) : selectedLine.expenses.length} 筆{selectedLine.income ? "收入" : "支出"}紀錄</span>
            </p>
            {selectedLine.income ? (
              (selectedLine.incomeRecords?.length ?? 0) > 0 ? (
                <div className="public-budget-detail__expense-list">
                  {selectedLine.incomeRecords?.map((record) => (
                    <article key={record.id}>
                      <div className="public-budget-detail__expense-heading">
                        <h3>{record.name}</h3>
                        <strong>{formatAmount(record.amount)}</strong>
                      </div>
                      <dl className="public-budget-detail__expense-meta">
                        <div><dt>入帳日期</dt><dd><time dateTime={record.entry_date}>{formatDate(record.entry_date)}</time></dd></div>
                        <div><dt>收入項目</dt><dd>{record.category}／{record.name}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              ) : <div className="public-budget-execution-modal__empty"><p>這個預算項目目前沒有可公開的收入紀錄。</p></div>
            ) : selectedLine.expenses.length > 0 ? (
              <div className="public-budget-detail__expense-list">
                {selectedLine.expenses.map((expense) => (
                  <article key={expense.id}>
                    <div className="public-budget-detail__expense-heading">
                      <div>
                        <h3>{expense.purpose}</h3>
                      </div>
                      <strong>{formatAmount(expense.total_amount)}</strong>
                    </div>
                    <dl className="public-budget-detail__expense-meta">
                      <div>
                        <dt>支出日期</dt>
                        <dd><time dateTime={expense.entry_date}>{formatDate(expense.entry_date)}</time></dd>
                      </div>
                      <div>
                        <dt>登錄時間</dt>
                        <dd><time dateTime={expense.created_at}>{formatDateTime(expense.created_at)}</time></dd>
                      </div>
                    </dl>
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
                    <section
                      className="public-budget-execution-modal__evidence"
                      aria-label={`${expense.purpose} 憑證`}
                    >
                      <h4><Paperclip size={14} aria-hidden="true" />收據與憑證</h4>
                      {expense.evidence.length > 0 ? (
                        <div className="public-budget-execution-modal__previews">
                          {expense.evidence.map((evidence) => {
                            const previewUrl = publicEvidenceUrl(evidence.url);
                            const isImage = /\.(?:jpe?g|png|webp)$/i.test(evidence.filename);
                            const isPdf = /\.pdf$/i.test(evidence.filename);
                            return (
                              <figure key={evidence.id}>
                                <figcaption>{evidence.filename}</figcaption>
                                {previewUrl ? (
                                  isImage ? (
                                    <div className="public-budget-execution-modal__image-preview">
                                      <Image
                                        src={previewUrl}
                                        alt={`${evidence.filename} 預覽`}
                                        fill
                                        sizes="(max-width: 680px) 100vw, 720px"
                                        unoptimized
                                      />
                                    </div>
                                  ) : isPdf ? (
                                    <PdfEvidenceViewer
                                      url={previewUrl}
                                      filename={evidence.filename}
                                      compact
                                    />
                                  ) : (
                                    <small>無法預覽此憑證。</small>
                                  )
                                ) : (
                                  <small>無法預覽此憑證。</small>
                                )}
                                {previewUrl && (
                                  <a
                                    className="public-budget-execution-modal__open-evidence"
                                    href={previewUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={`在新分頁檢視：${evidence.filename}`}
                                  >
                                    <ExternalLink size={14} aria-hidden="true" />
                                    在新分頁檢視
                                  </a>
                                )}
                              </figure>
                            );
                          })}
                        </div>
                      ) : <small>此筆支出尚未附憑證。</small>}
                    </section>
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
