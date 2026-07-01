"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckSquare, Plus, RefreshCw, Search, Square } from "lucide-react";
import { toast } from "sonner";

import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import type {
  CatalogCategoryOut,
  CatalogProductOut,
  ClassMemberOut,
  OrderListItem,
  ProductOut,
  ShopClassSummaryOut,
} from "@/lib/types";

type PaidFilter = "all" | "paid" | "unpaid";
type AssistedFilter = "all" | "assisted";

type CatalogChoice = CatalogProductOut & {
  category: string;
  series: string;
};

const emptySummary: ShopClassSummaryOut = {
  class_count: 0,
  order_count: 0,
  item_count: 0,
  total_amount: 0,
  paid_amount: 0,
  unpaid_amount: 0,
  paid_order_count: 0,
  unpaid_order_count: 0,
  assisted_order_count: 0,
  product_rows: [],
};

function money(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function flattenCatalog(catalog: CatalogCategoryOut[]): CatalogChoice[] {
  return catalog.flatMap((category) =>
    category.series.flatMap((series) =>
      series.products.map((product) => ({
        ...product,
        category: category.name,
        series: series.name,
      })),
    ),
  );
}

export default function ClassOrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [summary, setSummary] = useState<ShopClassSummaryOut>(emptySummary);
  const [members, setMembers] = useState<ClassMemberOut[]>([]);
  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [productDetail, setProductDetail] = useState<ProductOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [assistedFilter, setAssistedFilter] = useState<AssistedFilter>("all");
  const [productFilter, setProductFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [studentId, setStudentId] = useState("");
  const [orderProductId, setOrderProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [optionIds, setOptionIds] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  const catalogProducts = useMemo(() => flattenCatalog(catalog), [catalog]);
  const activeProducts = catalogProducts.filter((product) => product.status === "active");
  const productFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const product of catalogProducts) byId.set(product.id, product.name);
    for (const row of summary.product_rows) byId.set(row.product_id, row.product_name);
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"));
  }, [catalogProducts, summary.product_rows]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: { is_paid?: string; assisted_only?: string; product_id?: string; limit: string } = {
      limit: "500",
    };
    if (paidFilter !== "all") params.is_paid = paidFilter === "paid" ? "true" : "false";
    if (assistedFilter === "assisted") params.assisted_only = "true";
    if (productFilter) params.product_id = productFilter;
    try {
      const [orderItems, summaryData] = await Promise.all([
        shopApi.listClassOrders(params),
        shopApi.classSummary(params),
      ]);
      setOrders(orderItems);
      setSummary(summaryData);
      setSelectedIds((current) => current.filter((id) => orderItems.some((item) => item.id === id)));
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入失敗"));
    } finally {
      setLoading(false);
    }
  }, [assistedFilter, paidFilter, productFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    shopApi.catalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
    classApi.myClass()
      .then(async (schoolClass) => {
        if (!schoolClass) return;
        const data = await classApi.members(schoolClass.id);
        setMembers(data);
      })
      .catch(() => setMembers([]));
  }, []);

  useEffect(() => {
    setOptionIds({});
    setProductDetail(null);
    if (!orderProductId) return;
    shopApi.getProduct(orderProductId)
      .then((product) => {
        setProductDetail(product);
        setOptionIds(Object.fromEntries(
          product.variant_groups.map((group) => [group.id, group.options.find((option) => option.is_active)?.id ?? ""]),
        ));
      })
      .catch((e) => toast.error(apiErrorMessage(e, "商品載入失敗")));
  }, [orderProductId]);

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) =>
      order.serial_number.toLowerCase().includes(needle)
      || (order.user_name ?? "").toLowerCase().includes(needle)
      || (order.class_label ?? "").toLowerCase().includes(needle),
    );
  }, [orders, query]);

  const selectedSet = new Set(selectedIds);
  const selectedOrders = visibleOrders.filter((order) => selectedSet.has(order.id));
  const allVisibleSelected = visibleOrders.length > 0 && visibleOrders.every((order) => selectedSet.has(order.id));

  const togglePaid = async (order: OrderListItem) => {
    setBusy(order.id);
    try {
      await shopApi.setOrderPaid(order.id, !order.is_paid);
      toast.success(order.is_paid ? "已取消繳費標示" : "已標示為已繳費");
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
    } finally {
      setBusy(null);
    }
  };

  const toggleSelected = (orderId: string) => {
    setSelectedIds((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId],
    );
  };

  const toggleAllVisible = () => {
    setSelectedIds(allVisibleSelected ? [] : visibleOrders.map((order) => order.id));
  };

  const batchSetPaid = async (isPaid: boolean) => {
    const targets = selectedOrders.filter((order) => order.is_paid !== isPaid);
    if (targets.length === 0) {
      toast.info(isPaid ? "選取訂單都已標示為已繳費" : "選取訂單都已是未繳費");
      return;
    }
    setBatchBusy(true);
    try {
      await Promise.all(targets.map((order) => shopApi.setOrderPaid(order.id, isPaid)));
      setSelectedIds([]);
      toast.success(isPaid ? `已標示 ${targets.length} 筆為已繳費` : `已取消 ${targets.length} 筆繳費標示`);
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "批量更新失敗"));
    } finally {
      setBatchBusy(false);
    }
  };

  const submitClassOrder = async () => {
    if (!studentId || !orderProductId) {
      toast.error("請選擇學生與商品");
      return;
    }
    const optionValues = productDetail?.variant_groups.map((group) => optionIds[group.id]).filter(Boolean) ?? [];
    if ((productDetail?.variant_groups.length ?? 0) !== optionValues.length) {
      toast.error("請完成所有商品選項");
      return;
    }
    setCreating(true);
    try {
      await shopApi.createClassOrder({
        user_id: studentId,
        items: [{ product_id: orderProductId, quantity, option_ids: optionValues }],
        notes: notes.trim() || null,
      });
      toast.success("已完成班級代訂");
      setStudentId("");
      setQuantity(1);
      setNotes("");
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "代訂失敗"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>校園商品</p>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            班級商品工作台
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} className="btn btn-ghost" aria-label="重新整理">
            <RefreshCw size={15} /> 重新整理
          </button>
          <Link href="/shop" className="btn btn-ghost">商品訂購</Link>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "有效訂單", value: `${summary.order_count} 筆` },
          { label: "商品件數", value: `${summary.item_count} 件` },
          { label: "應收金額", value: money(summary.total_amount) },
          { label: "未收金額", value: money(summary.unpaid_amount) },
        ].map((item) => (
          <div key={item.label} className="rounded-lg p-4"
            style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{item.label}</p>
            <p className="mt-1 text-xl font-bold" style={{ color: "var(--primary)" }}>{item.value}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="min-w-0 space-y-4">
          <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_220px]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={15} style={{ color: "var(--text-muted)" }} />
                <input
                  className="input w-full pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜尋訂單、姓名、班級"
                />
              </label>
              <select className="input" value={paidFilter} onChange={(event) => setPaidFilter(event.target.value as PaidFilter)}>
                <option value="all">全部繳費</option>
                <option value="unpaid">未繳費</option>
                <option value="paid">已繳費</option>
              </select>
              <select className="input" value={assistedFilter} onChange={(event) => setAssistedFilter(event.target.value as AssistedFilter)}>
                <option value="all">全班訂單</option>
                <option value="assisted">只看代訂</option>
              </select>
              <select className="input" value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
                <option value="">全部商品</option>
                {productFilterOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={toggleAllVisible} disabled={visibleOrders.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  {allVisibleSelected ? "取消選取" : "全選目前列表"}
                </button>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>已選 {selectedIds.length} 筆</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={selectedIds.length === 0 || batchBusy} onClick={() => batchSetPaid(true)}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                  style={{ border: "1px solid var(--border)", color: "#16a34a" }}>
                  批量已繳
                </button>
                <button type="button" disabled={selectedIds.length === 0 || batchBusy} onClick={() => batchSetPaid(false)}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  批量未繳
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : visibleOrders.length === 0 ? (
              <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
                <p className="text-sm">目前沒有符合條件的班級訂單</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm" role="table" aria-label="班級商品訂單">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["", "訂單編號", "訂購人", "班級", "來源", "狀態", "金額", "繳費", ""].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left text-xs font-semibold"
                          style={{ color: "var(--text-muted)" }} scope="col">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.map((order, index) => (
                      <tr key={order.id} style={index < visibleOrders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => toggleSelected(order.id)}
                            aria-label={selectedSet.has(order.id) ? "取消選取訂單" : "選取訂單"}
                            style={{ color: selectedSet.has(order.id) ? "var(--primary)" : "var(--text-muted)" }}>
                            {selectedSet.has(order.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/shop/orders/${order.id}`} className="text-xs font-mono hover:underline" style={{ color: "var(--primary)" }}>
                            {order.serial_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{order.user_name ?? "-"}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{order.class_label ?? "-"}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                          {order.assistance_scope === "class_assisted" ? "幹部代訂" : "自行訂購"}
                        </td>
                        <td className="px-4 py-3"><OrderStatusBadge status={order.status} /></td>
                        <td className="px-4 py-3 font-medium" style={{ color: "var(--text-primary)" }}>{money(order.total_price)}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={order.is_paid
                              ? { background: "rgba(34,197,94,0.12)", color: "#16a34a" }
                              : { background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                            {order.is_paid ? "已繳費" : "未繳費"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => togglePaid(order)} disabled={busy === order.id}
                            className="btn btn-ghost px-3 py-1.5 text-xs" aria-busy={busy === order.id}>
                            {order.is_paid ? "取消" : "已繳"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>商品彙總</h2>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{summary.product_rows.length} 項</span>
            </div>
            <div className="space-y-2">
              {summary.product_rows.length === 0 ? (
                <p className="py-5 text-center text-sm" style={{ color: "var(--text-muted)" }}>尚無商品資料</p>
              ) : summary.product_rows.slice(0, 8).map((row) => (
                <button key={row.product_id} type="button" onClick={() => setProductFilter(row.product_id)}
                  className="w-full rounded-md p-3 text-left"
                  style={{ border: "1px solid var(--border)", background: productFilter === row.product_id ? "var(--primary-dim)" : "transparent" }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{row.product_name}</span>
                    <span className="text-sm font-semibold" style={{ color: "var(--primary)" }}>{row.quantity} 件</span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{money(row.total_amount)}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              <Plus size={15} /> 班級代訂
            </h2>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>學生</span>
                <select className="input" value={studentId} onChange={(event) => setStudentId(event.target.value)}>
                  <option value="">選擇本班學生</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.display_name}{member.student_id ? `（${member.student_id}）` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>商品</span>
                <select className="input" value={orderProductId} onChange={(event) => setOrderProductId(event.target.value)}>
                  <option value="">選擇商品</option>
                  {activeProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.category} / {product.series} / {product.name}
                    </option>
                  ))}
                </select>
              </label>
              {productDetail?.variant_groups.map((group) => (
                <label key={group.id} className="grid gap-1 text-sm">
                  <span style={{ color: "var(--text-muted)" }}>{group.name}</span>
                  <select className="input" value={optionIds[group.id] ?? ""}
                    onChange={(event) => setOptionIds((current) => ({ ...current, [group.id]: event.target.value }))}>
                    <option value="">選擇{group.name}</option>
                    {group.options.filter((option) => option.is_active).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.value}{option.price_delta ? ` (${option.price_delta > 0 ? "+" : ""}${option.price_delta})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>數量</span>
                <input className="input" type="number" min={1} max={100} value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} />
              </label>
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>備註</span>
                <input className="input" value={notes} maxLength={500}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="尺寸確認、收款備註等" />
              </label>
              <button type="button" onClick={submitClassOrder} disabled={creating || members.length === 0}
                className="btn w-full disabled:opacity-50"
                style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                {creating ? "建立中..." : "建立代訂訂單"}
              </button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
