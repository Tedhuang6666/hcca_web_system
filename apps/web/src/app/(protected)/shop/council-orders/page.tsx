"use client";

import Link from "next/link";
import ProductQuantitySummary from "@/components/shop/ProductQuantitySummary";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart2, Lock, LockOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import Modal from "@/components/ui/Modal";
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
  if (!status && !partial) return <span className="text-xs" style={{ color: "var(--text-secondary)" }}>狀態待確認</span>;
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
  const requestVersion = useRef(0);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [batchResult, setBatchResult] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const mutationBusy = batchBusy || paymentBusy !== null || closeBusy !== null;

  // 班聯結單選擇
  const [closeTarget, setCloseTarget] = useState<{
    categoryIds: string[];
    classId: string;
    label: string;
    busyKey: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOptionsError(false);
    Promise.all([shopApi.catalog(), classApi.recipientOptions()]).then(([nextCatalog, nextClasses]) => {
      if (cancelled) return;
      setCatalog(nextCatalog);
      setClasses(nextClasses);
    }).catch(() => { if (!cancelled) setOptionsError(true); });
    return () => { cancelled = true; };
  }, [optionsRetry]);

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
    const version = ++requestVersion.current;
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
      if (version !== requestVersion.current) return;
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
        if (version !== requestVersion.current) return;
        setCloseStatus(statusMap);
      }
    } catch (e) {
      if (version !== requestVersion.current) return;
      setLoadError(apiErrorMessage(e, "載入失敗，請重新整理後再試。"));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [groupBy, grade, classId, activityId, isPaid, productId, categoryId, statusFilter, catalog, dateParams]);

  const loadQuantities = useCallback(async () => {
    const version = ++requestVersion.current;
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
      if (version !== requestVersion.current) return;
      setQuantities(data);
    } catch (e) {
      if (version !== requestVersion.current) return;
      setLoadError(apiErrorMessage(e, "載入失敗，請重新整理後再試。"));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [activityId, grade, classId, categoryId, productId, isPaid, statusFilter, dateParams]);

  const loadOrders = useCallback(async () => {
    const version = ++requestVersion.current;
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
        if (version !== requestVersion.current) return;
        data.push(...page);
        if (page.length < 500) break;
      }
      setOrders(data);
    } catch (e) {
      if (version !== requestVersion.current) return;
      setLoadError(apiErrorMessage(e, "載入失敗，請重新整理後再試。"));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [activityId, grade, classId, isPaid, productId, categoryId, statusFilter, search, dateParams]);

  const updateClassPayment = async (
    row: OrderSummaryRow,
    activity: { activityId: string | null; label: string },
    paid: boolean,
  ) => {
    if (row.key === "none") return;
    const action = paid ? "確認已繳費" : "撤銷繳費確認";
    if (!window.confirm(`要為「${row.label}」的「${activity.label}」${action}嗎？會更新該班這個活動的所有有效訂單，不受商品、日期或收款篩選限制。`)) return;
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
    const pendingRequests = requestVersion;
    if (tab === "summary") loadSummary();
    else if (tab === "quantities") loadQuantities();
    else loadOrders();
    return () => { pendingRequests.current++; };
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
    const classCount = rows.filter((row) => row.key !== "none").length;
    if (!window.confirm(`要${open ? "重新開放" : "停止"}目前清單中 ${classCount} 個班級的「${group.label}」訂購嗎？這會影響這些班級在此活動的所有商品。`)) return;
    setBatchResult("");
    setBatchBusy(true);
    setLoading(true);
    let count = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.key === "none") continue;
      for (const category of group.categories) {
        const status = closeStatus[row.key]?.[category.id];
        if (!status) { failed++; continue; }
        const isClosed = status.is_closed;
        if (open && isClosed) {
          try { await shopApi.reopenCategory(category.id, row.key); count++; } catch { failed++; }
        } else if (!open && !isClosed) {
          try { await shopApi.closeCategory(category.id, { class_id: row.key }); count++; } catch { failed++; }
        }
      }
    }
    const message = `「${group.label}」已${open ? "重新開放" : "停止訂購"} ${count} 項班級商品主題${failed ? `；${failed} 項未完成，請重新整理後再試。` : "。"}`;
    setBatchResult(message);
    if (failed) toast.error(message);
    else toast.success(message);
    await loadSummary();
    setLoading(false);
    setBatchBusy(false);
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

  const visibleActivityGroups = activityGroups.filter((group) => activityId === "all" || group.activityId === activityId);
  const visibleCategoryIds = new Set(visibleActivityGroups.flatMap((group) => group.categories.map((category) => category.id)));
  const hasFilters = activityId !== "all" || Boolean(grade || classId || categoryId || productId || isPaid || statusFilter || dateFrom || dateTo || (tab === "orders" && search));
  const resetFilters = () => {
    setActivityId("all"); setGrade(""); setClassId(""); setCategoryId(""); setProductId("");
    setIsPaid(""); setStatusFilter(""); setDateFrom(""); setDateTo(""); setSearch("");
  };
  const scopeLabels = [
    activityId === "all" ? "全部活動" : activityGroups.find((group) => group.activityId === activityId)?.label,
    grade && `${grade} 年級`,
    classes.find((item) => item.id === classId)?.label,
    catalog.find((item) => item.id === categoryId)?.name,
    allProducts.find((item) => item.id === productId)?.name,
    isPaid === "true" ? "班聯已確認" : isPaid === "false" ? "班聯未確認" : "全部收款狀態",
    statusFilter ? { pending: "待確認訂單", confirmed: "已確認訂單", cancelled: "已取消訂單", refunded: "已退款訂單" }[statusFilter] : tab === "orders" ? "全部訂單狀態" : "排除取消與退款",
    (dateFrom || dateTo) && `${dateFrom || "不限起日"} 至 ${dateTo || "不限迄日"}`,
    tab === "orders" && search && `搜尋：${search}`,
  ].filter(Boolean);

  return (
    <main className="shop-council-page mx-auto max-w-7xl space-y-5 px-4 py-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            <BarChart2 size={22} /> 全校收款與訂單
          </h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--text-muted)" }}>
            先選活動，再確認各班繳款、查看商品數量或查找訂單。
          </p>
        </div>
        <button type="button" onClick={() => { if (tab === "summary") loadSummary(); else if (tab === "quantities") loadQuantities(); else loadOrders(); }}
          disabled={loading || mutationBusy} className="btn btn-ghost" aria-label="重新整理">
          <RefreshCw size={15} /> 重新整理
        </button>
      </header>

      <nav className="shop-task-switch" aria-label="班聯統籌工作">
        {([["summary", "班級繳款"], ["quantities", "商品總量"], ["orders", "查找訂單"]] as const).map(([key, label]) => (
          <button key={key} type="button" disabled={mutationBusy} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      <section className="space-y-3 rounded-lg p-4" aria-label="統計範圍" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <fieldset disabled={mutationBusy} className="min-w-0 space-y-3">
        <legend className="sr-only">篩選訂單</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>活動</span>
            <select className="input" value={activityId} onChange={(e) => { setActivityId(e.target.value); setCategoryId(""); setProductId(""); }}>
              <option value="all">全部活動</option>
              {activityGroups.filter((group) => group.activityId).map((group) => (
                <option key={group.key} value={group.activityId ?? ""}>{group.label}</option>
              ))}
            </select>
          </label>
          {hasFilters && <button type="button" className="btn btn-ghost" onClick={resetFilters}>清除篩選</button>}
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>目前範圍：{scopeLabels.join(" · ")}</p>
        {optionsError && <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>活動與班級選項載入失敗。<button type="button" className="btn btn-ghost" onClick={() => setOptionsRetry((value) => value + 1)}>重新載入選項</button></div>}
      {/* 篩選列 */}
      <details>
        <summary className="min-h-11 cursor-pointer font-medium">更多篩選：班級、商品、收款與日期</summary>
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
            <span style={{ color: "var(--text-muted)" }}>商品主題</span>
            <select className="input" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setProductId(""); }}>
              <option value="">全部商品主題</option>
              {catalog.filter((category) => visibleCategoryIds.has(category.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>商品</span>
              <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">全部商品</option>
                {allProducts.filter((p) => visibleCategoryIds.has(p.catId) && (!categoryId || p.catId === categoryId)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>班聯收款狀態</span>
            <select className="input" value={isPaid} onChange={(e) => setIsPaid(e.target.value)}>
              <option value="">全部</option>
              <option value="true">班聯已確認</option>
              <option value="false">班聯未確認</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>訂單狀態</span>
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{tab === "orders" ? "全部訂單狀態" : "排除取消與退款"}</option>
              <option value="pending">待確認</option>
              <option value="confirmed">已確認</option>
              <option value="cancelled">已取消</option>
              <option value="refunded">已退款</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>訂購起日</span>
            <input className="input" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>訂購迄日</span>
            <input className="input" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {tab === "orders" && <label className="grid gap-1 text-sm lg:col-span-2">
            <span style={{ color: "var(--text-muted)" }}>搜尋訂單編號或學生姓名</span>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} placeholder="輸入編號或姓名" />
          </label>}
        </div>
      </details>
        </fieldset>
      </section>
      {batchResult && <p role="status" className="rounded-lg p-3 text-sm" style={{ background: "var(--bg-elevated)" }}>{batchResult}</p>}

      {loadError && <p role="alert" className="p-4" style={{ color: "var(--danger)" }}>{loadError}</p>}
      <div hidden={Boolean(loadError)}>
      {/* Tab 1：班級彙總 */}
      {tab === "summary" && (
        <section>
          <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>同學已交給班代、尚未由班聯確認的款項，仍列在「班聯未確認」。</p>
          {summary && !loading && (
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              {[
                { label: "訂購金額", value: money(summary.total_amount) },
                { label: "班聯已確認", value: money(summary.paid_amount) },
                { label: "班聯未確認", value: money(summary.unpaid_amount) },
              ].map((item) => (
                <div key={item.label} className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{item.label}</p>
                  <p className="mt-1 text-xl font-bold" style={{ color: "var(--primary-text)" }}>{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {canManageOrderClosures && !loading && groupBy === "class" && summary && summary.rows.length > 0 && catalog.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {visibleActivityGroups.map((group) => (
                <div key={group.key} className="flex flex-wrap items-center gap-1.5 rounded-md px-2 py-1"
                  style={{ border: "1px solid var(--border)" }}>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{group.label}</span>
                  <button type="button" onClick={() => batchClose(summary.rows, group, false)} disabled={loading || mutationBusy}
                    className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium disabled:opacity-50"
                    style={{ border: "1px solid var(--border)", color: "#ef4444" }}>
                    <Lock size={12} /> 整批停止訂購
                  </button>
                  <button type="button" onClick={() => batchClose(summary.rows, group, true)} disabled={loading || mutationBusy}
                    className="flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium disabled:opacity-50"
                    style={{ border: "1px solid var(--border)", color: "#16a34a" }}>
                    <LockOpen size={12} /> 整批重新開放
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            {loading ? (
              <div role="status" className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : !summary?.rows.length ? (
              <div role="status" className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>目前範圍沒有資料，可清除篩選或改選其他活動。</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="shop-mobile-table w-full min-w-[720px] text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {[groupBy === "class" ? "班級" : groupBy === "grade" ? "年級" : "學生", "訂單數", "訂購金額", "班聯已確認", "班聯未確認", ...(groupBy === "class" ? visibleActivityGroups.map((group) => group.label + "訂購狀態") : []), ...(groupBy === "class" && canManageOrderClosures ? ["班聯操作"] : [])].map((h, i) => (
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
                        <td data-label="班聯未確認" className="px-4 py-3 text-xs" style={{ color: "var(--danger)" }}>{money(row.unpaid_amount)}</td>
                        {groupBy === "class" && visibleActivityGroups.map((group) => {
                          const statuses = group.categories.map((category) => closeStatus[row.key]?.[category.id]);
                          const closedCount = statuses.filter((item) => item?.is_closed).length;
                          return (
                          <td key={group.key} data-label={group.label} className="px-4 py-3">
                            <CloseBadge
                              status={statuses.every(Boolean) ? statuses.find((item) => item?.is_closed) ?? statuses[0] : undefined}
                              partial={statuses.every(Boolean) && closedCount > 0 && closedCount < group.categories.length}
                            />
                          </td>
                        );})}
                        {groupBy === "class" && canManageOrderClosures && <td className="px-4 py-3">
                          <div className="flex min-w-56 flex-col gap-2">
                            {visibleActivityGroups.map((group) => {
                              const statuses = group.categories.map((category) => closeStatus[row.key]?.[category.id]);
                              const closedCount = statuses.filter((item) => item?.is_closed).length;
                              const isClosed = closedCount === group.categories.length;
                              const isBusy = closeBusy === `${group.key}:${row.key}`;
                              return (
                                <div key={group.key} className="flex flex-wrap items-center gap-1 border-t pt-1.5 first:border-t-0 first:pt-0"
                                  style={{ borderColor: "var(--border)" }}>
                                  <span className="w-full text-[11px]" style={{ color: "var(--text-muted)" }}>{group.label}</span>
                                  {row.key !== "none" && <>
                                    {canConfirmClassPayment && <>
                                      <button type="button" disabled={mutationBusy}
                                        onClick={() => updateClassPayment(row, group, true)}
                                        className="rounded px-2 py-1 text-xs disabled:opacity-50"
                                        style={{ border: "1px solid var(--border)", color: "var(--primary-text)" }}>
                                        確認班聯收到款項
                                      </button>
                                      <button type="button" disabled={mutationBusy}
                                        onClick={() => updateClassPayment(row, group, false)}
                                        className="rounded px-2 py-1 text-xs disabled:opacity-50"
                                        style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                                        撤銷收款確認
                                      </button>
                                    </>}
                                  </>}
                                  {group.categories.length > 0 && row.key !== "none" && (
                                    <button type="button" disabled={mutationBusy || !statuses.every(Boolean)}
                                      onClick={() => handleToggleClose(group, row.key, isClosed, row.label)}
                                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                                      style={{ border: "1px solid var(--border)", color: isClosed ? "#16a34a" : "#ef4444" }}
                                      title={`${isClosed ? "重新開放訂購" : "停止訂購"}：${group.label}`}>
                                      {isBusy ? "處理中" : isClosed ? <LockOpen size={10} /> : <Lock size={10} />}
                                      {isClosed ? "重新開放訂購" : "停止訂購"}
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>下方數量依目前篩選計算；Excel 匯出全部訂單，不套用篩選。</p>
            <AnimatedDownloadButton
              href="/api/shop/reports/orders.xlsx"
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              filename="orders.xlsx"
              label="匯出全部訂單 Excel" />
          </div>
          <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            {loading ? (
              <div role="status" className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : !quantities.length ? (
              <div role="status" className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>目前範圍沒有資料，可清除篩選或改選其他活動。</div>
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
                <div role="status" className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
              ) : !orders.length ? (
                <div role="status" className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>目前範圍沒有訂單，可清除篩選或改用其他關鍵字。</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="shop-mobile-table w-full min-w-[700px] text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["訂單編號", "學生", "班級", "狀態", "金額", "班聯收款", "建立時間"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order, idx) => (
                        <tr key={order.id} style={idx < orders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                          <td className="px-4 py-3">
                            <Link href={`/shop/orders/${order.id}?from=council`} className="text-sm underline" style={{ color: "var(--primary-text)" }}>{order.serial_number}</Link>
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
                              {order.is_paid ? "班聯已確認" : "班聯未確認"}
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
        <Modal title="停止這個班級的訂購？" size="md" onClose={() => { if (!closeBusy) setCloseTarget(null); }}>
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
              即將停止「<strong>{closeTarget.label}</strong>」的訂購。
              <br />停止後，該班學生無法再訂購這個活動的商品。需要追加時可重新開放。
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button type="button" onClick={() => setCloseTarget(null)} disabled={closeBusy !== null} className="btn btn-ghost">取消</button>
              <button type="button" onClick={doClose} disabled={closeBusy !== null}
                className="btn disabled:opacity-50"
                style={{ background: "#ef4444", color: "white", border: "none" }}>
                {closeBusy ? "處理中…" : "確認停止訂購"}
              </button>
            </div>
        </Modal>
      )}
    </main>
  );
}
