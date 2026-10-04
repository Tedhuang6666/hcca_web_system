"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, FileCheck2, LoaderCircle } from "lucide-react";

import { financeApi } from "@/lib/api";
import type { PublicExpenseClaimDetailOut, PublicExpenseOut } from "@/lib/types";

type ExpenseGroup = {
  key: string;
  budgetId: string;
  claimId: string | null;
  items: PublicExpenseOut[];
  amount: number;
};

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: PublicExpenseClaimDetailOut };

function formatAmount(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}

function formatTimestamp(value: string | null) {
  if (!value) return "尚未登錄";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function groupExpenses(expenses: PublicExpenseOut[]): ExpenseGroup[] {
  const groups = new Map<string, ExpenseGroup>();
  for (const expense of expenses) {
    const key = expense.claim_id
      ? `claim:${expense.budget_id}:${expense.claim_id}`
      : `item:${expense.id}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(expense);
      group.amount += expense.amount;
    } else {
      groups.set(key, {
        key,
        budgetId: expense.budget_id,
        claimId: expense.claim_id || null,
        items: [expense],
        amount: expense.amount,
      });
    }
  }
  return [...groups.values()];
}

export default function PublicExpenseTable({ expenses }: { expenses: PublicExpenseOut[] }) {
  const groups = groupExpenses(expenses);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  const openDetails = async (group: ExpenseGroup, toggle = true) => {
    if (!group.claimId) return;
    const current = details[group.key];
    if (toggle) setExpandedKey((value) => value === group.key ? null : group.key);
    if (current?.status === "loaded" || current?.status === "loading") return;

    setDetails((value) => ({ ...value, [group.key]: { status: "loading" } }));
    try {
      const data = await financeApi.getPublicExpenseClaim(group.budgetId, group.claimId);
      setDetails((value) => ({ ...value, [group.key]: { status: "loaded", data } }));
    } catch (error) {
      setDetails((value) => ({
        ...value,
        [group.key]: {
          status: "error",
          message: error instanceof Error ? error.message : "無法載入報帳明細",
        },
      }));
    }
  };

  return (
    <div className="public-finance__expense-table" role="region" aria-label="最近支出紀錄，可左右捲動" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th scope="col">日期</th>
            <th scope="col">用途與品項</th>
            <th scope="col">預算項目</th>
            <th scope="col">數量與單價</th>
            <th scope="col">狀態</th>
            <th scope="col">金額</th>
            <th scope="col">憑證與詳情</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const first = group.items[0];
            const itemNames = [...new Set(group.items.map((item) => item.item_name))];
            const budgetItems = [...new Set(group.items.map((item) => item.budget_item))];
            const expanded = expandedKey === group.key;
            const detail = details[group.key];
            const statusLabel = first.status === "spent"
              ? "已完成核銷"
              : first.status === "awaiting_reimbursement"
                ? "等待代墊償還"
                : "待核銷";
            return (
              <Fragment key={group.key}>
                <tr>
                  <td><time dateTime={first.entry_date}>{formatDate(first.entry_date)}</time></td>
                  <td>
                    <strong>{first.purpose}</strong>
                    <small>{group.claimId ? `${itemNames.join("、")}｜${group.items.length} 項` : first.item_name}</small>
                  </td>
                  <td>
                    <Link href={`/public/budgets/${group.budgetId}`}>
                      {first.budget_name}<small>{budgetItems.join("、")}</small>
                    </Link>
                  </td>
                  <td>
                    {group.claimId
                      ? `${group.items.length} 項品項`
                      : `${first.quantity} ${first.unit}`}
                    {!group.claimId && <small>{first.unit_price ? formatAmount(first.unit_price) : "單價未提供"}</small>}
                  </td>
                  <td><span className={`public-finance__status is-${first.status}`}>{statusLabel}</span></td>
                  <td className="public-finance__expense-amount is-expense">{formatAmount(group.amount)}</td>
                  <td>
                    {group.claimId && first.status === "spent" ? (
                      <button
                        className="public-finance__expense-toggle"
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => void openDetails(group)}
                      >
                        {expanded ? "收合詳情" : "查看詳情"}
                        {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                      </button>
                    ) : (first.evidence ?? []).length > 0 ? (
                      (first.evidence ?? []).map((evidence) => (
                        <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer">
                          <FileCheck2 size={14} aria-hidden="true" />{evidence.filename}
                        </a>
                      ))
                    ) : "—"}
                  </td>
                </tr>
                {expanded && group.claimId && (
                  <tr className="public-finance__expense-detail-row">
                    <td colSpan={7}>
                      {detail?.status === "loading" ? (
                        <p className="public-finance__expense-detail-loading" role="status">
                          <LoaderCircle size={16} aria-hidden="true" />正在載入報帳明細…
                        </p>
                      ) : detail?.status === "error" ? (
                        <div className="public-finance__expense-detail-error" role="alert">
                          <p>{detail.message}</p>
                          <button type="button" onClick={() => void openDetails(group, false)}>重新載入</button>
                        </div>
                      ) : detail?.status === "loaded" ? (
                        <article className="public-finance__claim-detail">
                          <header>
                            <div><h3>{detail.data.purpose}</h3><span>報帳明細</span></div>
                            <strong className="is-expense">{formatAmount(detail.data.total_amount)}</strong>
                          </header>
                          <dl>
                            <div><dt>報帳部門</dt><dd>{detail.data.department_name || "未提供"}</dd></div>
                            <div><dt>報帳人</dt><dd>{detail.data.reporter_name}</dd></div>
                            <div><dt>報帳時間</dt><dd>{formatTimestamp(detail.data.reported_at)}</dd></div>
                            <div><dt>支出日期</dt><dd>{formatDate(detail.data.entry_date)}</dd></div>
                            <div><dt>付款／償還時間</dt><dd>{formatTimestamp(detail.data.paid_at)}</dd></div>
                          </dl>
                          <ul>
                            {detail.data.items.map((item) => (
                              <li key={item.id}>
                                <span>
                                  <strong>{item.name}</strong>
                                  <small>{item.budget_item} · {item.quantity} {item.unit} × {formatAmount(item.unit_price)}</small>
                                  {(item.evidence ?? []).map((evidence) => (
                                    <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer">
                                      <FileCheck2 size={13} aria-hidden="true" />{evidence.filename}
                                    </a>
                                  ))}
                                </span>
                                <b>{formatAmount(item.amount)}</b>
                              </li>
                            ))}
                          </ul>
                          {(detail.data.supplemental_evidence ?? []).length > 0 && (
                            <div className="public-finance__claim-extra-evidence">
                              {(detail.data.supplemental_evidence ?? []).map((evidence) => (
                                <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer">
                                  <FileCheck2 size={14} aria-hidden="true" />{evidence.filename}
                                </a>
                              ))}
                            </div>
                          )}
                        </article>
                      ) : null}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
