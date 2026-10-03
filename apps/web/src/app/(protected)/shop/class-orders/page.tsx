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

function scrollToSection(id: string) {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
}

function flattenCatalog(catalog: CatalogCategoryOut[]): CatalogChoice[] {
  return catalog.flatMap((cat) => [
    ...cat.products.map((product) => ({
      ...product, category: cat.name, series: "單一商品", categoryId: cat.id,
    })),
    ...cat.series.flatMap((series) =>
      series.products.map((product) => ({
        ...product, category: cat.name, series: series.name, categoryId: cat.id,
      })),
    ),
  ]);
}

export default function ClassOrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [summary, setSummary] = useState<ShopClassSummaryOut>(emptySummary);
  const [productSummary, setProductSummary] = useState<ShopClassSummaryOut>(emptySummary);
  const [members, setMembers] = useState<ClassMemberOut[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersLoadFailed, setMembersLoadFailed] = useState(false);
  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [myClassId, setMyClassId] = useState<string | null>(null);
  const [closeStatus, setCloseStatus] = useState<Record<string, CloseStatusItem>>({});
  const [productDetail, setProductDetail] = useState<ProductOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
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
  const [formOpen, setFormOpen] = useState(false);

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
  const activeProducts = useMemo(
    () => catalogProducts.filter((p) => p.status === "active"),
    [catalogProducts],
  );
  const productRows = useMemo(() => {
    const rows = new Map(productSummary.product_rows.map((row) => [row.product_id, row]));
    for (const product of activeProducts) {
      if (rows.has(product.id)) continue;
      rows.set(product.id, {
        product_id: product.id,
        product_name: product.name,
        quantity: 0,
        total_amount: 0,
        collected_order_count: 0,
        uncollected_order_count: 0,
        collected_quantity: 0,
        uncollected_quantity: 0,
        collected_amount: 0,
        uncollected_amount: 0,
      });
    }
    return [...rows.values()].sort((a, b) => a.product_name.localeCompare(b.product_name, "zh-Hant"));
  }, [activeProducts, productSummary.product_rows]);
  const productFilterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of catalogProducts) byId.set(p.id, p.name);
    for (const row of productRows) byId.set(row.product_id, row.product_name);
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1], "zh-Hant"));
  }, [catalogProducts, productRows]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const params: Record<string, string> = { limit: "500" };
    if (paidFilter !== "all") params.is_class_collected = paidFilter === "paid" ? "true" : "false";
    if (assistedFilter === "assisted") params.assisted_only = "true";
    if (productFilter) params.product_id = productFilter;
    if (memberFilter) params.member_user_id = memberFilter;
    const needsUnfilteredProductStatus =
      paidFilter !== "all" || assistedFilter !== "all" || productFilter !== "";
    try {
      const [orderItems, summaryData, productStatus] = await Promise.all([
        shopApi.listClassOrders(params),
        shopApi.classSummary({ is_class_collected: params.is_class_collected, assisted_only: params.assisted_only, product_id: params.product_id }),
        needsUnfilteredProductStatus ? shopApi.classSummary() : Promise.resolve(null),
      ]);
      setOrders(orderItems);
      setSummary(summaryData);
      setProductSummary(productStatus ?? summaryData);
      setSelectedIds((cur) => cur.filter((id) => orderItems.some((o) => o.id === id)));
    } catch (e) {
      setLoadFailed(true);
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
    if (!formOpen) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToSection("class-order-form");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [formOpen]);

  useEffect(() => {
    setMembersLoading(true);
    setMembersLoadFailed(false);
    shopApi.catalog()
      .then((cats) => { setCatalog(cats); return cats; })
      .catch(() => { setCatalog([]); return []; });
    classApi.myClass()
      .then(async (schoolClass) => {
        if (!schoolClass) {
          setMyClassId(null);
          setMembers([]);
          return;
        }
        setMyClassId(schoolClass.id);
        const [data, cats] = await Promise.all([
          classApi.members(schoolClass.id),
          shopApi.catalog().catch(() => [] as CatalogCategoryOut[]),
        ]);
        setMembers(data);
        const catIds = cats.map((c: CatalogCategoryOut) => c.id);
        if (catIds.length) await loadCloseStatus(catIds, schoolClass.id);
      })
      .catch(() => {
        setMembers([]);
        setMembersLoadFailed(true);
      })
      .finally(() => setMembersLoading(false));
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
    setFormOpen(true);
    setEditOrder(null);
    setStudentId("");
    setOrderProductId("");
    setQuantity(1);
    setOptionIds({});
    setNotes("");
  };

  const openEdit = async (order: OrderListItem) => {
    setFormOpen(true);
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
      await shopApi.setClassCollected(order.id, !order.is_class_collected);
      toast.success(order.is_class_collected ? "已取消個人收款紀錄" : "已記錄向這位同學收款");
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
    } finally {
      setBusy(null);
    }
  };

  const batchSetPaid = async (isPaid: boolean) => {
    const targets = selectedOrders.filter((o) => o.is_class_collected !== isPaid);
    if (!targets.length) { toast.info(isPaid ? "選取訂單都已繳費" : "選取訂單都是未繳費"); return; }
    setBatchBusy(true);
    try {
      await Promise.all(targets.map((o) => shopApi.setClassCollected(o.id, isPaid)));
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
      setFormOpen(false);
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

  const showProductCollection = (productId: string, hasUncollectedOrders: boolean) => {
    setProductFilter(productId);
    setPaidFilter(hasUncollectedOrders ? "unpaid" : "all");
    setAssistedFilter("all");
    setMemberFilter("");
    setQuery("");
    scrollToSection("class-orders-list");
  };

  return (
    <main className="shop-class-orders-page mx-auto min-w-0 w-full max-w-7xl space-y-5 px-4 py-5">
      <header className="flex min-w-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>班級商品收款</h1>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
            查看每項商品的登記與收款進度，協助同學下單並記錄已收款項。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openCreate} className="btn min-h-11" style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            <Plus size={15} /> 幫同學下單
          </button>
          <button type="button" onClick={load} className="btn btn-ghost min-h-11" aria-label="重新整理">
            <RefreshCw size={15} /> 重新整理
          </button>
          <Link href="/shop" className="btn btn-ghost min-h-11">商品訂購</Link>
        </div>
      </header>

      {loadFailed && productSummary.product_rows.length > 0 && (
        <p className="rounded-md px-3 py-2 text-sm" role="alert"
          style={{ border: "1px solid var(--danger-border)", background: "var(--danger-dim)", color: "var(--danger)" }}>
          載入失敗，目前顯示上次載入的資料。請重新整理後再操作。
        </p>
      )}

      {formOpen && (
        <section id="class-order-form" className="scroll-mt-5 rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {editOrder ? <Edit2 size={15} /> : <Plus size={15} />}
              {editOrder ? `修改訂單 ${editOrder.serial_number}` : "幫同學下單"}
            </h2>
            <button type="button" onClick={() => { setFormOpen(false); setEditOrder(null); setStudentId(""); setOrderProductId(""); }}
              className="min-h-11 min-w-11" style={{ color: "var(--text-muted)" }} aria-label="關閉下單表單">
              <X size={15} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>同班學生</span>
              <select className="input min-h-11" value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={!!editOrder}>
                <option value="">選擇同班學生</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name}{m.student_id ? `（${m.student_id}）` : ""}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>商品</span>
              <select className="input min-h-11" value={orderProductId} onChange={(e) => setOrderProductId(e.target.value)}>
                <option value="">選擇商品</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.category} / {p.series} / {p.name}</option>
                ))}
              </select>
            </label>
            {productDetail?.variant_groups.map((group) => (
              <label key={group.id} className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>{group.name}</span>
                <select className="input min-h-11" value={optionIds[group.id] ?? ""}
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
              <input className="input min-h-11" type="number" min={1} max={100} value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
            </label>
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>備註</span>
              <input className="input min-h-11" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="尺寸確認等" />
            </label>
            <div className="flex items-end">
              <button type="button" onClick={submitOrder}
                disabled={creating || membersLoading || membersLoadFailed || members.length === 0 || activeProducts.length === 0}
                className="btn min-h-11 w-full disabled:opacity-50"
                style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                {creating ? "處理中..." : editOrder ? "儲存修改" : "建立代訂"}
              </button>
            </div>
          </div>
          {membersLoading && (
            <p className="mt-3 text-sm" role="status" style={{ color: "var(--text-muted)" }}>正在載入本班名冊...</p>
          )}
          {!membersLoading && membersLoadFailed && (
            <p className="mt-3 text-sm" role="alert" style={{ color: "var(--danger)" }}>無法載入本班名冊，請重新整理頁面；若問題持續，請洽系統管理員。</p>
          )}
          {!membersLoading && !membersLoadFailed && !myClassId && (
            <p className="mt-3 text-sm" role="alert" style={{ color: "var(--danger)" }}>找不到你任職的班級，暫時無法建立代訂。</p>
          )}
          {!membersLoading && !membersLoadFailed && myClassId && members.length === 0 && (
            <p className="mt-3 text-sm" role="status" style={{ color: "var(--text-muted)" }}>本班名冊目前沒有可選的學生。</p>
          )}
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "待收款", value: `${summary.unpaid_order_count} 筆`, detail: money(summary.unpaid_amount), tone: "var(--warning)" },
          { label: "已收款", value: `${summary.paid_order_count} 筆`, detail: money(summary.paid_amount), tone: "var(--success)" },
          { label: "應收總額", value: money(summary.total_amount), detail: `${summary.order_count} 筆有效訂單`, tone: "var(--text-primary)" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg px-4 py-3"
            style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
            <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{item.label}</p>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <p className="text-lg font-semibold tabular-nums" style={{ color: item.tone }}>{item.value}</p>
              <p className="text-sm tabular-nums" style={{ color: "var(--text-secondary)" }}>{item.detail}</p>
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="product-collection-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="product-collection-heading" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>商品收款進度</h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>收款紀錄代表班代已向同學收款；整班繳款由班聯會確認。</p>
        </div>
        {loading && productSummary.product_rows.length === 0 ? (
          <p className="rounded-lg px-4 py-8 text-center text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            正在載入商品收款狀況...
          </p>
        ) : loadFailed && productSummary.product_rows.length === 0 ? (
          <p className="rounded-lg px-4 py-8 text-center text-sm" role="alert"
            style={{ border: "1px solid var(--danger-border)", background: "var(--danger-dim)", color: "var(--danger)" }}>
            無法載入商品收款狀況，請重新整理後再試。
          </p>
        ) : productRows.length === 0 ? (
          <div className="rounded-lg px-4 py-8 text-center" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>目前沒有可追蹤的商品</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>商品開放或有新登記後，收款進度會顯示在這裡。</p>
            {activeProducts.length > 0 && (
              <button type="button" onClick={openCreate} className="btn btn-ghost mt-3 min-h-11">替同學下單</button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {productRows.map((row) => {
              const orderCount = row.collected_order_count + row.uncollected_order_count;
              const progress = orderCount ? (row.collected_order_count / orderCount) * 100 : 0;
              return (
                <article key={row.product_id} className="min-w-0 rounded-lg p-4"
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 break-words text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{row.product_name}</h3>
                    <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{row.quantity} 件</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                    <span style={{ color: "var(--success)" }}>已收 {row.collected_order_count} 筆 · {money(row.collected_amount)}</span>
                    <span style={{ color: "var(--warning)" }}>待收 {row.uncollected_order_count} 筆</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full" role="progressbar"
                    aria-label={`${row.product_name}收款進度`}
                    aria-valuemin={0}
                    aria-valuemax={orderCount || 1}
                    aria-valuenow={row.collected_order_count}
                    style={{ background: "var(--warning-dim)" }}>
                    <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "var(--success)" }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                    <span style={{ color: "var(--text-muted)" }}>共 {orderCount} 筆訂單 · {money(row.total_amount)}</span>
                    <span className="tabular-nums" style={{ color: "var(--warning)" }}>待收 {money(row.uncollected_amount)}</span>
                  </div>
                  <button type="button" onClick={() => showProductCollection(row.product_id, row.uncollected_order_count > 0)}
                    className="mt-3 min-h-11 w-full rounded-md px-3 text-left text-sm font-medium transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
                    style={{ border: "1px solid var(--border)", color: row.uncollected_order_count ? "var(--primary-text)" : "var(--text-secondary)" }}>
                    {row.uncollected_order_count
                      ? `查看 ${row.uncollected_order_count} 筆待收訂單`
                      : "查看全部訂單"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="space-y-5">
        {/* 訂單列表 */}
        <section id="class-orders-list" className="min-w-0 scroll-mt-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>班級訂單</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>確認收款只記錄班代收到同學款項，不會變更班聯會的整班繳款狀態。</p>
            </div>
            <span className="text-sm tabular-nums" style={{ color: "var(--text-muted)" }}>{visibleOrders.length} 筆</span>
          </div>
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
                <option value="all">全部收款紀錄</option>
                <option value="unpaid">待收款</option>
                <option value="paid">已收款</option>
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
                  style={{ border: "1px solid var(--border)", color: "#16a34a" }}>確認已收款</button>
                <button type="button" disabled={!selectedIds.length || batchBusy} onClick={() => batchSetPaid(false)}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>撤銷收款</button>
              </div>
            </div>

            {loading ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : !visibleOrders.length ? (
              <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
                <p className="text-sm">目前沒有符合條件的班級訂單</p>
                <button type="button" onClick={openCreate} className="btn btn-ghost mt-3 text-xs">替同學建立第一筆訂單</button>
              </div>
            ) : (
              <>
              <div className="space-y-2 p-3 md:hidden">
                {visibleOrders.map((order) => (
                  <article key={order.id} className="rounded-md p-3" style={{ border: "1px solid var(--border)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/shop/orders/${order.id}`} className="block truncate text-xs font-mono font-medium hover:underline" style={{ color: "var(--primary)" }}>
                          {order.serial_number}
                        </Link>
                        <p className="mt-1 truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{order.user_name ?? "未具名訂購人"}</p>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                          {order.assistance_scope === "class_assisted" ? "幹部代訂" : "自行訂購"} · {order.class_label ?? "未歸班"}
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
                      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{money(order.total_price)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => togglePaid(order)} disabled={busy === order.id}
                        className="min-h-11 rounded-md px-3 text-xs font-medium disabled:opacity-50"
                        style={{ border: "1px solid var(--border)", color: order.is_class_collected ? "var(--text-secondary)" : "#16a34a" }}>
                        {order.is_class_collected ? "撤銷收款" : "確認收款"}
                      </button>
                      <button type="button" onClick={() => setSelectedIds((current) => current.includes(order.id) ? current.filter((id) => id !== order.id) : [...current, order.id])}
                        className="min-h-11 rounded-md px-3 text-xs" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                        {selectedSet.has(order.id) ? "取消選取" : "選取"}
                      </button>
                      {order.status !== "cancelled" && order.status !== "refunded" && (
                        <>
                          <button type="button" onClick={() => openEdit(order)} className="min-h-11 rounded-md px-3 text-xs"
                            style={{ border: "1px solid var(--border)", color: "var(--primary)" }}>修改</button>
                          <button type="button" onClick={() => { setCancelTarget(order); setCancelReason(""); }} className="min-h-11 rounded-md px-3 text-xs"
                            style={{ border: "1px solid var(--border)", color: "#ef4444" }}>取消</button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[820px] text-sm" role="table">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["", "訂單編號", "訂購人", "班級", "來源", "狀態", "金額", "個人收款", "操作"].map((h, i) => (
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
                            style={order.is_class_collected
                              ? { background: "rgba(34,197,94,0.12)", color: "#16a34a" }
                              : { background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                            {order.is_class_collected ? "已收款" : "待收款"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => togglePaid(order)} disabled={busy === order.id}
                              className="rounded-md px-2 py-1 text-xs disabled:opacity-50"
                              style={{ border: "1px solid var(--border)" }}>
                              {order.is_class_collected ? "撤銷" : "確認收款"}
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
              </>
            )}
          </div>
        </section>

      </div>

      {catalog.length > 0 && (
        <section aria-labelledby="close-management-heading" className="rounded-lg p-4"
          style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
          <h2 id="close-management-heading" className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>商品結單管理</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {catalog.map((cat) => {
              const status = closeStatus[cat.id];
              const isClosed = status?.is_closed ?? false;
              const isBusy = closeBusy === cat.id;
              return (
                <div key={cat.id} className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
                  style={{ border: `1px solid ${isClosed ? "var(--danger-border)" : "var(--border)"}`, background: isClosed ? "var(--danger-dim)" : "transparent" }}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{cat.name}</p>
                    {isClosed && status?.closed_at && (
                      <p className="text-xs" style={{ color: "var(--danger)" }}>
                        已結單 {new Date(status.closed_at).toLocaleDateString("zh-TW")} {status.closed_by_name ? `· ${status.closed_by_name}` : ""}
                      </p>
                    )}
                    {!isClosed && <p className="text-xs" style={{ color: "var(--text-muted)" }}>開放中</p>}
                  </div>
                  <button type="button" onClick={() => toggleClose(cat.id, isClosed)} disabled={isBusy || !myClassId}
                    className="flex min-h-11 shrink-0 items-center gap-1 rounded-md px-3 text-xs font-medium disabled:opacity-50"
                    style={{ border: "1px solid var(--border)", color: isClosed ? "var(--success)" : "var(--danger)" }}>
                    {isBusy ? "處理中" : isClosed ? <><LockOpen size={12} /> 重新開單</> : <><Lock size={12} /> 結單</>}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
