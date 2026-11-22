"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { CheckSquare, Edit2, Search, Square, Trash2 } from "lucide-react";
import SeparateOrderButton from "@/components/shop/SeparateOrderButton";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { orderScopeKey } from "@/lib/shop-order-scope";
import { money } from "@/lib/shop-class-orders";
import type { ActivityOptionRow } from "@/components/shop/classOrderSelectors";
import { isCollectableOrder } from "@/components/shop/classOrderSelectors";
import type { ClassMemberOut, OrderListItem } from "@/lib/types";

type PaidFilter = "all" | "paid" | "unpaid";
type AssistedFilter = "all" | "assisted";
type ProductFilterOption = [string, string];
type ActivityFilterOption = Pick<ActivityOptionRow, "key" | "label">;
type ActivityGroup = { label: string; orders: OrderListItem[] };

type Props = {
  selectedActivityLabel: string;
  visibleOrders: OrderListItem[];
  query: string;
  setQuery: (value: string) => void;
  members: ClassMemberOut[];
  memberFilter: string;
  setMemberFilter: (value: string) => void;
  paidFilter: PaidFilter;
  setPaidFilter: (value: PaidFilter) => void;
  assistedFilter: AssistedFilter;
  setAssistedFilter: (value: AssistedFilter) => void;
  productFilter: string;
  setProductFilter: (value: string) => void;
  setActivityFilter: (value: string) => void;
  activityFilter: string;
  productFilterOptions: ProductFilterOption[];
  filterActivityRows: ActivityFilterOption[];
  clearFilters: () => void;
  selectablePageOrders: OrderListItem[];
  allVisibleSelected: boolean;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  selectedOrders: OrderListItem[];
  selectedActivityGroups: Map<string, ActivityGroup>;
  batchBusy: boolean;
  batchSetPaid: (activityKey: string, collected: boolean) => void | Promise<void>;
  loading: boolean;
  openCreate: () => void;
  pageOrders: OrderListItem[];
  activityLabel: (activityId: string | null | undefined) => string;
  togglePaid: (order: OrderListItem) => void | Promise<void>;
  busy: string | null;
  selectedSet: Set<string>;
  openEdit: (order: OrderListItem) => void;
  load: () => void | Promise<void>;
  onCancelOrder: (order: OrderListItem) => void;
  currentPage: number;
  pageCount: number;
  setOrderPage: Dispatch<SetStateAction<number>>;
  orderListPageSize: number;
};

export function ClassOrdersListPanel({
  selectedActivityLabel, visibleOrders, query, setQuery, members, memberFilter, setMemberFilter,
  paidFilter, setPaidFilter, assistedFilter, setAssistedFilter, productFilter, setProductFilter,
  setActivityFilter, activityFilter, productFilterOptions, filterActivityRows, clearFilters,
  selectablePageOrders, allVisibleSelected, setSelectedIds, selectedOrders, selectedActivityGroups,
  batchBusy, batchSetPaid, loading, openCreate, pageOrders, activityLabel, togglePaid, busy, selectedSet,
  openEdit, load, onCancelOrder, currentPage, pageCount, setOrderPage, orderListPageSize,
}: Props) {
  return (
<section id="class-orders-list" className="min-w-0 scroll-mt-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-fg-primary!" >班級訂單 · {selectedActivityLabel}</h2>
              <p className="mt-1 text-xs text-fg-muted!" >此操作僅記錄班代收款，班聯仍須確認。</p>
            </div>
            <span className="text-sm tabular-nums text-fg-muted!" >{visibleOrders.length} 筆</span>
          </div>
          <div className="rounded-lg p-4 border! border-border! bg-card!" >
            <div className="grid gap-3 md:grid-cols-[1fr_180px_160px]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted!" size={15}  />
                <input className="input w-full pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋訂單編號、姓名" aria-label="搜尋訂單編號或姓名" />
              </label>
              <select className="input min-h-11" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} aria-label="依學生篩選">
                <option value="">全班學生</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name}{m.student_id ? `（${m.student_id}）` : ""}</option>
                ))}
              </select>
              <select className="input min-h-11" value={paidFilter} onChange={(e) => setPaidFilter(e.target.value as PaidFilter)} aria-label="依收款狀態篩選">
                <option value="all">全部收款紀錄</option>
                <option value="unpaid">待收款</option>
                <option value="paid">已收款</option>
              </select>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <select className="input min-h-11" value={assistedFilter} onChange={(e) => setAssistedFilter(e.target.value as AssistedFilter)} aria-label="依訂單來源篩選">
                <option value="all">全班訂單</option>
                <option value="assisted">只看代訂</option>
              </select>
              <select className="input min-h-11" value={productFilter} onChange={(e) => setProductFilter(e.target.value)} aria-label="依商品篩選">
                <option value="">全部商品</option>
                {productFilterOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select className="input min-h-11" value={activityFilter} onChange={(e) => { setActivityFilter(e.target.value); setProductFilter(""); setSelectedIds([]); }} aria-label="依活動篩選">
                <option value="all">目前活動全部商品</option>
                {filterActivityRows.map((row) => (
                  <option key={row.key} value={row.key}>{row.label}</option>
                ))}
              </select>
            </div>
            {(activityFilter !== "all" || productFilter || paidFilter !== "all" || assistedFilter !== "all" || memberFilter || query) && (
              <div className="mt-3 flex justify-end">
                <button type="button" onClick={clearFilters} className="btn btn-ghost min-h-11 px-3 text-xs">
                  清除所有篩選
                </button>
              </div>
            )}
          </div>

          <div className="rounded-lg overflow-hidden border! border-border! bg-card!" >
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between border-b! border-b-border!"
              >
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => {
                  const pageIds = selectablePageOrders.map((order) => order.id);
                  setSelectedIds((current) => allVisibleSelected
                    ? current.filter((id) => !pageIds.includes(id))
                    : Array.from(new Set([...current, ...pageIds])));
                }}
                  disabled={!selectablePageOrders.length}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs disabled:opacity-50 border! border-border! text-fg-secondary!"
                  >
                  {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  {allVisibleSelected ? "取消選取本頁" : "全選本頁"}
                </button>
                <span className="text-xs text-fg-muted!" >已選 {selectedOrders.length} 筆</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[...selectedActivityGroups.entries()].map(([activityKey, group]) => (
                  <div key={activityKey} className="flex flex-wrap items-center gap-1 rounded-md px-2 py-1 border! border-border!"
                    >
                    <span className="mr-1 text-xs text-fg-muted!" >
                      {group.label} · {group.orders.length} 筆
                    </span>
                    <button type="button" disabled={batchBusy} onClick={() => batchSetPaid(activityKey, true)}
                      className="min-h-9 rounded-md px-2 text-xs font-medium disabled:opacity-50 border! border-border! text-success!"
                      >標記已收款</button>
                    <button type="button" disabled={batchBusy} onClick={() => batchSetPaid(activityKey, false)}
                      className="min-h-9 rounded-md px-2 text-xs font-medium disabled:opacity-50 border! border-border! text-fg-secondary!"
                      >撤銷收款</button>
                  </div>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="py-16 text-center text-sm text-fg-muted!" >載入中...</div>
            ) : !visibleOrders.length ? (
              <div className="py-16 text-center text-fg-muted!" >
                <p className="text-sm">目前沒有符合條件的班級訂單</p>
                <button type="button" onClick={openCreate} className="btn btn-ghost mt-3 text-xs">替同學建立第一筆訂單</button>
              </div>
            ) : (
              <>
              <div className="space-y-2 p-3 md:hidden">
                {pageOrders.map((order) => (
                  <article key={order.id} className="rounded-md p-3 border! border-border!" >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/shop/orders/${order.id}?from=class`} className="block truncate text-xs font-mono font-medium hover:underline text-accent-text!" >
                          {order.serial_number}
                        </Link>
                        <p className="mt-1 truncate text-sm font-medium text-fg-primary!" >{order.user_name ?? "未具名訂購人"}</p>
                        <p className="mt-0.5 text-xs text-fg-muted!" >
                          {order.activity_name ?? order.category_name ?? activityLabel(orderScopeKey(order))} · {order.assistance_scope === "class_assisted" ? "幹部代訂" : "自行訂購"}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                        style={order.is_class_collected
                          ? { background: "rgba(34,197,94,0.12)", color: "#16a34a" }
                          : { background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                        {order.is_class_collected ? "已收款" : "待收款"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <OrderStatusBadge status={order.status} />
                      <span className="text-sm font-semibold tabular-nums text-fg-primary!" >{money(order.total_price)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {isCollectableOrder(order) ? (
                        <button type="button" onClick={() => togglePaid(order)} disabled={busy === order.id}
                          className="min-h-11 rounded-md px-3 text-xs font-medium disabled:opacity-50 border! border-border!"
                          aria-label={order.is_class_collected ? `撤銷${order.user_name ?? "此筆"}收款` : `標記${order.user_name ?? "此筆"}已收款`}
                          style={{ color: order.is_class_collected ? "var(--text-secondary)" : "var(--success)" }}>
                          {order.is_class_collected ? "撤銷收款" : "標記已收"}
                        </button>
                      ) : (
                        <span className="inline-flex min-h-11 items-center px-3 text-xs text-fg-muted!" >
                          不列入收款
                        </span>
                      )}
                      <button type="button" disabled={!isCollectableOrder(order)}
                        onClick={() => setSelectedIds((current) => current.includes(order.id) ? current.filter((id) => id !== order.id) : [...current, order.id])}
                        aria-pressed={selectedSet.has(order.id)}
                        className="min-h-11 rounded-md px-3 text-xs disabled:opacity-50 border! border-border! text-fg-secondary!" >
                        {!isCollectableOrder(order) ? "無法選取" : selectedSet.has(order.id) ? "取消選取" : "選取"}
                      </button>
                      {isCollectableOrder(order) && (
                        <>
                          {!order.is_paid && !order.is_class_collected && (
                            <button type="button" onClick={() => openEdit(order)} className="min-h-11 rounded-md px-3 text-xs border! border-border! text-accent-text!"
                            >修改</button>
                          )}
                          <SeparateOrderButton order={order} onSeparated={() => { void load(); }} />
          <button type="button" onClick={() => onCancelOrder(order)} className="min-h-11 rounded-md px-3 text-xs border! border-border!"
                            style={{ color: "#ef4444" }}>取消</button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[820px] text-sm" role="table">
                  <thead>
                    <tr  className="border-b! border-b-border!">
                      {["", "訂單編號", "訂購人", "活動", "來源", "狀態", "應收金額", "班代收款", "操作"].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-fg-muted!"
                           scope="col">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageOrders.map((order, idx) => (
                      <tr key={order.id} style={idx < pageOrders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                        <td className="px-4 py-3">
                          <button type="button" disabled={!isCollectableOrder(order)}
                            onClick={() => setSelectedIds((cur) => cur.includes(order.id) ? cur.filter((id) => id !== order.id) : [...cur, order.id])}
                            aria-label={`${selectedSet.has(order.id) ? "取消選取" : "選取"}${order.user_name ?? order.serial_number}`}
                            aria-pressed={selectedSet.has(order.id)}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md disabled:opacity-40"
                            style={{ color: selectedSet.has(order.id) ? "var(--primary-text)" : "var(--text-muted)" }}>
                            {selectedSet.has(order.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/shop/orders/${order.id}?from=class`} className="text-xs font-mono hover:underline text-accent-text!" >
                            {order.serial_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-xs text-fg-secondary!" >{order.user_name ?? "-"}</td>
                        <td className="px-4 py-3 text-xs text-fg-muted!" >{order.activity_name ?? order.category_name ?? activityLabel(orderScopeKey(order))}</td>
                        <td className="px-4 py-3 text-xs text-fg-muted!" >
                          {order.assistance_scope === "class_assisted" ? "幹部代訂" : "自行訂購"}
                        </td>
                        <td className="px-4 py-3"><OrderStatusBadge status={order.status} /></td>
                        <td className="px-4 py-3 font-medium tabular-nums text-fg-primary!" >{money(order.total_price)}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={order.is_class_collected
                              ? { background: "rgba(34,197,94,0.12)", color: "#16a34a" }
                              : { background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                            {order.is_class_collected ? "已收款" : "待收款"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {isCollectableOrder(order) ? (
                              <button type="button" onClick={() => togglePaid(order)} disabled={busy === order.id}
                                aria-label={order.is_class_collected ? `撤銷${order.user_name ?? "此筆"}收款` : `標記${order.user_name ?? "此筆"}已收款`}
                                className="min-h-11 rounded-md px-3 text-xs disabled:opacity-50 border! border-border!"
                                >
                                {order.is_class_collected ? "撤銷收款" : "標記已收"}
                              </button>
                            ) : (
                              <span className="px-2 text-xs text-fg-muted!" >不列入收款</span>
                            )}
                            {isCollectableOrder(order) && (
                              <>
                                {!order.is_paid && !order.is_class_collected && (
                                  <button type="button" onClick={() => openEdit(order)} title="修改訂單"
                                  className="rounded-md p-1 hover:opacity-70 text-accent-text!" >
                                  <Edit2 size={14} />
                                  </button>
                                )}
                                <SeparateOrderButton order={order} onSeparated={() => { void load(); }} />
                                <button type="button" onClick={() => onCancelOrder(order)} title="取消訂單"
                                  className="rounded-md p-1 hover:opacity-70" style={{ color: "#ef4444" }}>
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
          {visibleOrders.length > orderListPageSize && (
            <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="訂單分頁">
              <p className="text-xs tabular-nums text-fg-muted!" aria-live="polite" >
                第 {currentPage + 1} / {pageCount} 頁 · 共 {visibleOrders.length} 筆
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOrderPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0} className="btn btn-ghost min-h-11 px-3 text-xs disabled:opacity-50">
                  上一頁
                </button>
                <button type="button" onClick={() => setOrderPage(Math.min(pageCount - 1, currentPage + 1))}
                  disabled={currentPage >= pageCount - 1} className="btn btn-ghost min-h-11 px-3 text-xs disabled:opacity-50">
                  下一頁
                </button>
              </div>
            </nav>
          )}
        </section>
  );
}
