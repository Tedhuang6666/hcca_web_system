"use client";

import { useEffect, useMemo, useState } from "react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import { money } from "@/lib/shop-class-orders";
import { catalogScopeKey, orderScopeKey, orderScopeParams } from "@/lib/shop-order-scope";
import type { CatalogCategoryOut, ClassMemberOut, OrderListItem, SchoolClassListItem } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import AdminAssistedOrder from "./AdminAssistedOrder";

async function allPages(load: (offset: number) => Promise<OrderListItem[]>) {
  const orders: OrderListItem[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await load(offset);
    orders.push(...page);
    if (page.length < 500) return orders;
  }
}

type StudentRow = {
  id: string;
  name: string;
  seat: number | null;
  studentId: string | null;
  member?: ClassMemberOut;
  orders: OrderListItem[];
};

function itemSummary(orders: OrderListItem[]) {
  const items = new Map<string, { label: string; quantity: number; separate: boolean }>();
  for (const order of orders) for (const item of order.items ?? []) {
    const options = item.selected_options.map((option) => `${option.group_name}：${option.value}`).join("／");
    const scope = order.activity_name ?? order.category_name ?? "一般商品";
    const separate = Boolean(order.supplement_class_id && !order.class_id);
    const key = JSON.stringify([order.activity_id ?? order.category_id ?? scope, item.product_id,
      item.selected_options.map((option) => option.option_id).sort(), separate]);
    const previous = items.get(key);
    items.set(key, {
      label: `${scope} · ${item.product_name ?? "商品"}${options ? `（${options}）` : ""}`,
      quantity: (previous?.quantity ?? 0) + item.quantity,
      separate,
    });
  }
  return [...items.values()];
}

export default function CouncilClassOrders({ target, catalog, classes, canOrder, optionsLoading, optionsError,
  onRetryOptions, onCreated, onClose,
}: {
  target: { id: string; label: string; scope?: { key: string; label: string } };
  catalog: CatalogCategoryOut[];
  classes: SchoolClassListItem[];
  canOrder: boolean;
  optionsLoading: boolean;
  optionsError: boolean;
  onRetryOptions: () => void;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ orders: OrderListItem[]; members: ClassMemberOut[] } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [recipient, setRecipient] = useState<ClassMemberOut | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    Promise.all([
      allPages((offset) => shopApi.listOrders({ my_only: "false", class_id: target.id,
        ...(target.scope ? orderScopeParams(target.scope.key) : {}), limit: "500", offset: String(offset) })),
      canOrder ? shopApi.listOrderRecipients(target.id) : Promise.resolve([]),
      canOrder ? allPages((offset) => shopApi.listSupplementOrders(offset)) : Promise.resolve([]),
    ]).then(([orders, members, supplements]) => {
      if (!active) return;
      const unique = new Map(orders.map((order) => [order.id, order]));
      for (const order of supplements) if (order.supplement_class_id === target.id) unique.set(order.id, order);
      setData({ orders: [...unique.values()].filter((order) => !["cancelled", "refunded"].includes(order.status)
        && (!target.scope || orderScopeKey(order) === target.scope.key)), members });
    }).catch((cause) => {
      if (active) setError(apiErrorMessage(cause, "無法載入班級訂購明細，請重試。"));
    });
    return () => { active = false; };
  }, [target.id, target.scope, canOrder, retry]);

  const rows = useMemo(() => {
    if (!data) return [];
    const students = new Map<string, StudentRow>();
    for (const member of data.members) students.set(member.user_id ?? member.id, {
      id: member.id, name: member.display_name, seat: member.seat_number ?? null,
      studentId: member.student_id, member, orders: [],
    });
    for (const order of data.orders) {
      const row = students.get(order.user_id) ?? {
        id: order.user_id, name: order.user_name ?? "未提供姓名", seat: null, studentId: null, orders: [],
      };
      row.orders.push(order);
      students.set(order.user_id, row);
    }
    return [...students.values()].sort((a, b) => (a.seat ?? Infinity) - (b.seat ?? Infinity)
      || a.name.localeCompare(b.name, "zh-TW"));
  }, [data]);
  const query = search.trim().toLocaleLowerCase("zh-TW");
  const visibleRows = rows.filter((row) => [row.name, row.seat, row.studentId]
    .some((value) => String(value ?? "").toLocaleLowerCase("zh-TW").includes(query)));

  return <Modal title={`${target.label} · 訂購明細`} size="3xl" onClose={() => { if (!saving) onClose(); }}>
    <p className="mb-4 text-sm" style={{ color: "var(--text-secondary)" }}>
      {target.scope ? `目前活動：${target.scope.label}。` : "顯示此班全部活動的有效訂購，"}取消與退款不計入。{canOrder
        ? "包含尚未訂購的名冊同學；獨立補收另外標示。"
        : "唯讀權限僅顯示已有班級訂單的同學。"}
    </p>
    {recipient ? <>
      <button type="button" className="btn btn-ghost mb-3 min-h-11" disabled={saving} onClick={() => setRecipient(null)}>
        返回明細（未送出的加購清單將清除）
      </button>
      <h3 className="mb-3 font-semibold">替 {recipient.display_name} 快捷加購</h3>
      <AdminAssistedOrder key={recipient.id} catalog={target.scope ? catalog.filter((category) => catalogScopeKey(category) === target.scope!.key) : catalog} classes={classes}
        initialClassId={target.id} initialStudentId={recipient.id} defaultOpen
        optionsError={optionsError} optionsLoading={optionsLoading} onRetry={onRetryOptions} onBusyChange={setSaving}
        onCreated={() => { setRetry((value) => value + 1); onCreated(); }} />
    </> : <>
      <label className="mb-4 grid gap-1 text-sm">{canOrder ? "搜尋同學姓名、學號或座號" : "搜尋同學姓名"}
        <input type="search" className="input min-h-11 text-base" value={search}
          onChange={(event) => setSearch(event.target.value)} />
      </label>
      {!data && !error && <p role="status">正在載入班級訂購明細…</p>}
      {error && <div role="alert" className="space-y-2"><p>{error}</p>
        <button type="button" className="btn btn-ghost min-h-11" onClick={() => setRetry((value) => value + 1)}>重試班級明細</button>
      </div>}
      {data && <>
        <p className="mb-3 text-sm" role="status">{rows.filter((row) => row.orders.length).length} 人已訂購 · 共 {data.orders.reduce((sum, order) => sum + (order.items ?? []).reduce((count, item) => count + item.quantity, 0), 0)} 件 · 合計 {money(data.orders.reduce((sum, order) => sum + order.total_price, 0))}</p>
        {!visibleRows.length ? <p role="status">{rows.length ? "沒有符合的同學，請調整搜尋。" : "此班尚無名冊或有效訂購。"}</p>
          : <ul className="divide-y" style={{ borderColor: "var(--border)" }} aria-label="全班同學訂購明細">
            {visibleRows.map((row) => {
              const items = itemSummary(row.orders);
              const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
              const total = row.orders.reduce((sum, order) => sum + order.total_price, 0);
              const unpaid = row.orders.filter((order) => !order.is_paid && !order.is_class_collected)
                .reduce((sum, order) => sum + order.total_price, 0);
              return <li key={row.id} className="space-y-2 py-4" aria-label={`${row.name}的訂購明細`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{row.seat !== null && `${row.seat} 號 · `}{row.name}</h3>
                  {canOrder && row.member && (row.member.user_id || row.member.roster_entry_id) && <button
                    type="button" className="btn btn-secondary min-h-11" aria-label={`替${row.name}快捷加購`}
                    onClick={() => setRecipient(row.member!)}>快捷加購</button>}
                </div>
                {items.length ? <>
                  <ul className="space-y-1 text-sm">{items.map((item, index) => <li key={index} className="break-words">
                    {item.label} × {item.quantity}{item.separate && <span className="ml-2" style={{ color: "var(--text-secondary)" }}>獨立補收</span>}
                  </li>)}</ul>
                  <p className="text-sm tabular-nums">共 {quantity} 件 · 合計 {money(total)} · 待繳 {money(unpaid)}</p>
                </> : <p className="text-sm" style={{ color: "var(--text-secondary)" }}>尚未訂購</p>}
              </li>;
            })}
          </ul>}
      </>}
    </>}
  </Modal>;
}
