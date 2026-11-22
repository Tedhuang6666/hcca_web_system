"use client";

import type { ClassMemberOut, OrderListItem } from "@/lib/types";
import { orderScopeKey } from "@/lib/shop-order-scope";
import { summarizeOrderItems } from "@/lib/shop-order-items";
import { money } from "@/lib/shop-class-orders";
import type { ActivityOptionRow } from "@/components/shop/classOrderSelectors";

type SeatRow = {
  id: string;
  name: string;
  seat: number | null | undefined;
  orders: OrderListItem[];
  amount: number;
  collected: number;
  councilPaid: number;
};

type Props = {
  activityRows: ActivityOptionRow[];
  ledgerActivities: ActivityOptionRow[];
  ledgerActivityLabel: string;
  loading: boolean;
  loadFailed: boolean;
  seatCollectionTotals: { amount: number; collected: number };
  seatSearch: string;
  setSeatSearch: (value: string) => void;
  seatFilter: "all" | "unpaid" | "paid";
  setSeatFilter: (value: "all" | "unpaid" | "paid") => void;
  membersLoading: boolean;
  membersLoadFailed: boolean;
  filteredSeatRows: SeatRow[];
  members: ClassMemberOut[];
  busy: string | null;
  batchBusy: boolean;
  setSeatCollected: (memberId: string, collected: boolean) => void | Promise<void>;
  openCreateForSeat: (memberId: string) => void;
};

export function ClassOrderCollectionPanel({
  activityRows, ledgerActivities, ledgerActivityLabel, loading, loadFailed, seatCollectionTotals,
  seatSearch, setSeatSearch, seatFilter, setSeatFilter, membersLoading, membersLoadFailed,
  filteredSeatRows, members, busy, batchBusy, setSeatCollected, openCreateForSeat,
}: Props) {
  return (
<section aria-labelledby="seat-collection-heading" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="seat-collection-heading" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>登記收款</h2>
            </div>
          </div>
          {ledgerActivities.length > 0 && <p className="text-base font-semibold">本次收款：{ledgerActivityLabel}</p>}
          {ledgerActivities.length > 0 && (loading ? (
            <p className="rounded-lg px-4 py-3 text-sm" role="status"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              正在載入全班收款統計…
            </p>
          ) : loadFailed ? (
            <p className="rounded-lg px-4 py-3 text-sm" role="alert"
              style={{ border: "1px solid var(--danger-border)", background: "var(--danger-dim)", color: "var(--danger)" }}>
              無法載入全班收款統計，請重新整理後再試。
            </p>
          ) : (
            <div className="rounded-lg px-4 py-3" role="group" aria-label="全班收款統計"
              style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <p className="mb-2 text-xs" style={{ color: "var(--text-secondary)" }}>全班進度 · {ledgerActivityLabel}（不受下方篩選影響）</p>
              <dl className="grid gap-y-2 text-sm sm:grid-cols-2 sm:gap-x-6">
                <div className="flex items-baseline justify-between gap-3">
                  <dt style={{ color: "var(--text-secondary)" }}>全班應收</dt>
                  <dd className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {money(seatCollectionTotals.amount)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt style={{ color: "var(--text-secondary)" }}>班代目前已收</dt>
                  <dd className="font-semibold tabular-nums" style={{ color: "var(--success)" }}>
                    {money(seatCollectionTotals.collected)}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
          {activityRows.length === 0 ? (
            <p className="rounded-lg px-4 py-6 text-sm" role={loadFailed ? "alert" : "status"}
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              {loading ? "正在載入活動與座號收款資料…" : loadFailed ? "無法載入活動與座號收款資料，請重新整理後再試。" : "目前沒有可收款的活動"}
            </p>
          ) : !ledgerActivities.length ? (
            <p role="status" className="py-4 text-sm" style={{ color: "var(--text-secondary)" }}>請在頁面上方選擇本次要收款的活動。</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <input className="input min-h-11 min-w-0 flex-1" placeholder="搜尋座號或姓名" aria-label="搜尋收款同學"
                  value={seatSearch} onChange={(event) => setSeatSearch(event.target.value)} />
                <select className="input min-h-11" aria-label="名冊收款狀態" value={seatFilter}
                  onChange={(event) => setSeatFilter(event.target.value as typeof seatFilter)}>
                  <option value="all">全班同學</option><option value="unpaid">只看待收</option><option value="paid">已收齊</option>
                </select>
              </div>
              {membersLoading ? (
                <p className="rounded-lg px-4 py-6 text-sm" role="status"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>正在載入班級座號與收款資料…</p>
              ) : membersLoadFailed ? (
                <p className="rounded-lg px-4 py-6 text-sm" role="alert"
                  style={{ border: "1px solid var(--danger-border)", background: "var(--danger-dim)", color: "var(--danger)" }}>無法載入本班座號名冊，請重新整理後再試。</p>
              ) : (
                <div className="rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
                  <div className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
                    {filteredSeatRows.map((row) => {
                      const outstanding = row.amount - row.collected;
                      const seatBusy = busy === `seat:${row.id}`;
                      return (
                        <article key={row.id} className="space-y-3 p-4">
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>
                              {row.seat == null ? "未登錄座號" : `${row.seat} 號`} · {row.name}
                            </h3>
                          </div>
                          <p className="text-sm" style={{ color: "var(--text-secondary)", overflowWrap: "anywhere" }}>
                            {summarizeOrderItems(row.orders.flatMap((order) => order.items ?? [])) || (row.orders.length ? "品項資訊請查看明細" : "尚未登記")}
                            {ledgerActivities.length > 1 && <span className="mt-1 block text-xs">{ledgerActivities.map((activity) => `${activity.label} ${money(row.orders.filter((order) => orderScopeKey(order) === activity.key && !order.is_class_collected).reduce((sum, order) => sum + order.total_price, 0))}`).join("／")}</span>}
                          </p>
                          <p className="flex items-baseline justify-between gap-3 text-sm">
                            <span style={{ color: "var(--text-secondary)" }}>{outstanding > 0 ? row.collected > 0 ? "還要補收" : "還要收" : row.orders.length ? "已收齊" : "尚未訂購"}</span>
                            <strong className="text-lg tabular-nums" style={{ color: "var(--text-primary)" }}>{money(outstanding)}</strong>
                          </p>
                          {outstanding > 0 && <button type="button" className="btn btn-secondary min-h-11 w-full px-3 text-sm"
                            disabled={busy !== null || loadFailed || batchBusy}
                            onClick={() => void setSeatCollected(row.id, true)}>{seatBusy ? "處理中" : `已收到 ${money(outstanding)}`}</button>}
                          <details>
                            <summary className="min-h-11 cursor-pointer py-3 text-sm" style={{ color: "var(--text-secondary)" }}>收款明細與其他操作</summary>
                            <dl className="grid grid-cols-2 gap-2 text-sm">
                              <div><dt>應收</dt><dd className="tabular-nums">{money(row.amount)}</dd></div>
                              <div><dt>班代已收</dt><dd className="tabular-nums">{money(row.collected)}</dd></div>
                              <div><dt>班聯已確認</dt><dd className="tabular-nums">{money(row.councilPaid)}</dd></div>
                            </dl>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {row.collected > 0 && <button type="button" className="btn btn-ghost min-h-11 px-3 text-sm"
                                disabled={busy !== null || loadFailed || batchBusy}
                                onClick={() => void setSeatCollected(row.id, false)}>撤銷收款</button>}
                              <button type="button" className="btn btn-ghost min-h-11 px-3 text-sm"
                                disabled={!members.some((member) => member.id === row.id) || loadFailed}
                                onClick={() => openCreateForSeat(row.id)}>代訂</button>
                            </div>
                          </details>
                        </article>
                      );
                    })}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm" aria-label={`${ledgerActivityLabel || "活動"}各座號收款`}>
                    <thead style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                      <tr>
                        {["同學", "預購品項", "還要收", "收款"].map((heading) => (
                          <th key={heading} scope="col" className="px-3 py-3 text-left font-semibold">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSeatRows.map((row) => {
                        const outstanding = row.amount - row.collected;
                        const seatBusy = busy === `seat:${row.id}`;
                        return (
                          <tr key={row.id} style={{ borderTop: "1px solid var(--border)" }}>
                            <th scope="row" className="px-3 py-3 text-left tabular-nums" style={{ color: "var(--text-primary)" }}>
                              <span className="block text-xs font-normal" style={{ color: "var(--text-secondary)" }}>{row.seat == null ? "未編座號" : `${row.seat} 號`}</span>
                              {row.name}
                            </th>
                            <td className="max-w-64 px-3 py-3" style={{ color: "var(--text-secondary)", overflowWrap: "anywhere" }}>
                              {summarizeOrderItems(row.orders.flatMap((order) => order.items ?? [])) || (row.orders.length ? "品項資訊請查看明細" : "尚未登記")}
                            {ledgerActivities.length > 1 && <span className="mt-1 block text-xs">{ledgerActivities.map((activity) => `${activity.label} ${money(row.orders.filter((order) => orderScopeKey(order) === activity.key && !order.is_class_collected).reduce((sum, order) => sum + order.total_price, 0))}`).join("／")}</span>}
                            </td>
                            <td className="px-3 py-3 font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                              {outstanding > 0 ? <>{row.collected > 0 && <span className="block text-xs">待補收</span>}{money(outstanding)}</> : row.orders.length ? "已收齊" : "尚未訂購"}
                            </td>
                            <td className="px-3 py-2">
                              {outstanding > 0 && <button type="button" className="btn btn-secondary min-h-11 px-3 text-sm"
                                disabled={busy !== null || loadFailed || batchBusy}
                                onClick={() => void setSeatCollected(row.id, true)}>
                                {seatBusy ? "處理中" : `已收到 ${money(outstanding)}`}
                              </button>}
                              <details>
                                <summary className="min-h-11 cursor-pointer py-3 text-xs" style={{ color: "var(--text-secondary)" }}>明細與其他操作</summary>
                                <dl className="space-y-1 pb-2 text-xs font-normal">
                                  <div><dt className="inline">應收：</dt><dd className="inline tabular-nums">{money(row.amount)}</dd></div>
                                  <div><dt className="inline">班代已收：</dt><dd className="inline tabular-nums">{money(row.collected)}</dd></div>
                                  <div><dt className="inline">班聯已確認：</dt><dd className="inline tabular-nums">{money(row.councilPaid)}</dd></div>
                                </dl>
                                <div className="flex flex-wrap gap-2">
                                  {row.collected > 0 && <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs"
                                    disabled={busy !== null || loadFailed || batchBusy}
                                    onClick={() => void setSeatCollected(row.id, false)}>撤銷收款</button>}
                                  <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs"
                                    disabled={!members.some((member) => member.id === row.id) || loadFailed}
                                    onClick={() => openCreateForSeat(row.id)}>代訂</button>
                                </div>
                              </details>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                  {filteredSeatRows.length === 0 && (
                    <p className="px-4 py-6 text-sm" role="status" style={{ color: "var(--text-secondary)" }}>目前沒有符合條件的同學；可以清除搜尋或切換收款狀態。</p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
  );
}
