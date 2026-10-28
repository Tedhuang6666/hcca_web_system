"use client";

import Link from "next/link";
import ProductQuantitySummary from "@/components/shop/ProductQuantitySummary";
import ShopSalesAnalytics from "@/components/shop/ShopSalesAnalytics";
import AdminAssistedOrder from "@/components/shop/AdminAssistedOrder";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import Modal from "@/components/ui/Modal";
import type {
  ActivityOut,
  CatalogCategoryOut,
  CloseStatusItem,
  OrderListItem,
  OrderQuantityRow,
  OrderSummaryOut,
  OrderSummaryRow,
  SchoolClassListItem,
} from "@/lib/types";

type Tab = "summary" | "quantities" | "orders" | "analytics";

function money(v: number) {
  return `NT$${v.toLocaleString("zh-TW")}`;
}

// ── 結單狀態徽章 ─────────────────────────────────────────────────────────────

function CloseBadge({ status, partial = false }: { status: CloseStatusItem | undefined; partial?: boolean }) {
  if (!status && !partial) return <span className="text-xs" style={{ color: "var(--text-secondary)" }}>狀態待確認</span>;
  if (partial) return (
    <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(245,158,11,0.12)", color: "#b45309" }}>
      部分商品停止訂購
    </span>
  );
  if (!status?.is_closed) return (
    <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}>
      開放訂購
    </span>
  );
  return (
    <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
      已停止訂購
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
  const canViewAdvancedStats = hasAdminPermission || permissions.has("shop:manage");
  const [tab, setTab] = useState<Tab>("summary");
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0);
  const [groupBy, setGroupBy] = useState<"class" | "grade" | "user">("class");

  // 篩選
  const [grade, setGrade] = useState("");
  const [classId, setClassId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [receiptActivityKey, setReceiptActivityKey] = useState("");
  const [productId, setProductId] = useState("");
  const [isPaid, setIsPaid] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  // 資料
  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [activities, setActivities] = useState<ActivityOut[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [summary, setSummary] = useState<OrderSummaryOut | null>(null);
  const [quantities, setQuantities] = useState<OrderQuantityRow[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [closeStatus, setCloseStatus] = useState<Record<string, Record<string, CloseStatusItem>>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [paymentBusy, setPaymentBusy] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [selectedReceiptClasses, setSelectedReceiptClasses] = useState<Set<string>>(new Set());
  const requestVersion = useRef(0);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<OrderListItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelResult, setCancelResult] = useState("");
  const mutationBusy = paymentBusy !== null || cancelBusy;

  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(false);
    Promise.all([
      shopApi.catalog(undefined, true),
      classApi.recipientOptions(),
      shopApi.listActivities(),
    ]).then(([nextCatalog, nextClasses, nextActivities]) => {
      if (cancelled) return;
      setCatalog(nextCatalog);
      setClasses(nextClasses);
      setActivities(nextActivities);
    }).catch(() => { if (!cancelled) setOptionsError(true); })
      .finally(() => { if (!cancelled) setOptionsLoading(false); });
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
    for (const activity of activities) {
      groups.set(activity.id, {
        key: activity.id,
        activityId: activity.id,
        label: activity.name,
        categories: [],
      });
    }
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
  }, [activities, catalog]);

  const loadSummary = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const params: Parameters<typeof shopApi.orderSummary>[0] = { group_by: groupBy, ...dateParams };
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
  }, [groupBy, grade, classId, isPaid, productId, categoryId, statusFilter, catalog, dateParams]);

  const loadQuantities = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const params: Parameters<typeof shopApi.orderQuantities>[0] = { ...dateParams };
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
  }, [grade, classId, categoryId, productId, isPaid, statusFilter, dateParams]);

  const loadOrders = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const params: Record<string, string> = { my_only: "false", limit: "500" };
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
  }, [grade, classId, isPaid, productId, categoryId, statusFilter, search, dateParams]);

  const cancelOrder = async () => {
    if (!cancelTarget || cancelBusy) return;
    setCancelBusy(true);
    setCancelError("");
    setCancelResult("");
    try {
      await shopApi.cancelOrder(cancelTarget.id, cancelReason.trim() || undefined);
      setCancelTarget(null);
      setCancelResult(`訂單 ${cancelTarget.serial_number} 已取消。`);
      await loadOrders();
    } catch (e) {
      setCancelError(apiErrorMessage(e, "取消失敗，請稍後再試。"));
    } finally {
      setCancelBusy(false);
    }
  };

  const updateClassPayment = async (
    row: OrderSummaryRow,
    activity: { activityId: string | null; label: string },
    paid: boolean,
  ) => {
    if (row.key === "none") return;
    const action = paid ? "確認已繳費" : "撤銷繳費確認";
    if (!window.confirm(`要為「${row.label}」的「${activity.label}」${action}嗎？會更新該班這個活動的所有有效訂單，不受商品、日期或收款篩選限制。${paid ? "確認後將鎖定本班此活動的訂購。" : "撤銷後仍須遵守班聯統一截止時間。"}`)) return;
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
    else if (tab === "orders") loadOrders();
    return () => { pendingRequests.current++; };
  }, [tab, loadSummary, loadQuantities, loadOrders]);

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

  const selectedCategory = catalog.find((category) => category.id === categoryId);
  const visibleActivityGroups = activityGroups.filter((group) => !categoryId
    || group.categories.some((category) => category.id === categoryId));
  const paymentActivityGroups = visibleActivityGroups;
  const actionActivityGroups = !categoryId ? [] : visibleActivityGroups.map((group) => ({
    ...group, label: selectedCategory?.name ?? group.label,
    categories: group.categories.filter((category) => category.id === categoryId),
  }));
  const canBatchDownloadReceipts = canConfirmClassPayment && groupBy === "class";
  const batchReceiptActivityId = receiptActivityKey && receiptActivityKey !== "__general__"
    ? receiptActivityKey
    : null;
  const receiptRows = summary?.rows.filter((row) => row.key !== "none") ?? [];
  const allReceiptRowsSelected = receiptRows.length > 0
    && receiptRows.every((row) => selectedReceiptClasses.has(row.key));
  const visibleCategoryIds = new Set(visibleActivityGroups.flatMap((group) => group.categories.map((category) => category.id)));
  const hasFilters = Boolean(grade || classId || categoryId || productId || isPaid || statusFilter || dateFrom || dateTo || (tab === "orders" && search));
  const resetFilters = () => {
    setGrade(""); setClassId(""); setCategoryId(""); setProductId("");
    setIsPaid(""); setStatusFilter(""); setDateFrom(""); setDateTo(""); setSearch("");
    setReceiptActivityKey("");
    setSelectedReceiptClasses(new Set());
  };
  const scopeLabels = [
    selectedCategory?.name ?? "全部活動",
    grade && `${grade} 年級`,
    classes.find((item) => item.id === classId)?.label,
    allProducts.find((item) => item.id === productId)?.name,
    isPaid === "true" ? "班聯已確認" : isPaid === "false" ? "班聯未確認" : "全部收款狀態",
    statusFilter && tab !== "analytics" ? { pending: "待確認訂單", confirmed: "已確認訂單", cancelled: "已取消訂單", refunded: "已退款訂單" }[statusFilter] : tab === "orders" ? "全部訂單狀態" : "排除取消與退款",
    (dateFrom || dateTo) && `${dateFrom || (tab === "analytics" ? "迄日前 29 天" : "不限起日")} 至 ${dateTo || (tab === "analytics" ? "今天" : "不限迄日")}`,
    tab === "orders" && search && `搜尋：${search}`,
  ].filter(Boolean);

  return (
    <main className="shop-council-page mx-auto max-w-7xl space-y-5 px-4 py-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            <BarChart2 size={22} /> 班聯工作
          </h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--text-muted)" }}>
            可直接在班級列確認指定活動收款並下載簽收單 PDF；也能依活動篩選，再查看商品數量或訂單。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canViewAdvancedStats && <Link href="/shop/admin?view=stats" className="btn btn-ghost min-h-11">進階訂購統計</Link>}
          <button type="button" onClick={() => { if (tab === "summary") loadSummary(); else if (tab === "quantities") loadQuantities(); else if (tab === "analytics") setAnalyticsRefresh((value) => value + 1); else loadOrders(); }}
            disabled={(tab !== "analytics" && loading) || mutationBusy} className="btn btn-ghost" aria-label="重新整理">
            <RefreshCw size={15} /> 重新整理
          </button>
        </div>
      </header>

      {canConfirmClassPayment && <AdminAssistedOrder catalog={catalog} classes={classes} optionsError={optionsError} optionsLoading={optionsLoading}
        onRetry={() => setOptionsRetry((value) => value + 1)}
        onCreated={() => { if (tab === "summary") void loadSummary(); else if (tab === "quantities") void loadQuantities(); else if (tab === "orders") void loadOrders(); else setAnalyticsRefresh((value) => value + 1); }} />}

      <nav className="shop-task-switch" aria-label="班聯統籌工作">
        {([["summary", "班級繳款"], ["quantities", "商品總量"], ["orders", "查找訂單"], ["analytics", "銷售分析"]] as const).map(([key, label]) => (
          <button key={key} type="button" disabled={mutationBusy} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      <section className="space-y-3 rounded-lg p-4" aria-label="統計範圍" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <fieldset disabled={mutationBusy} className="min-w-0 space-y-3">
        <legend className="sr-only">篩選訂單</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>活動</span>
            <select className="input" value={categoryId} onChange={(e) => {
              setCategoryId(e.target.value);
              setProductId("");
              setReceiptActivityKey(e.target.value
                ? catalog.find((category) => category.id === e.target.value)?.activity_id ?? "__general__" : "");
              setSelectedReceiptClasses(new Set());
            }}>
              <option value="">全部活動</option>
              {catalog.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          {tab === "analytics" && <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>商品</span>
            <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">全部商品</option>
              {allProducts.filter((p) => visibleCategoryIds.has(p.catId) && (!categoryId || p.catId === categoryId)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>}
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
          {tab !== "analytics" && <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>商品</span>
              <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">全部商品</option>
                {allProducts.filter((p) => visibleCategoryIds.has(p.catId) && (!categoryId || p.catId === categoryId)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
          </label>}
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>班聯收款狀態</span>
            <select className="input" value={isPaid} onChange={(e) => setIsPaid(e.target.value)}>
              <option value="">全部</option>
              <option value="true">班聯已確認</option>
              <option value="false">班聯未確認</option>
            </select>
          </label>
          {tab !== "analytics" && <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>訂單狀態</span>
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{tab === "orders" ? "全部訂單狀態" : "排除取消與退款"}</option>
              <option value="pending">待確認</option>
              <option value="confirmed">已確認</option>
              <option value="cancelled">已取消</option>
              <option value="refunded">已退款</option>
            </select>
          </label>}
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

      {tab === "analytics" && <ShopSalesAnalytics refresh={analyticsRefresh} live={canViewAdvancedStats} scope={scopeLabels.join(" · ")} filters={{
        ...(grade ? { grade } : {}), ...(classId ? { class_id: classId } : {}),
        ...(categoryId ? { category_id: categoryId } : {}), ...(productId ? { product_id: productId } : {}),
        ...(isPaid ? { is_paid: isPaid } : {}), ...(dateFrom ? { date_from: dateFrom } : {}),
        ...(dateTo ? { date_to: dateTo } : {}),
      }} />}
      {tab !== "analytics" && loadError && <p role="alert" className="p-4" style={{ color: "var(--danger)" }}>{loadError}</p>}
      <div hidden={tab !== "analytics" && Boolean(loadError)}>
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


          {groupBy === "class" && !categoryId && summary && summary.rows.length > 0 && (
            <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
              目前顯示全部活動彙總；每班操作都會標示活動名稱，確認收款與簽收單只套用該班該活動。
            </p>
          )}

          {groupBy === "class" && canConfirmClassPayment && paymentActivityGroups.length > 0 && (
            <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
              各班操作只處理標示活動中的有效訂單，不受商品、日期或收款篩選影響。簽收單可在收款確認前下載，也可選取多班合併成一份 PDF。
            </p>
          )}
          {receiptError && <p role="alert" className="mb-3 text-sm" style={{ color: "var(--danger)" }}>{receiptError}</p>}
          {canBatchDownloadReceipts && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3"
              style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>班級簽收單</p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  選擇活動或一般商品後，可勾選多班，或下載該範圍所有有有效訂單的班級；全部班級不受目前篩選影響。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="grid gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  收據範圍
                  <select
                    className="input min-h-11"
                    aria-label="收據活動"
                    value={receiptActivityKey}
                    onChange={(event) => {
                      setReceiptActivityKey(event.target.value);
                      setSelectedReceiptClasses(new Set());
                    }}
                  >
                    <option value="">請選擇活動或一般商品</option>
                    <option value="__general__">一般商品</option>
                    {activityGroups.filter((group) => group.activityId).map((group) => (
                      <option key={group.key} value={group.key}>{group.label}</option>
                    ))}
                  </select>
                </label>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  已選 {selectedReceiptClasses.size} 班
                </span>
                <AnimatedDownloadButton
                  request={() => {
                    setReceiptError("");
                    return shopApi.downloadClassReceipts(batchReceiptActivityId, [...selectedReceiptClasses]);
                  }}
                  label={`下載所選 ${selectedReceiptClasses.size} 班 PDF`}
                  disabled={mutationBusy || loading || !receiptActivityKey || selectedReceiptClasses.size === 0}
                  className="btn btn-secondary min-h-11 px-3 text-xs disabled:opacity-50"
                  onError={(error) => setReceiptError(apiErrorMessage(error, "簽收單下載失敗，請重試。"))}
                />
                <AnimatedDownloadButton
                  request={() => {
                    setReceiptError("");
                    return shopApi.downloadClassReceipts(batchReceiptActivityId);
                  }}
                  label="下載全部班級 PDF"
                  disabled={mutationBusy || loading || !receiptActivityKey}
                  className="btn btn-ghost min-h-11 px-3 text-xs disabled:opacity-50"
                  onError={(error) => setReceiptError(apiErrorMessage(error, "簽收單下載失敗，請重試。"))}
                />
              </div>
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
                      {canBatchDownloadReceipts && <th className="px-3 py-3 text-left">
                        <input
                          type="checkbox"
                          aria-label="選取目前列表所有班級"
                          checked={allReceiptRowsSelected}
                          disabled={loading || mutationBusy || receiptRows.length === 0}
                          onChange={(event) => setSelectedReceiptClasses((current) => {
                            const next = new Set(current);
                            for (const row of receiptRows) {
                              if (event.target.checked) next.add(row.key);
                              else next.delete(row.key);
                            }
                            return next;
                          })}
                        />
                      </th>}
                      {[groupBy === "class" ? "班級" : groupBy === "grade" ? "年級" : "學生", "訂單數", "訂購金額", "班聯已確認", "班聯未確認", ...(groupBy === "class" ? actionActivityGroups.map((group) => group.label + "訂購狀態") : []), ...(groupBy === "class" && canConfirmClassPayment && paymentActivityGroups.length > 0 ? ["班聯操作"] : [])].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((row, idx) => (
                      <tr key={row.key} style={idx < summary.rows.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                        {canBatchDownloadReceipts && <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`選取${row.label}收據`}
                            checked={selectedReceiptClasses.has(row.key)}
                            disabled={loading || mutationBusy || row.key === "none"}
                            onChange={(event) => setSelectedReceiptClasses((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(row.key);
                              else next.delete(row.key);
                              return next;
                            })}
                          />
                        </td>}
                        <td className="px-4 py-3 font-medium" style={{ color: "var(--text-primary)" }}>{row.label}</td>
                        <td data-label="訂單數" className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{row.order_count}</td>
                        <td data-label="應繳" className="px-4 py-3 text-xs">{money(row.total_amount)}</td>
                        <td data-label="班聯已確認" className="px-4 py-3 text-xs" style={{ color: "var(--success)" }}>{money(row.paid_amount)}</td>
                        <td data-label="班聯未確認" className="px-4 py-3 text-xs" style={{ color: "var(--danger)" }}>{money(row.unpaid_amount)}</td>
                        {groupBy === "class" && actionActivityGroups.map((group) => {
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
                        {groupBy === "class" && canConfirmClassPayment && paymentActivityGroups.length > 0 && <td className="px-4 py-3">
                          <div className="flex min-w-56 flex-col gap-2">
                            {paymentActivityGroups.map((group) => {
                              return (
                                <div key={group.key} className="flex flex-wrap items-center gap-1 border-t pt-1.5 first:border-t-0 first:pt-0"
                                  style={{ borderColor: "var(--border)" }}>
                                  <span className="w-full text-[11px]" style={{ color: "var(--text-muted)" }}>{group.label}</span>
                                  {row.key !== "none" && <>
                                    {canConfirmClassPayment && <button type="button" disabled={mutationBusy}
                                      onClick={() => updateClassPayment(row, group, true)}
                                      aria-label={`確認${row.label}的${group.label}收款`}
                                      className="btn btn-secondary min-h-11 px-3 text-xs disabled:opacity-50">
                                      確認收款
                                    </button>}
                                    {canConfirmClassPayment && <AnimatedDownloadButton
                                      request={() => {
                                        setReceiptError("");
                                        return shopApi.downloadClassReceipt(row.key, group.activityId);
                                      }}
                                      label="下載簽收單 PDF"
                                      aria-label={`下載${row.label}的${group.label}簽收單 PDF`}
                                      disabled={mutationBusy}
                                      className="btn btn-ghost min-h-11 px-3 text-xs"
                                      onError={(error) => setReceiptError(apiErrorMessage(error, "簽收單下載失敗，請重試。"))}
                                    />}
                                    <details className="min-w-0">
                                      <summary className="flex min-h-11 cursor-pointer items-center text-xs underline underline-offset-2"
                                        style={{ color: "var(--text-secondary)" }}>其他操作</summary>
                                      <div className="flex flex-wrap gap-2 pb-1">
                                        {canConfirmClassPayment && <button type="button" disabled={mutationBusy}
                                          onClick={() => updateClassPayment(row, group, false)}
                                          aria-label={`撤銷${row.label}的${group.label}收款確認`}
                                          className="btn btn-ghost min-h-11 px-3 text-xs disabled:opacity-50">
                                          撤銷收款確認
                                        </button>}

                                      </div>
                                    </details>
                                  </>}
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
          {cancelResult && <p role="status" className="mb-3 text-sm">{cancelResult}</p>}
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
                        {["訂單編號", "訂購人", "班級", "狀態", "金額", "班聯收款", "建立時間"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{h}</th>
                        ))}
                        {canConfirmClassPayment && <th className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }}>操作</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order, idx) => (
                        <tr key={order.id} style={idx < orders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                          <td className="px-4 py-3">
                            <Link href={`/shop/orders/${order.id}?from=council`} className="text-sm underline" style={{ color: "var(--primary-text)" }}>{order.serial_number}</Link>
                          </td>
                          <td data-label="訂購人" className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{order.user_name ?? "-"}</td>
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
                          {canConfirmClassPayment && <td data-label="操作" className="px-4 py-3">
                            {(order.status === "pending" || order.status === "confirmed") && (
                              order.is_paid || order.is_class_collected
                                ? <span className="text-xs" style={{ color: "var(--text-secondary)" }}>已收款，請先撤銷收款再取消</span>
                                : <button
                                  type="button"
                                  className="btn btn-danger-ghost min-h-11 whitespace-nowrap"
                                  aria-label={`取消訂單 ${order.serial_number}`}
                                  disabled={mutationBusy}
                                  onClick={() => {
                                    setCancelTarget(order);
                                    setCancelReason("");
                                    setCancelError("");
                                  }}
                                >取消訂單</button>
                            )}
                          </td>}
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

      {cancelTarget && <Modal title="取消訂單" size="sm" mobileFullscreen={false} onClose={() => { if (!cancelBusy) setCancelTarget(null); }}>
        <form onSubmit={(event) => { event.preventDefault(); void cancelOrder(); }} className="space-y-4">
          <p className="text-sm">確定取消「{cancelTarget.user_name ?? "訂購人"}」的訂單 {cancelTarget.serial_number}（{money(cancelTarget.total_price)}）？取消後會回補庫存並撤銷應收款。</p>
          <label className="block text-sm">
            取消原因（選填）
            <textarea className="input mt-2 w-full" rows={3} maxLength={500} value={cancelReason} disabled={cancelBusy} onChange={(event) => setCancelReason(event.target.value)} />
          </label>
          {cancelError && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{cancelError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-ghost min-h-11" disabled={cancelBusy} onClick={() => setCancelTarget(null)}>返回</button>
            <button type="submit" className="btn btn-danger min-h-11" disabled={cancelBusy}>{cancelBusy ? "取消中…" : "確認取消訂單"}</button>
          </div>
        </form>
      </Modal>}
    </main>
  );
}
