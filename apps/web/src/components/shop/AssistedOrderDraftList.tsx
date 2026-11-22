import { X } from "lucide-react";

import { money } from "@/lib/shop-class-orders";
import type { AssistedOrderDraftRow } from "@/components/shop/classOrderTypes";

type AssistedOrderDraftListProps = {
  rows: AssistedOrderDraftRow[];
  creating: boolean;
  hasCurrentComposerInput: boolean;
  onLoadDraft: (draft: AssistedOrderDraftRow) => void;
  onRemoveDraft: (id: string) => void;
};

export function AssistedOrderDraftList({
  rows, creating, hasCurrentComposerInput, onLoadDraft, onRemoveDraft,
}: AssistedOrderDraftListProps) {
  return (
    <>
          {rows.length > 0 && (
            <section aria-labelledby="assisted-drafts-heading" className="mt-4 overflow-hidden rounded-md"
              style={{ border: "1px solid var(--border)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3"
                style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                <div>
                  <h3 id="assisted-drafts-heading" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    待送出登記 · {rows.length} 位同學
                  </h3>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {rows.reduce((count, row) => count + row.items.length, 0)} 項商品 · 各活動小計分開計算
                  </p>
                </div>
                <strong className="text-sm tabular-nums" style={{ color: "var(--primary-text)" }}>
                  合計 {money(rows.reduce((total, row) => total + row.subtotal, 0))}
                </strong>
              </div>
              <div className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
                {rows.map((row) => (
                  <article key={row.id} className="space-y-2 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="min-w-0 truncate text-sm" style={{ color: "var(--text-primary)" }}>{row.student_name}</strong>
                      <strong className="shrink-0 text-sm tabular-nums" style={{ color: "var(--text-primary)" }}>{money(row.subtotal)}</strong>
                    </div>
                    <div className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {row.items.map((item) => (
                        <p key={item.id} className="break-words">
                          {item.product_name}{item.option_label ? ` · ${item.option_label}` : ""} × {item.quantity}
                        </p>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {row.activity_totals.map((activity) => (
                        <span key={activity.key}>{activity.label} {money(activity.amount)}</span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => onLoadDraft(row)} disabled={creating || hasCurrentComposerInput}
                        className="btn btn-ghost min-h-11 flex-1 text-xs disabled:opacity-50">載入編輯</button>
                      <button type="button" onClick={() => onRemoveDraft(row.id)}
                        disabled={creating} className="btn btn-ghost min-h-11 min-w-11 text-xs disabled:opacity-50"
                        aria-label={`移除${row.student_name}的待送出登記`}>
                        <X size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] text-sm" aria-label="待送出的班級代訂清單">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                      {["同學", "商品品項", "活動小計", "商品小計", "操作"].map((heading) => (
                        <th key={heading} scope="col" className="px-3 py-2 text-left text-xs font-semibold"
                          style={{ color: "var(--text-muted)" }}>{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <th scope="row" className="px-3 py-3 text-left text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {row.student_name}
                        </th>
                        <td className="max-w-sm px-3 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                          <ul className="space-y-1">
                            {row.items.map((item) => (
                              <li key={item.id} className="break-words">
                                {item.product_name}{item.option_label ? ` · ${item.option_label}` : ""} × {item.quantity}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="px-3 py-3 text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          <div className="space-y-1">
                            {row.activity_totals.map((activity) => (
                              <p key={activity.key}>{activity.label} · {money(activity.amount)}</p>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3 font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{money(row.subtotal)}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button type="button" onClick={() => onLoadDraft(row)}
                              disabled={creating || hasCurrentComposerInput}
                              className="min-h-11 rounded-md px-2 text-xs disabled:opacity-50"
                              style={{ border: "1px solid var(--border)", color: "var(--primary-text)" }}>載入編輯</button>
                            <button type="button" onClick={() => onRemoveDraft(row.id)}
                              disabled={creating} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md disabled:opacity-50"
                              style={{ border: "1px solid var(--border)", color: "var(--danger)" }}
                              aria-label={`移除${row.student_name}的待送出登記`}>
                              <X size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
    </>
  );
}
