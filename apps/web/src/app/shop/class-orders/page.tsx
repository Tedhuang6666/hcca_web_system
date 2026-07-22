"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckSquare, Edit2, Lock, LockOpen, Plus, RefreshCw, Search, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import type {
  CatalogCategoryOut,
  CatalogProductOut,
  ClassMemberOut,
  CloseStatusItem,
  OrderListItem,
  OrderOut,
  ProductOut,
  ShopClassSummaryOut,
} from "@/lib/types";

type PaidFilter = "all" | "paid" | "unpaid";
type AssistedFilter = "all" | "assisted";

type CatalogChoice = CatalogProductOut & { category: string; series: string; categoryId: string };

const emptySummary: ShopClassSummaryOut = {
  class_count: 0, order_count: 0, item_count: 0, total_amount: 0,
  paid_amount: 0, unpaid_amount: 0, paid_order_count: 0, unpaid_order_count: 0,
  assisted_order_count: 0, product_rows: [],
};

function money(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function flattenCatalog(catalog: CatalogCategoryOut[]): CatalogChoice[] {
  return catalog.flatMap((cat) =>
    cat.series.flatMap((series) =>
      series.products.map((product) => ({
        ...product, category: cat.name, series: series.name, categoryId: cat.id,
      })),
    ),
  );
}

export default function ClassOrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [summary, setSummary] = useState<ShopClassSummaryOut>(emptySummary);
  const [members, setMembers] = useState<ClassMemberOut[]>([]);
  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [myClassId, setMyClassId] = useState<string | null>(null);
  const [closeStatus, setCloseStatus] = useState<Record<string, CloseStatusItem>>({});
  const [productDetail, setProductDetail] = useState<ProductOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [closeBusy, setCloseBusy] = useState<string | null>(null);
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [assistedFilter, setAssistedFilter] = useState<AssistedFilter>("all");
  const [productFilter, setProductFilter] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 代建 / 修改共用表單
  const [editOrder, setEditOrder] = useState<OrderOut | null>(null);
  const [studentId, setStudentId] = useState("");
  const [orderProductId, setOrderProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [optionIds, setOptionIds] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  // 取消確認
  const [cancelTarget, setCancelTarget] = useState<OrderListItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const catalogProducts = useMemo(() => flattenCatalog(catalog), [catalog]);
  const activeProducts = catalogProducts.filter((p) => p.status === "active");
  const productFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of catalogProducts) byId.set(p.id, p.name);
    for (const row of summary.product_rows) byId.set(row.product_id, row.product_name);
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"));
  }, [catalogProducts, summary.product_rows]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = { limit: "500" };
    if (paidFilter !== "all") params.is_paid = paidFilter === "paid" ? "true" : "false";
    if (assistedFilter === "assisted") params.assisted_only = "true";
    if (productFilter) params.product_id = productFilter;
    if (memberFilter) params.member_user_id = memberFilter;
    try {
      const [orderItems, summaryData] = await Promise.all([
        shopApi.listClassOrders(params),
        shopApi.classSummary({ is_paid: params.is_paid, assisted_only: params.assisted_only, product_id: params.product_id }),
      ]);
      setOrders(orderItems);
      setSummary(summaryData);
      setSelectedIds((cur) => cur.filter((id) => orderItems.some((o) => o.id === id)));
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入失敗"));
    } finally {
      setLoading(false);
    }
  }, [assistedFilter, paidFilter, productFilter, memberFilter]);

  const loadCloseStatus = useCallback(async (catIds: string[], classId: string) => {
    if (!catIds.length) return;
    try {
      const res = await shopApi.getCloseStatus(catIds, classId);
      setCloseStatus(res.statuses);
    } catch {
      setCloseStatus({});
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    shopApi.catalog()
      .then((cats) => { setCatalog(cats); return cats; })
      .catch(() => { setCatalog([]); return []; });
    classApi.myClass()
      .then(async (schoolClass) => {
        if (!schoolClass) return;
        setMyClassId(schoolClass.id);
        const [data, cats] = await Promise.all([
          classApi.members(schoolClass.id),
          shopApi.catalog().catch(() => [] as CatalogCategoryOut[]),
        ]);
        setMembers(data);
        const catIds = cats.map((c: CatalogCategoryOut) => c.id);
        if (catIds.length) await loadCloseStatus(catIds, schoolClass.id);
      })
      .catch(() => setMembers([]));
  }, [loadCloseStatus]);

  useEffect(() => {
    setOptionIds({});
    setProductDetail(null);
    if (!orderProductId) return;
    shopApi.getProduct(orderProductId)
      .then((product) => {
        setProductDetail(product);
        setOptionIds(Object.fromEntries(
          product.variant_groups.map((g) => [g.id, g.options.find((o) => o.is_active)?.id ?? ""]),
        ));
      })
      .catch((e) => toast.error(apiErrorMessage(e, "商品載入失敗")));
  }, [orderProductId]);

  const openCreate = () => {
    setEditOrder(null);
    setStudentId("");
    setOrderProductId("");
    setQuantity(1);
    setOptionIds({});
    setNotes("");
  };

  const openEdit = async (order: OrderListItem) => {
    try {
      const full = await shopApi.getOrder(order.id);
      setEditOrder(full);
      setStudentId(full.user_id);
      const firstItem = full.items?.[0];
      if (firstItem) {
        setOrderProductId(firstItem.product_id);
        setQuantity(firstItem.quantity);
        const opts: Record<string, string> = {};
        for (const opt of firstItem.selected_options ?? []) {
          if (opt.group_id) opts[opt.group_id] = opt.option_id;
        }
        setOptionIds(opts);
        setNotes(full.notes ?? "");
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入訂單失敗"));
    }
  };

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((o) =>
      o.serial_number.toLowerCase().includes(needle)
      || (o.user_name ?? "").toLowerCase().includes(needle)
      || (o.class_label ?? "").toLowerCase().includes(needle),
    );
  }, [orders, query]);

  const selectedSet = new Set(selectedIds);
  const selectedOrders = visibleOrders.filter((o) => selectedSet.has(o.id));
  const allVisibleSelected = visibleOrders.length > 0 && visibleOrders.every((o) => selectedSet.has(o.id));

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

  const batchSetPaid = async (isPaid: boolean) => {
    const targets = selectedOrders.filter((o) => o.is_paid !== isPaid);
    if (!targets.length) { toast.info(isPaid ? "選取訂單都已繳費" : "選取訂單都是未繳費"); return; }
    setBatchBusy(true);
    try {
      await Promise.all(targets.map((o) => shopApi.setOrderPaid(o.id, isPaid)));
      setSelectedIds([]);
      toast.success(isPaid ? `已標示 ${targets.length} 筆為已繳費` : `已取消 ${targets.length} 筆繳費標示`);
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "批量更新失敗"));
    } finally {
      setBatchBusy(false);
    }
  };

  const submitOrder = async () => {
    if (!studentId || !orderProductId) { toast.error("請選擇學生與商品"); return; }
    const optionValues = productDetail?.variant_groups.map((g) => optionIds[g.id]).filter(Boolean) ?? [];
    if ((productDetail?.variant_groups.length ?? 0) !== optionValues.length) { toast.error("請完成所有商品選項"); return; }
    setCreating(true);
    try {
      const body = { user_id: studentId, items: [{ product_id: orderProductId, quantity, option_ids: optionValues }], notes: notes.trim() || null };
      if (editOrder) {
        await shopApi.updateOrder(editOrder.id, body);
        toast.success("訂單已修改");
      } else {
        await shopApi.createClassOrder(body);
        toast.success("已完成班級代訂");
      }
      setEditOrder(null);
      setStudentId(""); setOrderProductId(""); setQuantity(1); setNotes("");
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, editOrder ? "修改失敗" : "代訂失敗"));
    } finally {
      setCreating(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setBusy(cancelTarget.id);
    try {
      await shopApi.cancelOrder(cancelTarget.id, cancelReason.trim() || undefined);
      toast.success("訂單已取消");
      setCancelTarget(null);
      setCancelReason("");
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "取消失敗"));
    } finally {
      setBusy(null);
    }
  };

  const toggleClose = async (categoryId: string, isCurrentlyClosed: boolean) => {
    if (!myClassId) { toast.error("無法取得班級資訊"); return; }
    setCloseBusy(categoryId);
    try {
      if (isCurrentlyClosed) {
        await shopApi.reopenCategory(categoryId, myClassId);
        toast.success("已重新開單");
      } else {
        await shopApi.closeCategory(categoryId, { class_id: myClassId });
        toast.success("已結單，學生無法新增訂單");
      }
      await loadCloseStatus(catalog.map((c) => c.id), myClassId);
    } catch (e) {
      toast.error(apiErrorMessage(e, isCurrentlyClosed ? "重新開單失敗" : "結單失敗"));
    } finally {
      setCloseBusy(null);
    }
  };

  const isFormOpen = studentId !== "" || editOrder !== null;

  return (
    <main className="shop-class-orders-page mx-auto min-w-0 w-full max-w-7xl space-y-5 px-4 py-5">
      <header className="flex min-w-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>校慶商品</p>
          <h1 className="break-words text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>班級商品工作台</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} className="btn btn-ghost" aria-label="重新整理">
            <RefreshCw size={15} /> 重新整理
          </button>
          <Link href="/shop" className="btn btn-ghost">商品訂購</Link>
        </div>
      </header>

      {/* 結單面板 */}
      {catalog.length > 0 && (
        <section className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          <h2 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>結單管理</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {catalog.map((cat) => {
              const status = closeStatus[cat.id];
              const isClosed = status?.is_closed ?? false;
              const isBusy = closeBusy === cat.id;
              return (
                <div key={cat.id} className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
                  style={{ border: `1px solid ${isClosed ? "rgba(239,68,68,0.3)" : "var(--border)"}`, background: isClosed ? "rgba(239,68,68,0.06)" : "transparent" }}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{cat.name}</p>
                    {isClosed && status?.closed_at && (
                      <p className="text-xs" style={{ color: "#ef4444" }}>
                        已結單 {new Date(status.closed_at).toLocaleDateString("zh-TW")} {status.closed_by_name ? `by ${status.closed_by_name}` : ""}
                      </p>
                    )}
                    {!isClosed && <p className="text-xs" style={{ color: "var(--text-muted)" }}>開放中</p>}
                  </div>
                  <button type="button" onClick={() => toggleClose(cat.id, isClosed)} disabled={isBusy || !myClassId}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                    style={{ border: "1px solid var(--border)", color: isClosed ? "#16a34a" : "#ef4444" }}>
                    {isBusy ? "..." : isClosed ? <><LockOpen size={12} /> 重新開單</> : <><Lock size={12} /> 結單</>}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 統計卡片 */}
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
        {/* 訂單列表 */}
        <section className="min-w-0 space-y-4">
          <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_160px]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={15} style={{ color: "var(--text-muted)" }} />
                <input className="input w-full pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋訂單編號、姓名" />
              </label>
              <select className="input" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)}>
                <option value="">全班學生</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name}{m.student_id ? `（${m.student_id}）` : ""}</option>
                ))}
              </select>
              <select className="input" value={paidFilter} onChange={(e) => setPaidFilter(e.target.value as PaidFilter)}>
                <option value="all">全部繳費</option>
                <option value="unpaid">未繳費</option>
                <option value="paid">已繳費</option>
              </select>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <select className="input" value={assistedFilter} onChange={(e) => setAssistedFilter(e.target.value as AssistedFilter)}>
                <option value="all">全班訂單</option>
                <option value="assisted">只看代訂</option>
              </select>
              <select className="input" value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
                <option value="">全部商品</option>
                {productFilterOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setSelectedIds(allVisibleSelected ? [] : visibleOrders.map((o) => o.id))}
                  disabled={!visibleOrders.length}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  {allVisibleSelected ? "取消選取" : "全選列表"}
                </button>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>已選 {selectedIds.length} 筆</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!selectedIds.length || batchBusy} onClick={() => batchSetPaid(true)}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                  style={{ border: "1px solid var(--border)", color: "#16a34a" }}>批量已繳</button>
                <button type="button" disabled={!selectedIds.length || batchBusy} onClick={() => batchSetPaid(false)}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>批量未繳</button>
              </div>
            </div>

            {loading ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : !visibleOrders.length ? (
              <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
                <p className="text-sm">目前沒有符合條件的班級訂單</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm" role="table">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["", "訂單編號", "訂購人", "班級", "來源", "狀態", "金額", "繳費", "操作"].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left text-xs font-semibold"
                          style={{ color: "var(--text-muted)" }} scope="col">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.map((order, idx) => (
                      <tr key={order.id} style={idx < visibleOrders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => setSelectedIds((cur) => cur.includes(order.id) ? cur.filter((id) => id !== order.id) : [...cur, order.id])}
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
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => togglePaid(order)} disabled={busy === order.id}
                              className="rounded-md px-2 py-1 text-xs disabled:opacity-50"
                              style={{ border: "1px solid var(--border)" }}>
                              {order.is_paid ? "未繳" : "已繳"}
                            </button>
                            {order.status !== "cancelled" && order.status !== "refunded" && (
                              <>
                                <button type="button" onClick={() => openEdit(order)} title="修改訂單"
                                  className="rounded-md p-1 hover:opacity-70" style={{ color: "var(--primary)" }}>
                                  <Edit2 size={14} />
                                </button>
                                <button type="button" onClick={() => { setCancelTarget(order); setCancelReason(""); }} title="取消訂單"
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
            )}
          </div>
        </section>

        {/* 側欄 */}
        <aside className="space-y-4">
          {/* 商品彙總 */}
          <section className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>商品彙總</h2>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{summary.product_rows.length} 項</span>
            </div>
            <div className="space-y-2">
              {!summary.product_rows.length ? (
                <p className="py-5 text-center text-sm" style={{ color: "var(--text-muted)" }}>尚無商品資料</p>
              ) : summary.product_rows.slice(0, 8).map((row) => (
                <button key={row.product_id} type="button" onClick={() => setProductFilter(row.product_id === productFilter ? "" : row.product_id)}
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

          {/* 代建 / 修改表單 */}
          <section className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {editOrder ? <Edit2 size={15} /> : <Plus size={15} />}
                {editOrder ? `修改訂單 ${editOrder.serial_number}` : "班級代訂"}
              </h2>
              {editOrder && (
                <button type="button" onClick={() => { setEditOrder(null); setStudentId(""); setOrderProductId(""); }}
                  className="text-xs" style={{ color: "var(--text-muted)" }}>
                  <X size={15} />
                </button>
              )}
            </div>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>學生</span>
                <select className="input" value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={!!editOrder}>
                  <option value="">選擇本班學生</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.display_name}{m.student_id ? `（${m.student_id}）` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>商品</span>
                <select className="input" value={orderProductId} onChange={(e) => setOrderProductId(e.target.value)}>
                  <option value="">選擇商品</option>
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.category} / {p.series} / {p.name}</option>
                  ))}
                </select>
              </label>
              {productDetail?.variant_groups.map((group) => (
                <label key={group.id} className="grid gap-1 text-sm">
                  <span style={{ color: "var(--text-muted)" }}>{group.name}</span>
                  <select className="input" value={optionIds[group.id] ?? ""}
                    onChange={(e) => setOptionIds((cur) => ({ ...cur, [group.id]: e.target.value }))}>
                    <option value="">選擇{group.name}</option>
                    {group.options.filter((o) => o.is_active).map((o) => (
                      <option key={o.id} value={o.id}>{o.value}{o.price_delta ? ` (+${o.price_delta})` : ""}</option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>數量</span>
                <input className="input" type="number" min={1} max={100} value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
              </label>
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>備註</span>
                <input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="尺寸確認、收款備註等" />
              </label>
              <button type="button" onClick={submitOrder} disabled={creating || members.length === 0}
                className="btn w-full disabled:opacity-50"
                style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                {creating ? "處理中..." : editOrder ? "儲存修改" : "建立代訂訂單"}
              </button>
              {!editOrder && !isFormOpen && (
                <button type="button" onClick={openCreate}
                  className="btn btn-ghost w-full text-xs" style={{ color: "var(--text-muted)" }}>
                  清空表單
                </button>
              )}
            </div>
          </section>
        </aside>
      </div>

      {/* 取消訂單 Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl p-6 shadow-xl" style={{ background: "var(--card-bg)" }}>
            <div className="mb-4 flex items-start gap-3">
              <AlertTriangle size={20} style={{ color: "#ef4444", marginTop: 2, flexShrink: 0 }} />
              <div>
                <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>確認取消訂單</h3>
                <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                  訂單 <span className="font-mono font-medium">{cancelTarget.serial_number}</span>（{cancelTarget.user_name}）
                  取消後將退回庫存，無法復原。
                </p>
              </div>
            </div>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block" style={{ color: "var(--text-muted)" }}>取消原因（選填）</span>
              <input className="input w-full" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="填寫取消原因" />
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setCancelTarget(null)} className="btn btn-ghost">取消</button>
              <button type="button" onClick={confirmCancel} disabled={busy === cancelTarget.id}
                className="btn disabled:opacity-50"
                style={{ background: "#ef4444", color: "white", border: "none" }}>
                {busy === cancelTarget.id ? "取消中..." : "確認取消訂單"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
