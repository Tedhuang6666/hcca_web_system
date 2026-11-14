"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { ExternalLink, Paperclip, ReceiptText } from "lucide-react";

import Modal from "@/components/ui/Modal";
import { apiUrl } from "@/lib/config";
import { PdfEvidenceViewer } from "./EvidencePreview";
import type { PublicBudgetExecutionLine } from "./publicBudgetExecution";

export type { PublicBudgetExecutionLine } from "./publicBudgetExecution";

function formatAmount(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
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

  return (
    <>
      <div className="public-finance__lines" role="region" aria-label="預算執行表，可左右捲動" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">項目／細項</th>
              <th scope="col">數量</th>
              <th scope="col">單價</th>
              <th scope="col">預算金額</th>
              <th scope="col">已支出</th>
              <th scope="col">可用餘額</th>
              <th scope="col">備註</th>
              <th scope="col">收據</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const ratio = line.allocated > 0
                ? Math.round((line.spent / line.allocated) * 100)
                : 0;
              const hasOwnActivity = line.allocated > 0
                || line.spent > 0
                || line.expenses.length > 0;
              const showDetails = !line.isGroup || hasOwnActivity;
              return (
                <tr
                  key={line.id}
                  className={`${line.isGroup ? "is-group" : ""} ${ratio > 100 ? "is-over-budget" : ""}`}
                >
                  <th scope="row" style={{ paddingLeft: `${0.85 + line.depth * 1.25}rem` }}>
                    {showDetails ? (
                      <button
                        type="button"
                        className="public-finance__line-trigger"
                        aria-haspopup="dialog"
                        aria-label={`查看「${line.name}」的支出紀錄與憑證`}
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
                    {line.isBudgetStart && <small>{line.budgetName}</small>}
                  </th>
                  <td>{line.allocations?.map((allocation) => allocation.quantity == null ? "—" : `${allocation.quantity}${allocation.unit || ""}`).join("、") || "—"}</td>
                  <td>{line.allocations?.map((allocation) => allocation.unit_price == null ? "—" : formatAmount(allocation.unit_price)).join("、") || "—"}</td>
                  <td>{showDetails ? formatAmount(line.allocated) : "—"}</td>
                  <td className="is-expense">{showDetails ? formatAmount(line.spent) : "—"}</td>
                  <td>{showDetails ? formatAmount(line.remaining) : "—"}</td>
                  <td className="public-finance__workbook-note">{line.allocations?.map((allocation) => allocation.note).filter(Boolean).join("；") || "—"}</td>
                  <td>{line.expenses.length > 0 ? <button className="public-finance__line-trigger" type="button" aria-haspopup="dialog" aria-label={`查看收據：${line.name}`} onClick={() => setSelectedLine(line)}>{line.expenses.reduce((sum, expense) => sum + expense.evidence.length, 0)} 份</button> : "—"}</td>
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td className="public-finance__empty-line" colSpan={8}>
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
                      <div>
                        <dt>操作人</dt>
                        <dd>{expense.operator_name}</dd>
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
