"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import ProductQuantitySummary from "@/components/shop/ProductQuantitySummary";
import ShopSalesAnalytics from "@/components/shop/ShopSalesAnalytics";
import AdminAssistedOrder from "@/components/shop/AdminAssistedOrder";
import SupplementOrders from "@/components/shop/SupplementOrders";
import SeparateOrderButton from "@/components/shop/SeparateOrderButton";
import ActivityOrderClosure from "@/components/shop/ActivityOrderClosure";
import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { classApi, emailApi, shopApi, apiErrorMessage } from "@/lib/api";
import {
  planClassStatusRefresh,
  type ClassStatusCache,
  type StatusRefreshOptions,
} from "@/lib/shop-close-status-cache";
import { usePermissions } from "@/hooks/usePermissions";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import Modal from "@/components/ui/Modal";
import NumberInput from "@/components/ui/NumberInput";
import { buildPaymentReminderDraft, type PaymentReminderKind } from "./paymentReminderDraft";
import type {
  ActivityOut,
  CatalogCategoryOut,
  ClassPaymentReportItemOut,
  CloseStatusItem,
  EmailRecipientVariableInput,
  OrderListItem,
  OrderQuantityRow,
  OrderSummaryOut,
  OrderSummaryRow,
  ShopClassRepresentativeRecipientOut,
  SchoolClassListItem,
} from "@/lib/types";

type Tab = "summary" | "quantities" | "orders" | "analytics";
type LoadSummaryOptions = StatusRefreshOptions;

const CLOSE_STATUS_CACHE_TTL_MS = 30_000;

function money(v: number) {
  return `NT$${v.toLocaleString("zh-TW")}`;
}

function taipeiDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function taipeiDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
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
  const router = useRouter();
  const { isAdmin, permissions } = usePermissions();
  const hasAdminPermission = isAdmin || permissions.has("admin:all");
  const canConfirmClassPayment = hasAdminPermission
    || permissions.has("shop:manage")
    || permissions.has("shop:manage_orders");
  const canViewClassPaymentReport = canConfirmClassPayment
    || permissions.has("shop:view_all")
    || permissions.has("finance:view");
  const canViewAdvancedStats = hasAdminPermission || permissions.has("shop:manage");
  const [tab, setTab] = useState<Tab>("summary");
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0);
  const [supplementRefresh, setSupplementRefresh] = useState(0);
  const [groupBy, setGroupBy] = useState<"class" | "grade" | "user">("class");

  // 篩選
  const [grade, setGrade] = useState("");
  const [classId, setClassId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [receiptCategoryId, setReceiptCategoryId] = useState("");
  const [productId, setProductId] = useState("");
  const [isPaid, setIsPaid] = useState("");
  const [classCollectedFilter, setClassCollectedFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [collectionDateFrom, setCollectionDateFrom] = useState(() => taipeiDate(new Date()));
  const [collectionDateTo, setCollectionDateTo] = useState(() => taipeiDate(new Date()));
  const [collectionActivityId, setCollectionActivityId] = useState("");
  const [collectionGrade, setCollectionGrade] = useState("");
  const [collectionClassSearch, setCollectionClassSearch] = useState("");

  // 資料
  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [activities, setActivities] = useState<ActivityOut[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [summary, setSummary] = useState<OrderSummaryOut | null>(null);
  const [classPayments, setClassPayments] = useState<ClassPaymentReportItemOut[]>([]);
  const [classPaymentsLoading, setClassPaymentsLoading] = useState(true);
  const [classPaymentsError, setClassPaymentsError] = useState("");
  const [quantities, setQuantities] = useState<OrderQuantityRow[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [closeStatus, setCloseStatus] = useState<Record<string, Record<string, CloseStatusItem>>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [paymentBusy, setPaymentBusy] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [selectedReceiptClasses, setSelectedReceiptClasses] = useState<Set<string>>(new Set());
  const requestVersion = useRef(0);
  const classPaymentRequestVersion = useRef(0);
  const closeStatusCache = useRef<ClassStatusCache<Record<string, CloseStatusItem>> | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<OrderListItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelResult, setCancelResult] = useState("");
  const [quantityTarget, setQuantityTarget] = useState<OrderListItem | null>(null);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, number>>({});
  const [quantityBusy, setQuantityBusy] = useState<string | null>(null);
  const [quantityError, setQuantityError] = useState("");
  const [quantityResult, setQuantityResult] = useState("");
  const [reminderBusy, setReminderBusy] = useState<"orders" | "class_reps" | null>(null);
  const [reminderError, setReminderError] = useState("");
  const [reminderStatus, setReminderStatus] = useState("");
  const mutationBusy = paymentBusy !== null || cancelBusy || quantityBusy !== null;
  const canCreateBatchReminders = canViewClassPaymentReport
    && (hasAdminPermission || permissions.has("email:send_bulk"));

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

  const loadClassPayments = useCallback(async () => {
    const version = ++classPaymentRequestVersion.current;
    setClassPaymentsLoading(true);
    setClassPaymentsError("");
    try {
      const rows = await shopApi.classPaymentReport();
      if (version !== classPaymentRequestVersion.current) return;
      setClassPayments(rows);
    } catch (error) {
      if (version !== classPaymentRequestVersion.current) return;
      setClassPaymentsError(apiErrorMessage(error, "無法載入班級收款明細，請重試。"));
    } finally {
      if (version === classPaymentRequestVersion.current) setClassPaymentsLoading(false);
    }
  }, []);

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

  const collectionDateRangeInvalid = Boolean(
    collectionDateFrom && collectionDateTo && collectionDateFrom > collectionDateTo,
  );
  const visibleClassPayments = useMemo(() => {
    const query = collectionClassSearch.trim().toLocaleLowerCase("zh-TW");
    if (collectionDateRangeInvalid) return [];
    return classPayments.filter((payment) => {
      const confirmedDate = taipeiDate(new Date(payment.confirmed_at));
      if (collectionDateFrom && confirmedDate < collectionDateFrom) return false;
      if (collectionDateTo && confirmedDate > collectionDateTo) return false;
      if (collectionActivityId === "__general__" && payment.activity_id !== null) return false;
      if (collectionActivityId && collectionActivityId !== "__general__"
        && payment.activity_id !== collectionActivityId) return false;
      if (collectionGrade && String(payment.grade) !== collectionGrade) return false;
      if (query && !payment.class_label.toLocaleLowerCase("zh-TW").includes(query)) return false;
      return true;
    });
  }, [
    classPayments,
    collectionDateFrom,
    collectionDateTo,
    collectionActivityId,
    collectionGrade,
    collectionClassSearch,
    collectionDateRangeInvalid,
  ]);
  const collectionAmount = visibleClassPayments.reduce((total, payment) => total + payment.amount, 0);
  const collectionClassCount = new Set(visibleClassPayments.map((payment) => payment.class_id)).size;
  const classPaymentByScope = useMemo(() => {
    const paymentsByScope = new Map<string, ClassPaymentReportItemOut>();
    for (const payment of classPayments) {
      if (payment.collection_type === "individual_order") continue;
      paymentsByScope.set(
        `${payment.class_id}:${payment.activity_id ?? "__general__"}`,
        payment,
      );
    }
    return paymentsByScope;
  }, [classPayments]);

  const loadSummary = useCallback(async (options?: LoadSummaryOptions) => {
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

      // 結單狀態只依班級與分類變化；短時間快取，避免切換分頁或篩選時重複查詢。
      if (groupBy === "class" && data.rows.length && catalog.length) {
        const catIds = catalog.map((c) => c.id);
        const catalogKey = catalog
          .map((category) => `${category.id}:${category.activity_id ?? ""}`)
          .sort()
          .join("|");
        const { byClass, classIdsToRefresh } = planClassStatusRefresh(
          closeStatusCache.current,
          catalogKey,
          data.rows.filter((row) => row.key !== "none").map((row) => row.key),
          Date.now(),
          CLOSE_STATUS_CACHE_TTL_MS,
          options,
        );
        const statusMap: Record<string, Record<string, CloseStatusItem>> = Object.fromEntries(
          Object.entries(byClass).map(([key, entry]) => [key, entry.statuses]),
        );
        if (data.rows.some((row) => row.key === "none")) statusMap.none = {};
        const refreshedStatuses = await Promise.all(
          classIdsToRefresh.map(async (classId) => {
            try {
              const res = await shopApi.getCloseStatus(catIds, classId);
              return [classId, res.statuses] as const;
            } catch {
              return [classId, {}] as const;
            }
          }),
        );
        if (version !== requestVersion.current) return;
        const fetchedAt = Date.now();
        for (const [key, statuses] of refreshedStatuses) {
          byClass[key] = { fetchedAt, statuses };
          statusMap[key] = statuses;
        }
        closeStatusCache.current = { catalogKey, byClass };
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

  const createReminderDraft = async (kind: PaymentReminderKind) => {
    if (reminderBusy) return;
    setReminderBusy(kind === "orders" ? "orders" : "class_reps");
    setReminderError("");
    setReminderStatus("");
    try {
      if (isPaid === "true") {
        throw new Error("目前篩選為「班聯已確認」，請切換到未確認款項後再建立提醒。");
      }
      if (statusFilter === "cancelled" || statusFilter === "refunded") {
        throw new Error("取消或退款訂單不適用繳款提醒，請清除訂單狀態篩選。");
      }

      let recipients: EmailRecipientVariableInput[] = [];
      let classesWithoutRepresentatives = 0;

      if (kind === "orders") {
        if (classCollectedFilter === "true") {
          throw new Error("目前篩選只顯示班代已收款訂單，沒有適合寄給訂購人的提醒對象。");
        }
        const params: Record<string, string> = {
          my_only: "false",
          limit: "500",
          is_paid: "false",
        };
        if (grade) params.grade = grade;
        if (classId) params.class_id = classId;
        if (productId) params.product_id = productId;
        if (categoryId) params.category_id = categoryId;
        if (statusFilter === "pending" || statusFilter === "confirmed") params.status = statusFilter;
        if (search.trim()) params.search = search.trim();
        if (dateParams.date_from) params.date_from = dateParams.date_from;
        if (dateParams.date_to) params.date_to = dateParams.date_to;

        const rows: OrderListItem[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = await shopApi.listOrders({ ...params, offset: String(offset) });
          rows.push(...page);
          if (page.length < 500) break;
        }
        const grouped = new Map<string, {
          user_id: string;
          name: string;
          amount: number;
          orderCount: number;
          orderDetails: string[];
        }>();
        for (const order of rows) {
          if (
            order.is_paid
            || order.is_class_collected
            || order.test_product_id
            || order.total_price <= 0
            || (order.status !== "pending" && order.status !== "confirmed")
          ) continue;
          if (classCollectedFilter === "false" && order.is_class_collected) continue;
          const recipient = grouped.get(order.user_id) ?? {
            user_id: order.user_id,
            name: order.user_name ?? "同學",
            amount: 0,
            orderCount: 0,
            orderDetails: [],
          };
          const itemLabel = order.activity_name ?? order.category_name ?? "商品訂單";
          recipient.amount += order.total_price;
          recipient.orderCount += 1;
          recipient.orderDetails.push(
            `${order.serial_number}（${itemLabel}，${money(order.total_price)}）`,
          );
          grouped.set(order.user_id, recipient);
        }
        recipients = Array.from(grouped.values()).map((recipient) => ({
          user_id: recipient.user_id,
          name: recipient.name,
          variables: {
            order_details: recipient.orderDetails.join("；"),
            unpaid_total: money(recipient.amount),
            order_count: String(recipient.orderCount),
          },
        }));
      } else {
        const params: Parameters<typeof shopApi.orderSummary>[0] = {
          group_by: "class",
          is_paid: "false",
          ...dateParams,
        };
        if (grade) params.grade = grade;
        if (classId) params.class_id = classId;
        if (productId) params.product_id = productId;
        if (categoryId) params.category_id = categoryId;
        if (statusFilter === "pending" || statusFilter === "confirmed") params.status = statusFilter;

        const [summaryResult, representativeTargets]: [
          OrderSummaryOut,
          ShopClassRepresentativeRecipientOut[],
        ] = await Promise.all([
          shopApi.orderSummary(params),
          shopApi.classRepresentativeReminderTargets(),
        ]);
        const unpaidClasses = summaryResult.rows.filter(
          (row) => row.key !== "none" && row.unpaid_amount > 0,
        );
        const unpaidByClass = new Map(unpaidClasses.map((row) => [row.key, row]));
        const representedClassIds = new Set<string>();
        const grouped = new Map<string, {
          user_id: string;
          name: string;
          total: number;
          details: string[];
          classIds: Set<string>;
        }>();
        for (const target of representativeTargets) {
          const unpaidClass = unpaidByClass.get(target.class_id);
          if (!unpaidClass) continue;
          representedClassIds.add(target.class_id);
          const recipient = grouped.get(target.user_id) ?? {
            user_id: target.user_id,
            name: target.user_name,
            total: 0,
            details: [],
            classIds: new Set<string>(),
          };
          if (!recipient.classIds.has(target.class_id)) {
            recipient.total += unpaidClass.unpaid_amount;
            recipient.details.push(
              `${unpaidClass.label}：${money(unpaidClass.unpaid_amount)}（${unpaidClass.order_count} 筆）`,
            );
            recipient.classIds.add(target.class_id);
          }
          grouped.set(target.user_id, recipient);
        }
        classesWithoutRepresentatives = unpaidClasses.filter(
          (row) => !representedClassIds.has(row.key),
        ).length;
        recipients = Array.from(grouped.values()).map((recipient) => ({
          user_id: recipient.user_id,
          name: recipient.name,
          variables: {
            class_details: recipient.details.join("；"),
            unpaid_total: money(recipient.total),
            class_count: String(recipient.classIds.size),
          },
        }));
      }

      if (recipients.length === 0) {
        throw new Error(
          kind === "orders"
            ? "目前篩選沒有尚未繳款且未交班代收款的有效訂單。"
            : "目前篩選沒有可提醒的未確認班級與有效班代帳號。",
        );
      }

      const draft = await emailApi.createMessage(buildPaymentReminderDraft(kind, recipients));
      setReminderStatus(
        classesWithoutRepresentatives > 0
          ? `提醒草稿已建立；另有 ${classesWithoutRepresentatives} 個班級沒有有效班代帳號，未列入收件名單。`
          : `提醒草稿已建立，包含 ${recipients.length} 位收件人。請檢查名單與內容後再寄送。`,
      );
      toast.success("提醒草稿已建立，請檢查收件名單與內容後再寄送。");
      router.push(`/email?draft=${encodeURIComponent(draft.id)}`);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : apiErrorMessage(error, "建立提醒草稿失敗，請稍後重試。");
      setReminderError(message);
      toast.error(message);
    } finally {
      setReminderBusy(null);
    }
  };

  const cancelOrder = async () => {
    if (!cancelTarget || cancelBusy) return;
    setCancelBusy(true);
    setCancelError("");
    setCancelResult("");
    try {
      await shopApi.cancelOrder(cancelTarget.id, cancelReason.trim() || undefined);
      setCancelTarget(null);
      setQuantityTarget(null);
      setCancelResult(`訂單 ${cancelTarget.serial_number} 已取消。`);
      await loadOrders();
    } catch (e) {
      setCancelError(apiErrorMessage(e, "取消失敗，請稍後再試。"));
    } finally {
      setCancelBusy(false);
    }
  };

  const toggleQuantityEditor = (order: OrderListItem) => {
    if (quantityTarget?.id === order.id) {
      setQuantityTarget(null);
      setQuantityError("");
      return;
    }
    setQuantityTarget(order);
    setQuantityDrafts(Object.fromEntries((order.items ?? []).map((item) => [item.id, item.quantity])));
    setQuantityError("");
    setQuantityResult("");
  };

  const saveOrderItemQuantity = async (itemId: string) => {
    if (!quantityTarget || quantityBusy) return;
    const quantity = quantityDrafts[itemId];
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100) {
      setQuantityError("數量請輸入 0 至 100 的整數。");
      return;
    }
    setQuantityBusy(itemId);
    setQuantityError("");
    setQuantityResult("");
    try {
      const updated = await shopApi.updateOrderItemQuantity(quantityTarget.id, itemId, quantity);
      if (!updated) throw new Error("訂單數量更新未回傳資料，請重新載入後確認。");
      const updatedTarget = {
        ...quantityTarget,
        items: updated.items,
        subtotal_price: updated.subtotal_price,
        discount_amount: updated.discount_amount,
        total_price: updated.total_price,
      };
      setQuantityTarget(updatedTarget);
      setQuantityDrafts(Object.fromEntries(updated.items.map((item) => [item.id, item.quantity])));
      setOrders((current) => current.map((order) => order.id === updated.id
        ? { ...order, ...updatedTarget }
        : order));
      setQuantityResult(`已更新「${quantityTarget.user_name ?? "訂購人"}」的訂購數量。`);
      await loadOrders();
      await loadQuantities();
      await loadSummary();
      setAnalyticsRefresh((value) => value + 1);
    } catch (error) {
      setQuantityError(apiErrorMessage(error, "數量更新失敗，請檢查庫存與訂單狀態後重試。"));
    } finally {
      setQuantityBusy(null);
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
      await Promise.all([loadSummary({ refreshClassId: row.key }), loadClassPayments()]);
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

  useEffect(() => {
    if (tab !== "summary" || !canViewClassPaymentReport) return;
    void loadClassPayments();
  }, [tab, canViewClassPaymentReport, loadClassPayments]);

  const allProducts = useMemo(() =>
    catalog.flatMap((c) => [
      ...c.products.map((p) => ({ ...p, catId: c.id })),
      ...c.series.flatMap((s) => s.products.map((p) => ({ ...p, catId: c.id }))),
    ]),
    [catalog],
  );
  const visibleOrders = useMemo(
    () => orders.filter((order) => !classCollectedFilter || String(order.is_class_collected) === classCollectedFilter),
    [orders, classCollectedFilter],
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
  const receiptRows = summary?.rows.filter((row) => row.key !== "none") ?? [];
  const allReceiptRowsSelected = receiptRows.length > 0
    && receiptRows.every((row) => selectedReceiptClasses.has(row.key));
  const visibleCategoryIds = new Set(visibleActivityGroups.flatMap((group) => group.categories.map((category) => category.id)));
  const hasFilters = Boolean(grade || classId || categoryId || productId || isPaid || classCollectedFilter || statusFilter || dateFrom || dateTo || (tab === "orders" && search));
  const resetFilters = () => {
    setGrade(""); setClassId(""); setCategoryId(""); setProductId("");
    setIsPaid(""); setClassCollectedFilter(""); setStatusFilter(""); setDateFrom(""); setDateTo(""); setSearch("");
    setReceiptCategoryId("");
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
          <button type="button" onClick={() => { if (tab === "summary") { void loadSummary({ refreshCloseStatus: true }); if (canViewClassPaymentReport) void loadClassPayments(); } else if (tab === "quantities") loadQuantities(); else if (tab === "analytics") setAnalyticsRefresh((value) => value + 1); else loadOrders(); }}
            disabled={(tab !== "analytics" && loading) || mutationBusy} className="btn btn-ghost" aria-label="重新整理">
            <RefreshCw size={15} /> 重新整理
          </button>
        </div>
      </header>

      {canConfirmClassPayment && <ActivityOrderClosure categories={catalog} disabled={mutationBusy || optionsLoading}
        onSaved={() => { closeStatusCache.current = null; setOptionsRetry((value) => value + 1); }} />}

      {canConfirmClassPayment && <AdminAssistedOrder catalog={catalog} classes={classes} optionsError={optionsError} optionsLoading={optionsLoading}
        onRetry={() => setOptionsRetry((value) => value + 1)}
        onCreated={() => { setSupplementRefresh((value) => value + 1); if (tab === "summary") void loadSummary(); else if (tab === "quantities") void loadQuantities(); else if (tab === "orders") void loadOrders(); else setAnalyticsRefresh((value) => value + 1); }} />}
      {canConfirmClassPayment && <SupplementOrders canCollect canRejoin classes={classes} refreshKey={supplementRefresh}
        onCollected={() => { void loadSummary(); void loadClassPayments(); }}
        onRejoined={() => { setSupplementRefresh((value) => value + 1); void loadOrders(); void loadSummary(); }} />}

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
              setReceiptCategoryId(e.target.value);
              setSelectedReceiptClasses(new Set());
            }}>
              <option value="">全部活動</option>
              {catalog.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          {canCreateBatchReminders && (
            <>
              <button
                type="button"
                className="btn btn-ghost min-h-11 px-3 text-sm"
                disabled={mutationBusy || reminderBusy !== null}
                onClick={() => {
                  setTab("summary");
                  setGroupBy("class");
                  setIsPaid("false");
                  setClassCollectedFilter("");
                  setStatusFilter("");
                  setSearch("");
                }}
              >
                查看班聯未確認班級
              </button>
              <button
                type="button"
                className="btn btn-ghost min-h-11 px-3 text-sm"
                disabled={mutationBusy || reminderBusy !== null}
                onClick={() => {
                  setTab("orders");
                  setIsPaid("false");
                  setClassCollectedFilter("false");
                  setStatusFilter("");
                  setSearch("");
                }}
              >
                查看待繳訂購人
              </button>
            </>
          )}
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
          {tab === "orders" && <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>班代代收狀態</span>
            <select className="input" value={classCollectedFilter} onChange={(event) => setClassCollectedFilter(event.target.value)}>
              <option value="">全部</option>
              <option value="false">尚未交班代收款</option>
              <option value="true">班代已收款</option>
            </select>
          </label>}
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

      {reminderError && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{reminderError}</p>}
      {reminderStatus && <p role="status" className="text-sm" style={{ color: "var(--success)" }}>{reminderStatus}</p>}

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
          {canViewClassPaymentReport && (
            <section className="mb-5 space-y-3 rounded-lg p-4"
              aria-labelledby="daily-class-payments-heading"
              style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="daily-class-payments-heading" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                    每日收款
                  </h2>
                  <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                    預設顯示今天；班級依班聯確認時間計算，獨立收款的個人訂單依逐筆確認時間列入。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-ghost min-h-11 px-3 text-sm"
                    onClick={() => {
                      const today = taipeiDate(new Date());
                      setCollectionDateFrom(today);
                      setCollectionDateTo(today);
                    }}>
                    今天
                  </button>
                  <button type="button" className="btn btn-ghost min-h-11 px-3 text-sm"
                    onClick={() => {
                      const today = taipeiDate(new Date());
                      setCollectionDateFrom(today);
                      setCollectionDateTo(today);
                      setCollectionActivityId("");
                      setCollectionGrade("");
                      setCollectionClassSearch("");
                    }}>
                    清除篩選
                  </button>
                  <button type="button" className="btn btn-secondary min-h-11 px-3 text-sm"
                    onClick={() => void loadClassPayments()}
                    disabled={classPaymentsLoading}
                    aria-label="重新載入收款明細">
                    <RefreshCw size={15} /> 更新明細
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-sm">
                  <span style={{ color: "var(--text-muted)" }}>收款日期（起）</span>
                  <input type="date" className="input min-h-11" value={collectionDateFrom}
                    onChange={(event) => setCollectionDateFrom(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span style={{ color: "var(--text-muted)" }}>收款日期（迄）</span>
                  <input type="date" className="input min-h-11" value={collectionDateTo}
                    onChange={(event) => setCollectionDateTo(event.target.value)} />
                </label>
                <label className="grid min-w-48 gap-1 text-sm">
                  <span style={{ color: "var(--text-muted)" }}>收款活動</span>
                  <select className="input min-h-11" value={collectionActivityId}
                    onChange={(event) => setCollectionActivityId(event.target.value)}>
                    <option value="">全部活動</option>
                    {activityGroups.map((group) => (
                      <option key={group.key} value={group.activityId ?? "__general__"}>{group.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid min-w-36 gap-1 text-sm">
                  <span style={{ color: "var(--text-muted)" }}>收款年級</span>
                  <select className="input min-h-11" value={collectionGrade}
                    onChange={(event) => setCollectionGrade(event.target.value)}>
                    <option value="">全部年級</option>
                    {gradeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid min-w-48 flex-1 gap-1 text-sm">
                  <span style={{ color: "var(--text-muted)" }}>搜尋班級</span>
                  <input className="input min-h-11" type="search" value={collectionClassSearch}
                    onChange={(event) => setCollectionClassSearch(event.target.value)}
                    placeholder="輸入班級名稱" />
                </label>
              </div>

              {classPaymentsError && (
                <div className="flex flex-wrap items-center justify-between gap-2" role="alert"
                  style={{ color: "var(--danger)" }}>
                  <span>{classPaymentsError}</span>
                  <button type="button" className="btn btn-ghost min-h-11 px-3"
                    onClick={() => void loadClassPayments()}>重試</button>
                </div>
              )}
              {classPaymentsLoading ? (
                <p role="status" className="py-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                  正在載入收款明細…
                </p>
              ) : classPaymentsError ? null : (
                <>
                  <dl role="group" className="flex flex-wrap gap-x-8 gap-y-2 rounded-md px-3 py-2 text-sm"
                    aria-label="收款統計">
                    <div className="flex items-baseline gap-2">
                      <dt style={{ color: "var(--text-secondary)" }}>收款金額</dt>
                      <dd className="text-lg font-semibold tabular-nums" style={{ color: "var(--primary-text)" }}>
                        {money(collectionAmount)}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt style={{ color: "var(--text-secondary)" }}>收款班級</dt>
                      <dd className="text-lg font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {collectionClassCount} 班
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <dt style={{ color: "var(--text-secondary)" }}>收款項目</dt>
                      <dd className="font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {visibleClassPayments.length} 筆
                      </dd>
                    </div>
                  </dl>
                  {collectionDateRangeInvalid ? (
                    <p role="alert" className="py-4 text-center text-sm" style={{ color: "var(--danger)" }}>
                      起始日期不可晚於結束日期。
                    </p>
                  ) : visibleClassPayments.length === 0 ? (
                    <p role="status" className="py-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                      這個日期與篩選條件沒有收款紀錄；可調整日期或清除篩選。
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-md" style={{ border: "1px solid var(--border)" }}>
                      <table className="shop-mobile-table w-full min-w-[680px] text-sm" aria-label="收款明細">
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            {["收款時間", "班級", "年級", "活動／商品", "訂單數", "收款金額"].map((label) => (
                              <th key={label} scope="col" className="px-3 py-3 text-left text-xs font-semibold"
                                style={{ color: "var(--text-muted)" }}>{label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleClassPayments.map((payment) => (
                            <tr key={`${payment.collection_type}:${payment.record_id}`}
                              style={{ borderBottom: "1px solid var(--border)" }}>
                              <td data-label="收款時間" className="px-3 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                                {taipeiDateTime(payment.confirmed_at)}
                              </td>
                              <td data-label="班級" className="px-3 py-3 font-medium" style={{ color: "var(--text-primary)" }}>
                                {payment.collection_type === "individual_order"
                                  ? `${payment.class_label}（個人訂單）`
                                  : payment.class_label}
                              </td>
                              <td data-label="年級" className="px-3 py-3" style={{ color: "var(--text-secondary)" }}>
                                {payment.grade} 年級
                              </td>
                              <td data-label="活動／商品" className="px-3 py-3" style={{ color: "var(--text-secondary)" }}>
                                {payment.activity_label}
                              </td>
                              <td data-label="訂單數" className="px-3 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                                {payment.order_count}
                              </td>
                              <td data-label="收款金額" className="px-3 py-3 font-semibold tabular-nums" style={{ color: "var(--success)" }}>
                                {money(payment.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
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

          {canCreateBatchReminders && (
            <div className="mb-4 flex flex-col gap-3 rounded-lg p-4 sm:flex-row sm:items-center sm:justify-between"
              style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <div>
                <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>班代繳款提醒</h2>
                <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
                  依目前篩選建立個人化草稿；金額代表班聯尚未確認的款項，寄出前可檢查收件班級與內容。
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary min-h-11 whitespace-nowrap"
                disabled={loading || mutationBusy || reminderBusy !== null}
                onClick={() => void createReminderDraft("class_representatives")}
              >
                <Mail size={16} aria-hidden="true" />
                {reminderBusy === "class_reps" ? "整理班級名單中…" : "建立班代提醒草稿"}
              </button>
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
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>收款單據</p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  可勾選班級列印；全部未繳款列印包含班級、個人訂購與獨立補收款。增量列印會重印有變更的整班收據，個人訂單則各印一張。列印不會登記繳費。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="grid gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  收據範圍
                  <select
                    className="input min-h-11"
                    aria-label="收據主題"
                    value={receiptCategoryId}
                    onChange={(event) => {
                      setReceiptCategoryId(event.target.value);
                      setSelectedReceiptClasses(new Set());
                    }}
                  >
                    <option value="">請選擇商品主題</option>
                    {catalog.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  已選 {selectedReceiptClasses.size} 班
                </span>
                <AnimatedDownloadButton
                  request={() => {
                    setReceiptError("");
                    return shopApi.downloadClassReceipts(
                      { category_id: receiptCategoryId }, [...selectedReceiptClasses]
                    );
                  }}
                  label={`下載所選 ${selectedReceiptClasses.size} 班 PDF`}
                  disabled={mutationBusy || loading || !receiptCategoryId || selectedReceiptClasses.size === 0}
                  className="btn btn-secondary min-h-11 px-3 text-xs disabled:opacity-50"
                  onError={(error) => setReceiptError(apiErrorMessage(error, "簽收單下載失敗，請重試。"))}
                />
                <AnimatedDownloadButton
                  request={() => {
                    setReceiptError("");
                    return shopApi.downloadClassReceipts({ category_id: receiptCategoryId }, undefined, true);
                  }}
                  label="列印所有未繳款班級／個人收據"
                  disabled={mutationBusy || loading || !receiptCategoryId}
                  className="btn btn-ghost min-h-11 px-3 text-xs disabled:opacity-50"
                  onError={(error) => setReceiptError(apiErrorMessage(error, "簽收單下載失敗，請重試。"))}
                />
                <AnimatedDownloadButton
                  request={() => {
                    setReceiptError("");
                    return shopApi.downloadChangedOrderReceipts({ category_id: receiptCategoryId });
                  }}
                  label="列印上次列印後有變更的班級／個人訂單"
                  disabled={mutationBusy || loading || !receiptCategoryId}
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
                <table className="shop-mobile-table w-full min-w-[720px] text-sm" aria-label="班級訂購與收款彙總">
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
                              const paymentRecord = classPaymentByScope.get(
                                `${row.key}:${group.activityId ?? "__general__"}`,
                              );
                              return (
                                <div key={group.key} className="flex flex-wrap items-center gap-1 border-t pt-1.5 first:border-t-0 first:pt-0"
                                  style={{ borderColor: "var(--border)" }}>
                                  <span className="w-full text-[11px]" style={{ color: "var(--text-muted)" }}>{group.label}</span>
                                  {row.key !== "none" && <>
                                    {classPaymentsLoading ? (
                                      <span role="status" className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                        載入收款狀態…
                                      </span>
                                    ) : classPaymentsError ? (
                                      <span className="text-xs" style={{ color: "var(--danger)" }}>
                                        收款狀態無法確認
                                      </span>
                                    ) : paymentRecord ? (
                                      <span role="status" className="text-xs font-medium" style={{ color: "var(--success)" }}>
                                        已確認收款
                                      </span>
                                    ) : <button type="button" disabled={mutationBusy}
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
          {quantityResult && <p role="status" className="mb-3 text-sm">{quantityResult}</p>}
          {canCreateBatchReminders && (
            <div className="mb-3 flex flex-col gap-3 rounded-lg p-4 sm:flex-row sm:items-center sm:justify-between"
              style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <div>
                <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>訂購人繳款提醒</h2>
                <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
                  只整理有效、尚未繳款且未交班代收款的訂單；同一位同學的多筆訂單會合併成一封草稿。
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary min-h-11 whitespace-nowrap"
                disabled={loading || mutationBusy || reminderBusy !== null}
                onClick={() => void createReminderDraft("orders")}
              >
                <Mail size={16} aria-hidden="true" />
                {reminderBusy === "orders" ? "整理訂單名單中…" : "建立訂購人提醒草稿"}
              </button>
            </div>
          )}
          {(
            <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              {loading ? (
                <div role="status" className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
              ) : !visibleOrders.length ? (
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
                      {visibleOrders.map((order, idx) => (
                        <Fragment key={order.id}>
                          <tr style={idx < visibleOrders.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
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
                              <div className="flex flex-wrap items-center gap-2">
                                <SeparateOrderButton order={order} onSeparated={() => { setSupplementRefresh((value) => value + 1); void loadOrders(); void loadSummary(); }} />
                                {(order.status === "pending" || order.status === "confirmed") && !order.is_paid && !order.is_class_collected && (order.items?.length ?? 0) > 0 && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost min-h-11 whitespace-nowrap"
                                    aria-expanded={quantityTarget?.id === order.id}
                                    aria-controls={quantityTarget?.id === order.id ? `quantity-editor-${order.id}` : undefined}
                                    disabled={mutationBusy}
                                    onClick={() => toggleQuantityEditor(order)}
                                  >{quantityTarget?.id === order.id ? "收起調整" : "調整數量"}</button>
                                )}
                                {(order.status === "pending" || order.status === "confirmed") && (
                                  order.is_paid || order.is_class_collected
                                    ? <span className="text-xs" style={{ color: "var(--text-secondary)" }}>已收款，請先撤銷收款再調整或取消</span>
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
                              </div>
                            </td>}
                          </tr>
                          {quantityTarget?.id === order.id && (
                            <tr id={`quantity-editor-${order.id}`} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td colSpan={canConfirmClassPayment ? 8 : 7} className="px-4 py-4" style={{ background: "var(--bg-elevated)" }}>
                                <fieldset className="space-y-3">
                                  <legend className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                                    調整 {order.user_name ?? "訂購人"} 的訂購數量
                                  </legend>
                                  {(quantityTarget.items ?? []).map((item) => {
                                    const quantity = quantityDrafts[item.id] ?? item.quantity;
                                    const canRemove = (quantityTarget.items?.length ?? 0) > 1;
                                    return (
                                      <div key={item.id} className="flex flex-col gap-3 rounded-md p-3 sm:flex-row sm:items-center sm:justify-between" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
                                        <div className="min-w-0">
                                          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.product_name ?? "商品"}</p>
                                          {item.selected_options.length > 0 && (
                                            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                                              {item.selected_options.map((option) => `${option.group_name}：${option.value}`).join("、")}
                                            </p>
                                          )}
                                          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                                            原訂單單價 {money(item.unit_price)} · 目前 {item.quantity} 件
                                          </p>
                                        </div>
                                        <div className="flex items-end gap-2">
                                          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                            訂購數量
                                            <NumberInput
                                              className="input mt-1 block min-h-11 w-24"
                                              min={canRemove ? 0 : 1}
                                              max={100}
                                              value={quantity}
                                              disabled={mutationBusy}
                                              onChange={(event) => setQuantityDrafts((drafts) => ({ ...drafts, [item.id]: Number(event.target.value) }))}
                                            />
                                          </label>
                                          <button
                                            type="button"
                                            className="btn btn-primary min-h-11 whitespace-nowrap"
                                            disabled={mutationBusy || quantity === item.quantity || !Number.isInteger(quantity)}
                                            onClick={() => void saveOrderItemQuantity(item.id)}
                                          >{quantityBusy === item.id ? "更新中…" : quantity === 0 ? "移除品項" : "更新數量"}</button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                    修改會沿用原訂單單價並更新庫存與應收款；數量設為 0 可移除品項。已收款訂單需先撤銷收款。
                                  </p>
                                  {quantityError && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{quantityError}</p>}
                                </fieldset>
                              </td>
                            </tr>
                          )}
                        </Fragment>
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
