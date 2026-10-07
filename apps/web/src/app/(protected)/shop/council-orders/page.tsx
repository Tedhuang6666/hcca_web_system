"use client";

import Link from "next/link";
import ProductQuantitySummary from "@/components/shop/ProductQuantitySummary";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart2, Lock, LockOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import type {
  CatalogCategoryOut,
  CloseStatusItem,
  OrderListItem,
  OrderQuantityRow,
  OrderSummaryOut,
  OrderSummaryRow,
  SchoolClassListItem,
} from "@/lib/types";

type Tab = "summary" | "quantities" | "orders";

function money(v: number) {
  return `NT$${v.toLocaleString("zh-TW")}`;
}

// ── 結單狀態徽章 ─────────────────────────────────────────────────────────────

function CloseBadge({ status, partial = false }: { status: CloseStatusItem | undefined; partial?: boolean }) {
  if (partial) return (
    <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(245,158,11,0.12)", color: "#b45309" }}>
      部分結單
    </span>
  );
  if (!status?.is_closed) return (
    <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}>
      開放中
    </span>
  );
  return (
    <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
      已結單
    </span>
  );
}

// ── 主頁面 ───────────────────────────────────────────────────────────────────

export default function CouncilOrdersPage() {
  const { isAdmin, permissions } = usePermissions();
  const hasAdminPermission = isAdmin || permissions.has("admin:all");
  const canConfirmClassPayment = hasAdminPermission
    || permissions.has("shop:manage")
    || permissions.has("shop:manage_orders");
  const canManageOrderClosures = canConfirmClassPayment || permissions.has("shop:view_all");
  const [tab, setTab] = useState<Tab>("summary");
  const [groupBy, setGroupBy] = useState<"class" | "grade" | "user">("class");

  // 篩選
  const [grade, setGrade] = useState("");
  const [classId, setClassId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [activityId, setActivityId] = useState("all");
  const [productId, setProductId] = useState("");
  const [isPaid, setIsPaid] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  // 資料
  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [summary, setSummary] = useState<OrderSummaryOut | null>(null);
  const [quantities, setQuantities] = useState<OrderQuantityRow[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [closeStatus, setCloseStatus] = useState<Record<string, Record<string, CloseStatusItem>>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [closeBusy, setCloseBusy] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState<string | null>(null);

  // 班聯結單選擇
  const [closeTarget, setCloseTarget] = useState<{
    categoryIds: string[];
    classId: string;
    label: string;
    busyKey: string;
  } | null>(null);

  useEffect(() => {
    shopApi.catalog().then(setCatalog).catch(() => {});
    classApi.recipientOptions().then(setClasses).catch(() => {});
  }, []);

  const dateParams = useMemo(() => ({
    date_from: dateFrom ? new Date(`${dateFrom}T00:00:00+08:00`).toISOString() : undefined,
    date_to: dateTo ? new Date(`${dateTo}T23:59:59+08:00`).toISOString() : undefined,
  }), [dateFrom, dateTo]);

  const activityGroups = useMemo(() => {
    type ActivityGroup = {
      key: string;
      activityId: string | null;
      label: string;
      categories: CatalogCategoryOut[];
    };
    const groups = new Map<string, ActivityGroup>();
    for (const category of catalog) {
      const key = category.activity_id ?? "__general__";
      const group = groups.get(key) ?? {
        key,
        activityId: category.activity_id ?? null,
        label: category.activity_id ? "" : "一般商品",
        categories: [],
      };
      group.categories.push(category);
      group.label = category.activity_id
        ? [...new Set([...group.label.split("、").filter(Boolean), category.activity_name ?? category.name])].join("、")
        : group.label;
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [catalog]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const params: Parameters<typeof shopApi.orderSummary>[0] = { group_by: groupBy, ...dateParams };
      if (activityId !== "all" && activityId !== "__general__") params.activity_id = activityId;
      if (grade) params.grade = grade;
      if (classId) params.class_id = classId;
      if (isPaid) params.is_paid = isPaid;
      if (productId) params.product_id = productId;
      if (categoryId) params.category_id = categoryId;
      if (statusFilter) params.status = statusFilter;
      const data = await shopApi.orderSummary(params);
      setSummary(data);

      // 批次查詢每個 row 的結單狀態
      if (groupBy === "class" && data.rows.length && catalog.length) {
        const catIds = catalog.map((c) => c.id);
        const statusMap: Record<string, Record<string, CloseStatusItem>> = {};
        await Promise.all(
          data.rows.map(async (row) => {
            try {
              const res = await shopApi.getCloseStatus(catIds, row.key);
              statusMap[row.key] = res.statuses;
            } catch {
              statusMap[row.key] = {};
            }
          }),
        );
        setCloseStatus(statusMap);
      }
    } catch (e) {
      setLoadError(apiErrorMessage(e, "載入失敗，請重新整理後再試。"));
    } finally {
      setLoading(false);
    }
  }, [groupBy, grade, classId, activityId, isPaid, productId, categoryId, statusFilter, catalog, dateParams]);

  const loadQuantities = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const params: Parameters<typeof shopApi.orderQuantities>[0] = { ...dateParams };
      if (activityId !== "all" && activityId !== "__general__") params!.activity_id = activityId;
      if (grade) params!.grade = grade;
      if (classId) params!.class_id = classId;
      if (categoryId) params!.category_id = categoryId;
      if (productId) params!.product_id = productId;
      if (isPaid) params!.is_paid = isPaid;
      if (statusFilter) params!.status = statusFilter;
      const data = await shopApi.orderQuantities(params);
      setQuantities(data);
    } catch (e) {
      setLoadError(apiErrorMessage(e, "載入失敗，請重新整理後再試。"));
    } finally {
      setLoading(false);
    }
  }, [activityId, grade, classId, categoryId, productId, isPaid, statusFilter, dateParams]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const params: Record<string, string> = { my_only: "false", limit: "500" };
      if (activityId !== "all" && activityId !== "__general__") params.activity_id = activityId;
      if (grade) params.grade = grade;
      if (classId) params.class_id = classId;
      if (isPaid) params.is_paid = isPaid;
      if (productId) params.product_id = productId;
      if (categoryId) params.category_id = categoryId;
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      if (dateParams.date_from) params.date_from = dateParams.date_from;
      if (dateParams.date_to) params.date_to = dateParams.date_to;
      const data: OrderListItem[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await shopApi.listOrders({ ...params, offset: String(offset) });
        data.push(...page);
        if (page.length < 500) break;
      }
      setOrders(data);
    } catch (e) {
      setLoadError(apiErrorMessage(e, "載入失敗，請重新整理後再試。"));
    } finally {
      setLoading(false);
    }
  }, [activityId, grade, classId, isPaid, productId, categoryId, statusFilter, search, dateParams]);

  const updateClassPayment = async (
    row: OrderSummaryRow,
    activity: { activityId: string | null; label: string },
    paid: boolean,
  ) => {
    if (row.key === "none") return;
    const action = paid ? "確認已繳費" : "撤銷繳費確認";
    if (!window.confirm(`要為「${row.label}」的「${activity.label}」${action}嗎？只會更新這個活動的訂單。`)) return;
    const busyKey = `${row.key}:${activity.activityId ?? "__general__"}`;
    setPaymentBusy(busyKey);
    try {
      const result = await shopApi.setClassPaid(row.key, paid, activity.activityId);
      toast.success(`已更新「${activity.label}」${result.updated_orders} 筆訂單`);
      await loadSummary();
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新整班繳費狀態失敗"));
    } finally {
      setPaymentBusy(null);
    }
  };

  useEffect(() => {
    if (tab === "summary") loadSummary();
    else if (tab === "quantities") loadQuantities();
    else loadOrders();
  }, [tab, loadSummary, loadQuantities, loadOrders]);

  const handleToggleClose = async (
    group: { key: string; activityId: string | null; label: string; categories: CatalogCategoryOut[] },
    targetClassId: string,
    isCurrentlyClosed: boolean,
    label: string,
  ) => {
    if (!isCurrentlyClosed) {
      setCloseTarget({
        categoryIds: group.categories
          .filter((category) => !closeStatus[targetClassId]?.[category.id]?.is_closed)
          .map((category) => category.id),
        classId: targetClassId,
        label: `${label} · ${group.label}`,
        busyKey: `${group.key}:${targetClassId}`,
      });
      return;
    }
    await doReopen(group, targetClassId);
  };

  const doClose = async () => {
    if (!closeTarget) return;
    setCloseBusy(closeTarget.busyKey);
    try {
      for (const categoryId of closeTarget.categoryIds) {
        await shopApi.closeCategory(categoryId, { class_id: closeTarget.classId });
      }
      toast.success(`已為「${closeTarget.label}」結單`);
      setCloseTarget(null);
      await loadSummary();
    } catch (e) {
      toast.error(apiErrorMessage(e, "結單失敗"));
    } finally {
      setCloseBusy(null);
    }
  };

  const doReopen = async (
    group: { key: string; label: string; categories: CatalogCategoryOut[] },
    targetClassId: string,
  ) => {
    setCloseBusy(`${group.key}:${targetClassId}`);
    try {
      for (const category of group.categories) {
        if (closeStatus[targetClassId]?.[category.id]?.is_closed) {
          await shopApi.reopenCategory(category.id, targetClassId);
        }
      }
      toast.success(`已重新開放「${group.label}」`);
      await loadSummary();
    } catch (e) {
      toast.error(apiErrorMessage(e, "重新開單失敗"));
    } finally {
      setCloseBusy(null);
    }
  };

  const batchClose = async (
    rows: OrderSummaryRow[],
    group: { key: string; label: string; categories: CatalogCategoryOut[] },
    open: boolean,
  ) => {
    if (!group.categories.length) return;
    setLoading(true);
    let count = 0;
    for (const row of rows) {
      if (row.key === "none") continue;
      for (const category of group.categories) {
        const isClosed = closeStatus[row.key]?.[category.id]?.is_closed ?? false;
        if (open && isClosed) {
          try { await shopApi.reopenCategory(category.id, row.key); count++; } catch { /* skip */ }
        } else if (!open && !isClosed) {
          try { await shopApi.closeCategory(category.id, { class_id: row.key }); count++; } catch { /* skip */ }
        }
      }
    }
    toast.success(open
      ? `已重新開放「${group.label}」${count} 個分類結單`
      : `已結單「${group.label}」${count} 個分類`);
    await loadSummary();
    setLoading(false);
  };

  const allProducts = useMemo(() =>
    catalog.flatMap((c) => [
      ...c.products.map((p) => ({ ...p, catId: c.id })),
      ...c.series.flatMap((s) => s.products.map((p) => ({ ...p, catId: c.id }))),
    ]),
    [catalog],
  );

  const gradeOptions = useMemo(() => {
    return [1, 2, 3, 4, 5, 6].map((g) => ({ value: String(g), label: `${g} 年級` }));
  }, []);

  return (
    <main className="shop-council-page mx-auto max-w-7xl space-y-5 px-4 py-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            <BarChart2 size={22} /> 班聯商品統籌
          </h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--text-muted)" }}>
            統籌全校各班訂購、收款進度、商品數量、結單與訂單明細。
          </p>
        </div>
        <button type="button" onClick={() => { if (tab === "summary") loadSummary(); else if (tab === "quantities") loadQuantities(); else loadOrders(); }}
          className="btn btn-ghost" aria-label="重新整理">
          <RefreshCw size={15} /> 重新整理
        </button>
      </header>

      <nav className="shop-task-switch" aria-label="班聯統籌工作">
        {([["summary", "班級繳款"], ["quantities", "商品總量"], ["orders", "查找訂單"]] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      {/* 篩選列 */}
      <details className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <summary className="min-h-11 cursor-pointer font-medium">篩選活動、班級與收款狀態{[grade, classId, categoryId, productId, isPaid, statusFilter, dateFrom, dateTo, search].filter(Boolean).length > 0 || activityId !== "all" ? "（已套用篩選）" : "（目前全部）"}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tab === "summary" && <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>統計方式</span>
            <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value as "class" | "grade" | "user")}>
              <option value="class">依班級</option>
              <option value="grade">依年級</option>
              <option value="user">依學生</option>
            </select>
          </label>}
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>活動</span>
            <select className="input" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              <option value="all">全部活動</option>
              {activityGroups.filter((group) => group.activityId).map((group) => (
                <option key={group.key} value={group.activityId ?? ""}>{group.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>年級</span>
            <select className="input" value={grade} onChange={(e) => { setGrade(e.target.value); setClassId(""); }}>
              <option value="">全部年級</option>
              {gradeOptions.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>班級</span>
            <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">全部班級</option>
              {classes.filter((item) => !grade || item.grade === Number(grade)).map((item) => (
                <option key={item.id} value={item.id}>{item.label ?? item.class_code}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>分類</span>
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">全部分類</option>
              {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>商品</span>
              <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">全部商品</option>
                {allProducts.filter((p) => !categoryId || p.catId === categoryId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>繳費狀態</span>
            <select className="input" value={isPaid} onChange={(e) => setIsPaid(e.target.value)}>
              <option value="">全部</option>
              <option value="true">已繳費</option>
              <option value="false">未繳費</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>訂單狀態</span>
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">有效訂單</option>
              <option value="pending">待確認</option>
              <option value="confirmed">已確認</option>
              <option value="cancelled">已取消</option>
              <option value="refunded">已退款</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>起始日期</span>
            <input className="input" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>結束日期</span>
            <input className="input" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {tab === "orders" && <label className="grid gap-1 text-sm lg:col-span-2">
            <span style={{ color: "var(--text-muted)" }}>搜尋訂單編號或學生姓名</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder="輸入編號或姓名" />
          </label>}
        </div>
      </details>

      {loadError && <p role="alert" className="p-4" style={{ color: "var(--danger)" }}>{loadError}</p>}
      <div hidden={Boolean(loadError)}>
      {/* Tab 1：班級彙總 */}
      {tab === "summary" && (
        <section>
          {summary && (
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              {[
                { label: "總金額", value: money(summary.total_amount) },
                { label: "已繳", value: money(summary.paid_amount) },
                { label: "未繳", value: money(summary.unpaid_amount) },
              ].map((item) => (
                <div key={item.label} className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{item.label}</p>
                  <p className="mt-1 text-xl font-bold" style={{ color: "var(--primary)" }}>{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {canManageOrderClosures && groupBy === "class" && summary && summary.rows.length > 0 && catalog.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {activityGroups.map((group) => (
                <div key={group.key} className="flex flex-wrap items-center gap-1.5 rounded-md px-2 py-1"
                  style={{ border: "1px solid var(--border)" }}>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{group.label}</span>
                  <button type="button" onClick={() => batchClose(summary.rows, group, false)} disabled={loading}
                    className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium disabled:opacity-50"
                    style={{ border: "1px solid var(--border)", color: "#ef4444" }}>
                    <Lock size={12} /> 批次結單
                  </button>
                  <button type="button" onClick={() => batchClose(summary.rows, group, true)} disabled={loading}
                    className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium disabled:opacity-50"
                    style={{ border: "1px solid var(--border)", color: "#16a34a" }}>
                    <LockOpen size={12} /> 批次重開
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            {loading ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : !summary?.rows.length ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>沒有符合條件的資料</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="shop-mobile-table w-full min-w-[720px] text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {[groupBy === "class" ? "班級" : groupBy === "grade" ? "年級" : "學生", "訂單數", "總金額", "已繳", "未繳", ...(groupBy === "class" ? activityGroups.map((group) => group.label + "結單") : []), ...(groupBy === "class" && canManageOrderClosures ? ["班聯操作"] : [])].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((row, idx) => (
                      <tr key={row.key} style={idx < summary.rows.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                        <td className="px-4 py-3 font-medium" style={{ color: "var(--text-primary)" }}>{row.label}</td>
                        <td data-label="訂單數" className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{row.order_count}</td>
                        <td data-label="應繳" className="px-4 py-3 text-xs">{money(row.total_amount)}</td>
                        <td data-label="班聯已確認" className="px-4 py-3 text-xs" style={{ color: "var(--success)" }}>{money(row.paid_amount)}</td>
                        <td data-label="待繳" className="px-4 py-3 text-xs" style={{ color: "var(--danger)" }}>{money(row.unpaid_amount)}</td>
                        {groupBy === "class" && activityGroups.map((group) => {
                          const statuses = group.categories.map((category) => closeStatus[row.key]?.[category.id]);
                          const closedCount = statuses.filter((item) => item?.is_closed).length;
                          return (
                          <td key={group.key} data-label={group.label} className="px-4 py-3">
                            <CloseBadge
                              status={statuses.find((item) => item?.is_closed)}
                              partial={closedCount > 0 && closedCount < group.categories.length}
                            />
                          </td>
                        );})}
                        {groupBy === "class" && canManageOrderClosures && <td className="px-4 py-3">
                          <div className="flex min-w-56 flex-col gap-2">
                            {activityGroups.map((group) => {
                              const statuses = group.categories.map((category) => closeStatus[row.key]?.[category.id]);
                              const closedCount = statuses.filter((item) => item?.is_closed).length;
                              const isClosed = closedCount === group.categories.length;
                              const isBusy = closeBusy === `${group.key}:${row.key}`;
                              const paymentKey = `${row.key}:${group.activityId ?? "__general__"}`;
                              return (
                                <div key={group.key} className="flex flex-wrap items-center gap-1 border-t pt-1.5 first:border-t-0 first:pt-0"
                                  style={{ borderColor: "var(--border)" }}>
                                  <span className="w-full text-[11px]" style={{ color: "var(--text-muted)" }}>{group.label}</span>
                                  {row.key !== "none" && <>
                                    {canConfirmClassPayment && <>
                                      <button type="button" disabled={paymentBusy === paymentKey}
                                        onClick={() => updateClassPayment(row, group, true)}
                                        className="rounded px-2 py-1 text-xs disabled:opacity-50"
                                        style={{ border: "1px solid var(--border)", color: "var(--primary)" }}>
                                        確認已繳
                                      </button>
                                      <button type="button" disabled={paymentBusy === paymentKey}
                                        onClick={() => updateClassPayment(row, group, false)}
                                        className="rounded px-2 py-1 text-xs disabled:opacity-50"
                                        style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                                        撤銷
                                      </button>
                                    </>}
                                  </>}
                                  {group.categories.length > 0 && row.key !== "none" && (
                                    <button type="button" disabled={isBusy}
                                      onClick={() => handleToggleClose(group, row.key, isClosed, row.label)}
                                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                                      style={{ border: "1px solid var(--border)", color: isClosed ? "#16a34a" : "#ef4444" }}
                                      title={`${isClosed ? "重開" : "結單"}：${group.label}`}>
                                      {isBusy ? "處理中" : isClosed ? <LockOpen size={10} /> : <Lock size={10} />}
                                      {isClosed ? "重開" : "結單"}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tab 2：商品數量 */}
      {tab === "quantities" && (
        <section>
          <div className="mb-3 flex justify-end">
            <AnimatedDownloadButton
              href="/api/shop/reports/orders.xlsx"
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              filename="orders.xlsx"
              label="匯出全部訂單 Excel" />
          </div>
          <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            {loading ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : !quantities.length ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>沒有符合條件的資料</div>
            ) : (
              <ProductQuantitySummary rows={quantities} />
            )}
          </div>
        </section>
      )}

      {/* Tab 3：訂單明細 */}
      {tab === "orders" && (
        <section>
          {(
            <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              {loading ? (
                <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
              ) : !orders.length ? (
                <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>沒有符合條件的訂單</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="shop-mobile-table w-full min-w-[700px] text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["訂單編號", "學生", "班級", "狀態", "金額", "繳費", "建立時間"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order, idx) => (
                        <tr key={order.id} style={idx < orders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                          <td className="px-4 py-3">
                            <Link href={`/shop/orders/${order.id}?from=council`} className="text-sm underline" style={{ color: "var(--primary)" }}>{order.serial_number}</Link>
                          </td>
                          <td data-label="學生" className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{order.user_name ?? "-"}</td>
                          <td data-label="班級" className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{order.class_label ?? "-"}</td>
                          <td className="px-4 py-3">
                            <OrderStatusBadge status={order.status} />
                          </td>
                          <td data-label="金額" className="px-4 py-3 text-xs font-medium">{money(order.total_price)}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full px-2 py-0.5 text-xs"
                              style={order.is_paid
                                ? { background: "rgba(34,197,94,0.12)", color: "#16a34a" }
                                : { background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                              {order.is_paid ? "已繳費" : "未繳費"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                            {new Date(order.created_at).toLocaleDateString("zh-TW")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      </div>
      {/* 結單確認 Modal */}
      {closeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl p-6 shadow-xl" style={{ background: "var(--card-bg)" }}>
            <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>確認結單</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              確定要為班級「<strong>{closeTarget.label}</strong>」的訂購分類結單？
              <br />結單後該班學生無法新增訂單。
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button type="button" onClick={() => setCloseTarget(null)} className="btn btn-ghost">取消</button>
              <button type="button" onClick={doClose} disabled={closeBusy !== null}
                className="btn disabled:opacity-50"
                style={{ background: "#ef4444", color: "white", border: "none" }}>
                {closeBusy ? "結單中..." : "確認結單"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
