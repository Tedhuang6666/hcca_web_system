"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckSquare, Edit2, Lock, LockOpen, Plus, RefreshCw, Search, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { OrderStatusBadge } from "@/components/ui/StatusBadge";
import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { mergeDraftItems } from "@/lib/shop-order-items";
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

type CatalogChoice = CatalogProductOut & {
  activity_id: string | null;
  category: string;
  series: string;
  categoryId: string;
};
type ClassOrderQuery = NonNullable<Parameters<typeof shopApi.listClassOrders>[0]>;
type AssistedItemDraft = {
  id: string;
  product_id: string;
  product_name: string;
  activity_id: string | null;
  quantity: number;
  option_ids: string[];
  option_label: string;
  unit_price: number;
};

type AssistedOrderDraft = {
  id: string;
  student_id: string;
  student_name: string;
  items: AssistedItemDraft[];
  notes: string;
};

type ActivityCollectionRow = {
  activity_id: string | null;
  label: string;
  order_count: number;
  total_amount: number;
  collected_amount: number;
  outstanding_amount: number;
  council_amount: number;
};

const CLASS_ORDER_PAGE_SIZE = 500;
const ORDER_LIST_PAGE_SIZE = 50;

const emptySummary: ShopClassSummaryOut = {
  class_count: 0, order_count: 0, item_count: 0, total_amount: 0,
  paid_amount: 0, unpaid_amount: 0, paid_order_count: 0, unpaid_order_count: 0,
  assisted_order_count: 0, product_rows: [],
};

function money(value: number) {
  return `NT$${value.toLocaleString("zh-TW")}`;
}

function isCollectableOrder(order: Pick<OrderListItem, "status">) {
  return order.status !== "cancelled" && order.status !== "refunded";
}

function scrollToSection(id: string) {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior, block: "start" }));
}

function flattenCatalog(catalog: CatalogCategoryOut[]): CatalogChoice[] {
  return catalog.flatMap((cat) => [
    ...cat.products.map((product) => ({
      ...product, activity_id: cat.activity_id ?? null,
      category: cat.name, series: "單一商品", categoryId: cat.id,
    })),
    ...cat.series.flatMap((series) =>
      series.products.map((product) => ({
        ...product, activity_id: cat.activity_id ?? null,
        category: cat.name, series: series.name, categoryId: cat.id,
      })),
    ),
  ]);
}

async function listAllClassOrders(params: ClassOrderQuery = {}): Promise<OrderListItem[]> {
  const orders: OrderListItem[] = [];
  let offset = 0;

  while (true) {
    const page = await shopApi.listClassOrders({
      ...params,
      limit: String(CLASS_ORDER_PAGE_SIZE),
      offset: String(offset),
    });
    orders.push(...page);
    if (page.length < CLASS_ORDER_PAGE_SIZE) return orders;
    offset += CLASS_ORDER_PAGE_SIZE;
  }
}

export default function ClassOrdersPage() {
  const [workspace, setWorkspace] = useState<"order" | "collect" | "details">("order");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
  const [seatFilter, setSeatFilter] = useState<"all" | "unpaid" | "paid">("all");
  const [seatSearch, setSeatSearch] = useState("");
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [activityOrders, setActivityOrders] = useState<OrderListItem[]>([]);
  const [productSummary, setProductSummary] = useState<ShopClassSummaryOut>(emptySummary);
  const [members, setMembers] = useState<ClassMemberOut[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersLoadFailed, setMembersLoadFailed] = useState(false);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
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
  const [activityFilter, setActivityFilter] = useState("all");
  const [ledgerActivityKey, setLedgerActivityKey] = useState("");
  const [composerActivityKey, setComposerActivityKey] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [orderPage, setOrderPage] = useState(0);
  const [formOpen, setFormOpen] = useState(true);
  const [assistedItems, setAssistedItems] = useState<AssistedItemDraft[]>([]);
  const [assistedOrderDrafts, setAssistedOrderDrafts] = useState<AssistedOrderDraft[]>([]);

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
  const formProducts = useMemo(
    () => activeProducts.filter((product) =>
      editOrder
        ? product.activity_id === (editOrder.activity_id ?? null)
        : composerActivityKey === null || (product.activity_id ?? "none") === composerActivityKey),
    [activeProducts, editOrder, composerActivityKey],
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

  const activityLabels = useMemo(() => {
    const namesById = new Map<string, Set<string>>();
    for (const category of catalog) {
      if (!category.activity_id) continue;
      const names = namesById.get(category.activity_id) ?? new Set<string>();
      names.add(category.activity_name ?? category.name);
      namesById.set(category.activity_id, names);
    }
    return new Map(
      Array.from(namesById, ([id, names]) => [id, Array.from(names).join("／")]),
    );
  }, [catalog]);

  const activityLabel = useCallback((activityId: string | null | undefined) => {
    if (!activityId) return "一般商品";
    return activityLabels.get(activityId) ?? `已結束活動 · ${activityId.slice(0, 6)}`;
  }, [activityLabels]);

  const closeActivityGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      label: string;
      categories: CatalogCategoryOut[];
    }>();
    for (const category of catalog) {
      const key = category.activity_id ?? "none";
      const group = groups.get(key) ?? {
        key,
        label: activityLabel(category.activity_id),
        categories: [],
      };
      group.categories.push(category);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [catalog, activityLabel]);

  const activityRows = useMemo(() => {
    const rows = new Map<string, ActivityCollectionRow>();
    for (const category of catalog) {
      const key = category.activity_id ?? "none";
      if (!rows.has(key)) rows.set(key, {
        activity_id: category.activity_id ?? null,
        label: category.activity_name ?? (category.activity_id ? category.name : "一般商品"),
        order_count: 0, total_amount: 0, collected_amount: 0, outstanding_amount: 0,
        council_amount: 0,
      });
    }
    for (const order of activityOrders) {
      if (!isCollectableOrder(order)) continue;
      const key = order.activity_id ?? "none";
      const row = rows.get(key) ?? {
        activity_id: order.activity_id ?? null,
        label: activityLabel(order.activity_id),
        order_count: 0,
        total_amount: 0,
        collected_amount: 0,
        outstanding_amount: 0,
        council_amount: 0,
      };
      row.label = order.activity_name ?? row.label;
      row.order_count += 1;
      row.total_amount += order.total_price;
      if (order.is_class_collected) row.collected_amount += order.total_price;
      else row.outstanding_amount += order.total_price;
      if (order.is_paid) row.council_amount += order.total_price;
      rows.set(key, row);
    }
    return Array.from(rows.values()).sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
  }, [activityOrders, activityLabel, catalog]);

  const activityTotals = useMemo(() => activityRows.reduce((total, row) => ({
    order_count: total.order_count + row.order_count,
    total_amount: total.total_amount + row.total_amount,
    collected_amount: total.collected_amount + row.collected_amount,
    outstanding_amount: total.outstanding_amount + row.outstanding_amount,
    council_amount: total.council_amount + row.council_amount,
  }), { order_count: 0, total_amount: 0, collected_amount: 0, outstanding_amount: 0, council_amount: 0 }), [activityRows]);

  const activeLedgerKey = activityRows.some((row) => (row.activity_id ?? "none") === ledgerActivityKey)
    ? ledgerActivityKey : (activityRows[0]?.activity_id ?? "none");
  const ledgerActivity = activityRows.find((row) => (row.activity_id ?? "none") === activeLedgerKey);
  const seatRows = useMemo(() => {
    const ordersByMember = new Map<string, OrderListItem[]>();
    for (const order of activityOrders) {
      if ((order.activity_id ?? "none") !== activeLedgerKey || !isCollectableOrder(order)) continue;
      const memberOrders = ordersByMember.get(order.user_id) ?? [];
      memberOrders.push(order);
      ordersByMember.set(order.user_id, memberOrders);
    }
    const rows = members.map((member) => {
      const memberOrders = ordersByMember.get(member.id) ?? [];
      ordersByMember.delete(member.id);
      return {
        id: member.id, name: member.display_name, seat: member.seat_number,
        orders: memberOrders,
        amount: memberOrders.reduce((sum, order) => sum + order.total_price, 0),
        collected: memberOrders.reduce((sum, order) => sum + (order.is_class_collected ? order.total_price : 0), 0),
        councilPaid: memberOrders.reduce((sum, order) => sum + (order.is_paid ? order.total_price : 0), 0),
      };
    });
    for (const [id, memberOrders] of ordersByMember) {
      rows.push({
        id, name: memberOrders[0].user_name ?? "未列入名冊的訂購人", seat: null,
        orders: memberOrders,
        amount: memberOrders.reduce((sum, order) => sum + order.total_price, 0),
        collected: memberOrders.reduce((sum, order) => sum + (order.is_class_collected ? order.total_price : 0), 0),
        councilPaid: memberOrders.reduce((sum, order) => sum + (order.is_paid ? order.total_price : 0), 0),
      });
    }
    return rows.sort((a, b) => (a.seat ?? 1000) - (b.seat ?? 1000)
      || a.name.localeCompare(b.name, "zh-Hant"));
  }, [activityOrders, activeLedgerKey, members]);

  const filteredSeatRows = seatRows.filter((row) =>
    `${row.seat ?? ""} ${row.name}`.includes(seatSearch.trim())
    && (seatFilter === "all" || (seatFilter === "unpaid"
      ? row.amount > row.collected : row.orders.length > 0 && row.amount === row.collected)),
  );

  const selectedActivityLabel = activityFilter === "all"
    ? "全部活動"
    : activityFilter === "none"
      ? "一般商品"
      : activityRows.find((row) => row.activity_id === activityFilter)?.label
        ?? `已結束活動 · ${activityFilter.slice(0, 6)}`;

  const currentOptionIds = productDetail?.variant_groups
    .map((group) => optionIds[group.id])
    .filter((optionId): optionId is string => Boolean(optionId)) ?? [];
  const currentItemReady = Boolean(
    orderProductId && productDetail?.id === orderProductId && currentOptionIds.length === productDetail.variant_groups.length,
  );
  const currentUnitPrice = (productDetail?.price ?? 0) + (productDetail?.variant_groups ?? [])
    .reduce((total, group) => {
      const option = group.options.find((item) => item.id === optionIds[group.id]);
      return total + (option?.price_delta ?? 0);
    }, 0);
  const assistedTotal = assistedItems.reduce((total, item) => total + item.quantity * item.unit_price, 0)
    + (currentItemReady && orderProductId ? quantity * currentUnitPrice : 0);
  const currentDraftItemCount = assistedItems.length + (currentItemReady ? 1 : 0);
  const recipientIds = editOrder ? [studentId].filter(Boolean) : studentIds;
  const pendingDraftStudentCount = new Set([
    ...assistedOrderDrafts.map((draft) => draft.student_id),
    ...(currentDraftItemCount > 0 ? recipientIds : []),
  ]).size;
  const pendingDraftSubtotal = assistedOrderDrafts.reduce((total, draft) => total
    + draft.items.reduce((amount, item) => amount + item.quantity * item.unit_price, 0), 0)
    + assistedTotal * recipientIds.length;
  const hasCurrentComposerInput = Boolean(studentId || studentIds.length || notes.trim() || assistedItems.length > 0 || orderProductId);
  const hasIncompleteCurrentItem = Boolean(orderProductId && !currentItemReady);
  const canQueueCurrentDraft = Boolean(
    !editOrder && recipientIds.length && currentDraftItemCount > 0 && !hasIncompleteCurrentItem,
  );
  const assistedOrderDraftRows = useMemo(() => assistedOrderDrafts.map((draft) => {
    const activityTotals = new Map<string, { activity_id: string | null; label: string; amount: number }>();
    for (const item of draft.items) {
      const key = item.activity_id ?? "none";
      const row = activityTotals.get(key) ?? {
        activity_id: item.activity_id,
        label: activityLabel(item.activity_id),
        amount: 0,
      };
      row.amount += item.quantity * item.unit_price;
      activityTotals.set(key, row);
    }
    return {
      ...draft,
      subtotal: draft.items.reduce((total, item) => total + item.quantity * item.unit_price, 0),
      activity_totals: [...activityTotals.values()],
    };
  }), [assistedOrderDrafts, activityLabel]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const params: ClassOrderQuery = {};
    if (paidFilter !== "all") params.is_class_collected = paidFilter === "paid" ? "true" : "false";
    if (assistedFilter === "assisted") params.assisted_only = "true";
    if (productFilter) params.product_id = productFilter;
    if (memberFilter) params.member_user_id = memberFilter;
    const hasFilters = paidFilter !== "all"
      || assistedFilter !== "all"
      || productFilter !== ""
      || memberFilter !== "";
    const filteredOrdersPromise = listAllClassOrders(params);
    const activityOrdersPromise = hasFilters
      ? listAllClassOrders()
      : filteredOrdersPromise;
    try {
      const [orderItems, activityItems, productStatus] = await Promise.all([
        filteredOrdersPromise,
        activityOrdersPromise,
        shopApi.classSummary(),
      ]);
      setOrders(orderItems);
      setActivityOrders(activityItems);
      setProductSummary(productStatus);
      setSelectedIds((cur) => cur.filter((id) => orderItems.some((order) =>
        order.id === id && isCollectableOrder(order))));
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
    setMembersLoading(true);
    setMembersLoadFailed(false);
    shopApi.catalog()
      .then((cats) => { setCatalog(cats); return cats; })
      .catch(() => { setCatalogFailed(true); setCatalog([]); return []; });
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
    let active = true;
    setProductDetail(null);
    if (!orderProductId) {
      setOptionIds({});
      return;
    }
    shopApi.getProduct(orderProductId)
      .then((product) => {
        if (!active) return;
        setProductDetail(product);
        const existingItem = editOrder?.items.find((item) => item.product_id === orderProductId);
        const editedOptions = Object.fromEntries(
          (existingItem?.selected_options ?? []).map((option) => [option.group_id, option.option_id]),
        );
        const defaults = Object.fromEntries(product.variant_groups.map((group) => {
          const activeOptions = group.options.filter((option) => option.is_active);
          return [group.id, activeOptions.length === 1 ? activeOptions[0].id : ""];
        }));
        setOptionIds(existingItem ? editedOptions : defaults);
      })
      .catch((e) => { if (active) toast.error(apiErrorMessage(e, "商品載入失敗")); });
    return () => { active = false; };
  }, [editOrder, orderProductId]);

  const openCreate = () => {
    setWorkspace("order");
    if (formOpen && (editOrder || hasCurrentComposerInput)) {
      scrollToSection("class-order-form");
      return;
    }
    setFormOpen(true);
    setEditOrder(null);
    setComposerActivityKey(null);
    setStudentId("");
    setOrderProductId("");
    setQuantity(1);
    setOptionIds({});
    setNotes("");
    setAssistedItems([]);
  };

  const openCreateForSeat = (memberId: string) => {
    if (hasCurrentComposerInput || editOrder || assistedOrderDrafts.length > 0) {
      setWorkspace("order");
      toast.info("請先完成目前的代訂，再切換同學");
      scrollToSection("class-order-form");
      return;
    }
    openCreate();
    setStudentId(memberId);
    setStudentIds([memberId]);
    setComposerActivityKey(activeLedgerKey);
  };

  const openEdit = async (order: OrderListItem) => {
    if (hasCurrentComposerInput) {
      setWorkspace("order");
      toast.info("請先把目前填寫的商品加入清單，再修改既有訂單");
      scrollToSection("class-order-form");
      return;
    }
    setWorkspace("order");
    setFormOpen(true);
    setComposerActivityKey(null);
    setEditOrder(null);
    setOrderProductId("");
    setQuantity(1);
    setOptionIds({});
    setAssistedItems([]);
    try {
      const full = await shopApi.getOrder(order.id);
      setEditOrder(full);
      setStudentId(full.user_id);
      setNotes(full.notes ?? "");
      setAssistedItems(full.items.slice(1).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name ?? "未命名商品",
        activity_id: full.activity_id ?? null,
        quantity: item.quantity,
        option_ids: (item.selected_options ?? []).map((option) => option.option_id),
        option_label: (item.selected_options ?? []).map((option) => `${option.group_name}：${option.value}`).join(" · "),
        unit_price: item.unit_price,
      })));
      const firstItem = full.items?.[0];
      if (firstItem) {
        setOrderProductId(firstItem.product_id);
        setQuantity(firstItem.quantity);
        const opts: Record<string, string> = {};
        for (const opt of firstItem.selected_options ?? []) {
          if (opt.group_id) opts[opt.group_id] = opt.option_id;
        }
        setOptionIds(opts);
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入訂單失敗"));
    }
  };

  const addCurrentProduct = () => {
    if (!orderProductId || !productDetail) {
      toast.error("請先選擇商品，並等商品資料載入完成");
      return;
    }
    if (!currentItemReady) {
      toast.error("請完成所有商品規格");
      return;
    }
    const optionLabel = productDetail.variant_groups.map((group) => {
      const option = group.options.find((item) => item.id === optionIds[group.id]);
      return option ? `${group.name} ${option.value}` : "";
    }).filter(Boolean).join(" · ");
    const activityId = editOrder?.activity_id
      ?? catalogProducts.find((product) => product.id === productDetail.id)?.activity_id
      ?? null;
    const nextItems = mergeDraftItems([...assistedItems, {
      id: `${productDetail.id}-${Date.now()}-${Math.random()}`,
      product_id: productDetail.id,
      product_name: productDetail.name,
      activity_id: activityId,
      quantity,
      option_ids: currentOptionIds,
      option_label: optionLabel,
      unit_price: currentUnitPrice,
    }]);
    if (nextItems.some((item) => item.quantity > 100)) {
      toast.error("同一商品規格每次最多登記 100 件，請調整數量");
      return;
    }
    setAssistedItems(nextItems);
    setOrderProductId("");
    setQuantity(1);
    setOptionIds({});
  };

  const currentComposerItems = () => {
    const items = [...assistedItems];
    if (orderProductId && productDetail && currentItemReady) {
      items.push({
        id: `${productDetail.id}-${Date.now()}-${Math.random()}`,
        product_id: productDetail.id,
        product_name: productDetail.name,
        activity_id: editOrder?.activity_id
          ?? catalogProducts.find((product) => product.id === productDetail.id)?.activity_id
          ?? null,
        quantity,
        option_ids: currentOptionIds,
        option_label: productDetail.variant_groups.map((group) => {
          const option = group.options.find((item) => item.id === optionIds[group.id]);
          return option ? `${group.name} ${option.value}` : "";
        }).filter(Boolean).join(" · "),
        unit_price: currentUnitPrice,
      });
    }
    return mergeDraftItems(items);
  };

  const updateComposerItem = (item: AssistedItemDraft, nextQuantity: number) => {
    const key = (entry: AssistedItemDraft) => JSON.stringify([entry.product_id, [...entry.option_ids].sort(), entry.unit_price]);
    const items = currentComposerItems().filter((entry) => key(entry) !== key(item));
    setAssistedItems(nextQuantity ? [...items, { ...item, quantity: nextQuantity }] : items);
    setOrderProductId("");
    setOptionIds({});
    setQuantity(1);
  };

  const buildDrafts = (items: AssistedItemDraft[]) => {
    const drafts = assistedOrderDrafts.map((draft) => ({ ...draft, items: [...draft.items] }));
    for (const id of recipientIds) {
      const existing = drafts.find((draft) => draft.student_id === id);
      if (existing) {
        existing.items = mergeDraftItems([...existing.items, ...items]);
        if (notes.trim()) existing.notes = notes.trim();
      } else {
        drafts.push({
          id: `draft-${id}`,
          student_id: id,
          student_name: members.find((member) => member.id === id)?.display_name ?? "同學",
          items: items.map((item) => ({ ...item, id: `${id}:${item.id}` })),
          notes: notes.trim(),
        });
      }
    }
    return drafts;
  };

  const queueCurrentDraft = () => {
    if (!recipientIds.length) { toast.error("請先勾選同班學生"); return; }
    if (hasIncompleteCurrentItem) { toast.error("請先完成商品規格"); return; }
    const items = currentComposerItems();
    if (!items.length) { toast.error("請先加入至少一項商品"); return; }
    const drafts = buildDrafts(items);
    if (drafts.some((draft) => draft.items.some((item) => item.quantity > 100))) {
      toast.error("同一位同學的同一商品規格每次最多 100 件");
      return;
    }
    setAssistedOrderDrafts(drafts);
    setStudentIds([]);
    setStudentId("");
    setOrderProductId("");
    setQuantity(1);
    setOptionIds({});
    setNotes("");
    setAssistedItems([]);
    toast.success(`已加入 ${recipientIds.length} 位同學的待送出清單`);
  };

  const loadAssistedDraft = (draft: AssistedOrderDraft) => {
    if (hasCurrentComposerInput) {
      toast.info("請先把目前填寫的商品加入清單，再載入其他同學");
      return;
    }
    setAssistedOrderDrafts((drafts) => drafts.filter((item) => item.id !== draft.id));
    setEditOrder(null);
    setStudentId(draft.student_id);
    setStudentIds([draft.student_id]);
    setOrderProductId("");
    setQuantity(1);
    setOptionIds({});
    setNotes(draft.notes);
    setAssistedItems(draft.items);
    setFormOpen(true);
  };

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((o) =>
      (activityFilter === "all"
        || (activityFilter === "none" ? !o.activity_id : o.activity_id === activityFilter))
      && (!needle
        || o.serial_number.toLowerCase().includes(needle)
        || (o.user_name ?? "").toLowerCase().includes(needle)
        || (o.class_label ?? "").toLowerCase().includes(needle)),
    );
  }, [activityFilter, orders, query]);

  const selectedSet = new Set(selectedIds);
  const selectedOrders = visibleOrders.filter((order) =>
    selectedSet.has(order.id) && isCollectableOrder(order));
  const selectedActivityGroups = new Map<string, { label: string; orders: OrderListItem[] }>();
  for (const order of selectedOrders) {
    const key = order.activity_id ?? "none";
    const group = selectedActivityGroups.get(key) ?? {
      label: activityLabel(order.activity_id),
      orders: [],
    };
    group.orders.push(order);
    selectedActivityGroups.set(key, group);
  }
  const pageCount = Math.max(1, Math.ceil(visibleOrders.length / ORDER_LIST_PAGE_SIZE));
  const currentPage = Math.min(orderPage, pageCount - 1);
  const pageOrders = visibleOrders.slice(currentPage * ORDER_LIST_PAGE_SIZE, (currentPage + 1) * ORDER_LIST_PAGE_SIZE);
  const selectablePageOrders = pageOrders.filter(isCollectableOrder);
  const allVisibleSelected = selectablePageOrders.length > 0
    && selectablePageOrders.every((order) => selectedSet.has(order.id));

  useEffect(() => {
    setOrderPage(0);
    setSelectedIds([]);
  }, [activityFilter, assistedFilter, memberFilter, paidFilter, productFilter, query]);

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

  const setSeatCollected = async (memberId: string, collected: boolean) => {
    const row = seatRows.find((item) => item.id === memberId);
    const targets = row?.orders.filter((order) => order.is_class_collected !== collected) ?? [];
    if (!targets.length) return;
    setBusy(`seat:${memberId}`);
    try {
      const results = await Promise.allSettled(targets.map((order) => shopApi.setClassCollected(order.id, collected)));
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length) {
        toast.error(`已更新 ${targets.length - failed.length} 筆，${failed.length} 筆未完成。請確認更新後的狀態再試。`);
        return;
      }
      toast.success(`${row?.name ?? "同學"}的 ${targets.length} 筆${ledgerActivity?.label ?? "活動"}訂單已${collected ? "記錄收款" : "撤銷收款"}`);
    } catch (error) {
      toast.error(apiErrorMessage(error, "收款狀態更新失敗"));
    } finally {
      await load();
      setBusy(null);
    }
  };

  const batchSetPaid = async (activityKey: string, isPaid: boolean) => {
    const targets = (selectedActivityGroups.get(activityKey)?.orders ?? [])
      .filter((o) => o.is_class_collected !== isPaid);
    if (!targets.length) { toast.info(isPaid ? "選取訂單都已繳費" : "選取訂單都是未繳費"); return; }
    setBatchBusy(true);
    try {
      const results = await Promise.allSettled(targets.map((o) => shopApi.setClassCollected(o.id, isPaid)));
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length) {
        toast.error(`已更新 ${targets.length - failed.length} 筆，${failed.length} 筆未完成。請確認更新後的狀態再試。`);
        return;
      }
      setSelectedIds([]);
      toast.success(isPaid ? `已標記 ${targets.length} 筆已收款` : `已撤銷 ${targets.length} 筆收款紀錄`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "批量更新失敗"));
    } finally {
      await load();
      setBatchBusy(false);
    }
  };

  const submitOrder = async () => {
    if (orderProductId && !productDetail) {
      toast.error("商品資料尚未載入完成，請稍候再試");
      return;
    }
    if (orderProductId && !currentItemReady) {
      toast.error("請完成所有商品規格");
      return;
    }
    const currentItems = currentComposerItems();
    if (currentItems.length > 0 && !recipientIds.length) {
      toast.error("請先勾選同班學生");
      return;
    }
    if (editOrder && !studentId) { toast.error("找不到訂單的學生資料"); return; }
    if (editOrder && currentItems.length === 0) { toast.error("請至少保留一項商品"); return; }

    const draftsToSubmit = editOrder
      ? []
      : currentItems.length ? buildDrafts(currentItems) : assistedOrderDrafts;
    if (currentItems.some((item) => item.quantity > 100)
      || draftsToSubmit.some((draft) => draft.items.some((item) => item.quantity > 100))) {
      toast.error("同一位同學的同一商品規格每次最多 100 件");
      return;
    }
    if (!editOrder && draftsToSubmit.length === 0) {
      toast.error("請先加入至少一位同學的商品登記");
      return;
    }
    const updateItems = currentItems.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      option_ids: item.option_ids,
    }));

    setCreating(true);
    setSubmitMessage("");
    try {
      if (editOrder) {
        await shopApi.updateOrder(editOrder.id, {
          user_id: studentId,
          items: updateItems,
          notes: notes.trim() || null,
        });
        toast.success("訂單已修改");
      } else {
        const completedStudentIds = new Set<string>();
        let failedRequest: unknown = null;
        for (const draft of draftsToSubmit) {
          try {
            await shopApi.createClassOrder({
              user_id: draft.student_id,
              items: draft.items.map((item) => ({
                product_id: item.product_id,
                quantity: item.quantity,
                option_ids: item.option_ids,
              })),
              notes: draft.notes || null,
            });
            completedStudentIds.add(draft.student_id);
          } catch (error) {
            failedRequest = error;
            break;
          }
        }

        if (failedRequest) {
          const remainingDrafts = draftsToSubmit.filter((draft) => !completedStudentIds.has(draft.student_id));
          setAssistedOrderDrafts(remainingDrafts);
          setEditOrder(null);
          setStudentId("");
          setStudentIds([]);
          setOrderProductId("");
          setQuantity(1);
          setOptionIds({});
          setNotes("");
          setAssistedItems([]);
          setFormOpen(true);
          await load();
          const completedCount = draftsToSubmit.length - remainingDrafts.length;
          setSubmitMessage(`已完成 ${completedCount} 位同學；還有 ${remainingDrafts.length} 位未送出，資料已保留。請檢查後再次送出。${apiErrorMessage(failedRequest, "送出中斷")}`);
          toast.error(completedCount > 0
            ? `已完成 ${completedCount} 位同學；其餘 ${remainingDrafts.length} 位同學的草稿已保留，修正後可再送出。${apiErrorMessage(failedRequest, "送出中斷")}`
            : `尚未送出的資料已保留在登記清單。${apiErrorMessage(failedRequest, "送出失敗")}`);
          return;
        }

        setSubmitMessage(`已完成 ${draftsToSubmit.length} 位同學的訂購，可切換「班內收款」登記繳款。`);
        toast.success(`已完成 ${draftsToSubmit.length} 位同學、${draftsToSubmit.reduce((count, draft) => count + draft.items.length, 0)} 項商品登記`);
        setAssistedOrderDrafts([]);
      }
      setEditOrder(null);
      setStudentId("");
      setStudentIds([]);
      setOrderProductId("");
      setQuantity(1);
      setOptionIds({});
      setNotes("");
      setAssistedItems([]);
      setFormOpen(true);
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

  const toggleActivityClose = async (
    group: { key: string; label: string; categories: CatalogCategoryOut[] },
    isCurrentlyClosed: boolean,
  ) => {
    if (!myClassId) { toast.error("無法取得班級資訊"); return; }
    setCloseBusy(group.key);
    try {
      for (const category of group.categories) {
        const categoryClosed = closeStatus[category.id]?.is_closed ?? false;
        if (isCurrentlyClosed && categoryClosed) {
          await shopApi.reopenCategory(category.id, myClassId);
        } else if (!isCurrentlyClosed && !categoryClosed) {
          await shopApi.closeCategory(category.id, { class_id: myClassId });
        }
      }
      toast.success(isCurrentlyClosed
        ? `「${group.label}」已重新開放`
        : `「${group.label}」已結單`);
      await loadCloseStatus(catalog.map((c) => c.id), myClassId);
    } catch (e) {
      toast.error(apiErrorMessage(e, isCurrentlyClosed ? "重新開單失敗" : "結單失敗"));
    } finally {
      setCloseBusy(null);
    }
  };

  const showProductCollection = (productId: string, hasUncollectedOrders: boolean) => {
    setWorkspace("details");
    const product = catalogProducts.find((item) => item.id === productId);
    const category = catalog.find((item) => item.id === product?.categoryId);
    setActivityFilter(category?.activity_id ?? "none");
    setProductFilter(productId);
    setPaidFilter(hasUncollectedOrders ? "unpaid" : "all");
    setAssistedFilter("all");
    setMemberFilter("");
    setQuery("");
    scrollToSection("class-orders-list");
  };

  const showActivityCollection = (activityId: string | null | undefined) => {
    setWorkspace(activityId === undefined ? "details" : "collect");
    setActivityFilter(activityId === undefined ? "all" : activityId ?? "none");
    if (activityId !== undefined) setLedgerActivityKey(activityId ?? "none");
    setProductFilter("");
    setPaidFilter("all");
    setAssistedFilter("all");
    setMemberFilter("");
    setQuery("");
    setSelectedIds([]);
    scrollToSection(activityId === undefined ? "class-orders-list" : "seat-collection-heading");
  };

  const clearFilters = () => {
    setActivityFilter("all");
    setLedgerActivityKey("");
    setProductFilter("");
    setPaidFilter("all");
    setAssistedFilter("all");
    setMemberFilter("");
    setQuery("");
    setSelectedIds([]);
    setOrderPage(0);
  };

  return (
    <main className="shop-class-orders-page mx-auto min-w-0 w-full max-w-7xl space-y-5 px-4 py-5">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>班代收款與代訂</h1>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
            替本班同學快速登記班聯商品，再集中核對應收與收款狀態。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} className="btn btn-ghost min-h-11 min-w-11" aria-label="重新整理">
            <RefreshCw size={15} /> <span className="hidden sm:inline">重新整理</span>
          </button>
        </div>
      </header>

      {loadFailed && (
        <p className="rounded-md px-3 py-2 text-sm" role="alert"
          style={{ border: "1px solid var(--danger-border)", background: "var(--danger-dim)", color: "var(--danger)" }}>
          載入失敗，目前顯示上次載入的資料。請重新整理後再操作。
        </p>
      )}

      {!formOpen && assistedOrderDraftRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3"
          style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            尚有 {assistedOrderDraftRows.length} 位同學、{assistedOrderDraftRows.reduce((count, row) => count + row.items.length, 0)} 項商品待送出
          </p>
          <button type="button" onClick={openCreate} className="btn btn-ghost min-h-11 px-3 text-xs">
            繼續登記
          </button>
        </div>
      )}

      <nav className="shop-task-switch" aria-label="班代工作">
        {([
          ["order", "幫同學訂購"], ["collect", "班內收款"], ["details", "訂單與商品明細"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={workspace === key}
            onClick={() => { setWorkspace(key); if (key === "order") setFormOpen(true); }}>
            {label}
          </button>
        ))}
      </nav>

      {submitMessage && <p role="status" className="rounded-md p-3 text-sm" style={{ background: "var(--bg-elevated)" }}>{submitMessage}</p>}
      {workspace === "order" && catalogFailed && (
        <p role="alert">無法載入可訂購商品。<button type="button" className="btn btn-ghost min-h-11" onClick={() => window.location.reload()}>重新載入</button></p>
      )}
      {workspace === "order" && formOpen && (
        <section id="class-order-form" className="scroll-mt-5 rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {editOrder ? <Edit2 size={15} /> : <Plus size={15} />}
              {editOrder ? `修改訂單 ${editOrder.serial_number}` : "代同學登記商品"}
            </h2>
            <button type="button" disabled={creating} onClick={() => {
              if (!editOrder && (assistedItems.length > 0 || orderProductId)) {
                toast.info("目前商品尚未加入登記清單，請先加入或送出");
                return;
              }
              setFormOpen(false);
              setEditOrder(null);
              setStudentId("");
              setStudentIds([]);
              setOrderProductId("");
              setQuantity(1);
              setOptionIds({});
              setNotes("");
              setAssistedItems([]);
            }}
              className="min-h-11 min-w-11" style={{ color: "var(--text-muted)" }} aria-label="關閉下單表單">
              <X size={15} />
            </button>
          </div>
          <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
            {editOrder
              ? "此訂單限修改原活動的商品。"
              : composerActivityKey
                ? `目前代訂 ${activityRows.find((row) => (row.activity_id ?? "none") === composerActivityKey)?.label ?? "所選活動"}；同一活動的商品會合成一筆訂單。`
                : "先選商品與規格，再勾選同學。每位同學各自建立訂單，相同商品與規格自動合併；不同活動分開計算。"}
          </p>
          {!editOrder && composerActivityKey && (
            <button type="button" className="btn btn-ghost mb-3 min-h-11 px-3 text-xs"
              disabled={assistedItems.length > 0 || Boolean(orderProductId)}
              onClick={() => setComposerActivityKey(null)}>改看全部活動商品</button>
          )}
          <fieldset disabled={creating || catalogFailed} className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <legend className="sr-only">商品、規格與訂購同學</legend>
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>商品</span>
              <select className="input min-h-11" value={orderProductId} onChange={(e) => setOrderProductId(e.target.value)}>
                <option value="">選擇商品</option>
                {formProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.category} / {p.series} / {p.name}</option>
                ))}
              </select>
            </label>
            {productDetail?.variant_groups.map((group) => {
              const options = group.options.filter((option) => option.is_active);
              return (
                <fieldset key={group.id} className="grid min-w-0 gap-1 text-sm">
                  <legend className="mb-1" style={{ color: "var(--text-muted)" }}>{group.name}</legend>
                  {options.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {options.map((option) => {
                        const selected = optionIds[group.id] === option.id;
                        return (
                          <label key={option.id} className="cursor-pointer">
                            <input
                              type="radio"
                              name={`variant-${productDetail.id}-${group.id}`}
                              value={option.id}
                              checked={selected}
                              onChange={() => setOptionIds((current) => ({ ...current, [group.id]: option.id }))}
                              className="peer sr-only"
                            />
                            <span
                              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
                              style={selected
                                ? { border: "1px solid var(--border-strong)", background: "var(--primary-dim)", color: "var(--primary)" }
                                : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                              {option.value}
                              {option.price_delta !== 0 && (
                                <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                                  {option.price_delta > 0 ? "+" : "−"}{money(Math.abs(option.price_delta))}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs" role="status" style={{ color: "var(--text-muted)" }}>
                      目前沒有可選規格，請通知商品管理者。
                    </p>
                  )}
                </fieldset>
              );
            })}
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>數量</span>
              <input className="input min-h-11" type="number" min={1} max={100} value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
            </label>
            {editOrder ? (
              <label className="grid gap-1 text-sm">
                <span>同班學生</span>
                <input className="input min-h-11" readOnly value={members.find((member) => member.id === studentId)?.display_name ?? "訂購同學"} />
              </label>
            ) : (
              <fieldset className="shop-student-picker sm:col-span-2 xl:col-span-3" disabled={creating || membersLoading || membersLoadFailed}>
                <legend>替哪些同學訂購？ <span>已選 {studentIds.length} 位 · 每人 {quantity} 件目前所選商品</span></legend>
                <div className="flex flex-wrap items-center gap-2">
                  <input className="input min-h-11 min-w-0 flex-1" aria-label="搜尋代購同學" placeholder="找座號或姓名"
                    value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} />
                  <button type="button" className="btn btn-ghost min-h-11" onClick={() => setStudentIds([])}>清除勾選</button>
                </div>
                <div className="shop-student-options">
                  {members.filter((member) => `${member.seat_number ?? ""} ${member.display_name}`.includes(studentSearch.trim()))
                    .sort((a, b) => (a.seat_number ?? 1000) - (b.seat_number ?? 1000))
                    .map((member) => (
                      <label key={member.id}>
                        <input type="checkbox" checked={studentIds.includes(member.id)}
                          onChange={(event) => setStudentIds((ids) => event.target.checked
                            ? [...ids, member.id] : ids.filter((id) => id !== member.id))} />
                        <span>{member.seat_number == null ? "—" : `${member.seat_number} 號`}</span>
                        <strong>{member.display_name}</strong>
                      </label>
                    ))}
                </div>
                {!membersLoading && members.length > 0 && !members.some((member) => `${member.seat_number ?? ""} ${member.display_name}`.includes(studentSearch.trim())) && (
                  <p role="status">找不到同學，請試試座號或其他姓名。</p>
                )}
              </fieldset>
            )}
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>備註</span>
              <input className="input min-h-11" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="尺寸確認等" />
            </label>
            <div className="shop-composer-actions sm:col-span-2 xl:col-span-3">
              <div className="grid w-full gap-2 sm:grid-cols-3">
                <button type="button" onClick={addCurrentProduct}
                  disabled={!currentItemReady || creating}
                  className="btn btn-ghost min-h-11 w-full disabled:opacity-50">
                  <Plus size={14} /> 再加另一項商品
                </button>
                {!editOrder && (
                  <button type="button" onClick={queueCurrentDraft}
                    disabled={!canQueueCurrentDraft || creating}
                    className="btn btn-ghost min-h-11 w-full disabled:opacity-50">
                    加入待送出，繼續選商品
                  </button>
                )}
                <button type="button" onClick={submitOrder}
                  disabled={creating || membersLoading || membersLoadFailed || !myClassId || (editOrder
                    ? currentDraftItemCount === 0 || !studentId
                    : pendingDraftStudentCount === 0
                      || hasIncompleteCurrentItem
                      || (currentDraftItemCount > 0 && !recipientIds.length))}
                  className="btn min-h-11 w-full disabled:opacity-50"
                  style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                  {creating ? "處理中..." : editOrder
                    ? `儲存修改 · 小計 ${money(assistedTotal)}`
                    : `送出 ${pendingDraftStudentCount} 位 · 小計 ${money(pendingDraftSubtotal)}`}
                </button>
              </div>
            </div>
          </fieldset>
          {(assistedItems.length > 0 || (orderProductId && currentItemReady)) && (
            <div className="mt-4 rounded-md" style={{ border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between gap-3 px-3 py-2"
                style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                <h3 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {editOrder ? "訂單商品" : `所選 ${studentIds.length} 位同學，每人訂購`}
                </h3>
                <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                  {currentComposerItems().length} 項 · 商品小計 {money(assistedTotal)}
                </span>
              </div>
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {currentComposerItems().map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.product_name}</p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {activityLabel(item.activity_id)} · {item.option_label || "標準規格"} · {money(item.unit_price)} / 件
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      每人數量
                      <input className="input min-h-11 w-20 text-center tabular-nums" type="number" min={1} max={100}
                        disabled={creating} value={item.quantity} aria-label={`${item.product_name}每人數量`}
                        onChange={(event) => updateComposerItem(item, Math.max(1, Math.min(100, Number(event.target.value) || 1)))} />
                    </label>
                    <strong className="text-right text-sm tabular-nums">{money(item.quantity * item.unit_price)}</strong>
                    <button type="button" disabled={creating} onClick={() => updateComposerItem(item, 0)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md"
                      aria-label={`移除${item.product_name}`}><X size={15} /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!editOrder && assistedOrderDraftRows.length > 0 && (
            <section aria-labelledby="assisted-drafts-heading" className="mt-4 overflow-hidden rounded-md"
              style={{ border: "1px solid var(--border)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3"
                style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                <div>
                  <h3 id="assisted-drafts-heading" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    待送出登記 · {assistedOrderDraftRows.length} 位同學
                  </h3>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {assistedOrderDraftRows.reduce((count, row) => count + row.items.length, 0)} 項商品 · 各活動小計分開計算
                  </p>
                </div>
                <strong className="text-sm tabular-nums" style={{ color: "var(--primary-text)" }}>
                  合計 {money(assistedOrderDraftRows.reduce((total, row) => total + row.subtotal, 0))}
                </strong>
              </div>
              <div className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
                {assistedOrderDraftRows.map((row) => (
                  <article key={row.id} className="space-y-2 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="min-w-0 truncate text-sm" style={{ color: "var(--text-primary)" }}>{row.student_name}</strong>
                      <strong className="shrink-0 text-sm tabular-nums" style={{ color: "var(--text-primary)" }}>{money(row.subtotal)}</strong>
                    </div>
                    <div className="space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {row.items.map((item) => (
                        <p key={item.id} className="break-words">
                          {item.product_name}{item.option_label ? ` · ${item.option_label}` : ""} × {item.quantity}
                        </p>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {row.activity_totals.map((activity) => (
                        <span key={activity.activity_id ?? "none"}>{activity.label} {money(activity.amount)}</span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => loadAssistedDraft(row)} disabled={creating || hasCurrentComposerInput}
                        className="btn btn-ghost min-h-11 flex-1 text-xs disabled:opacity-50">載入編輯</button>
                      <button type="button" onClick={() => setAssistedOrderDrafts((drafts) => drafts.filter((draft) => draft.id !== row.id))}
                        disabled={creating} className="btn btn-ghost min-h-11 min-w-11 text-xs disabled:opacity-50"
                        aria-label={`移除${row.student_name}的待送出登記`}>
                        <X size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] text-sm" aria-label="待送出的班級代訂清單">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                      {["同學", "商品品項", "活動小計", "商品小計", "操作"].map((heading) => (
                        <th key={heading} scope="col" className="px-3 py-2 text-left text-xs font-semibold"
                          style={{ color: "var(--text-muted)" }}>{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {assistedOrderDraftRows.map((row) => (
                      <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <th scope="row" className="px-3 py-3 text-left text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {row.student_name}
                        </th>
                        <td className="max-w-sm px-3 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                          <ul className="space-y-1">
                            {row.items.map((item) => (
                              <li key={item.id} className="break-words">
                                {item.product_name}{item.option_label ? ` · ${item.option_label}` : ""} × {item.quantity}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="px-3 py-3 text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          <div className="space-y-1">
                            {row.activity_totals.map((activity) => (
                              <p key={activity.activity_id ?? "none"}>{activity.label} · {money(activity.amount)}</p>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3 font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{money(row.subtotal)}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button type="button" onClick={() => loadAssistedDraft(row)}
                              disabled={creating || hasCurrentComposerInput}
                              className="min-h-11 rounded-md px-2 text-xs disabled:opacity-50"
                              style={{ border: "1px solid var(--border)", color: "var(--primary)" }}>載入編輯</button>
                            <button type="button" onClick={() => setAssistedOrderDrafts((drafts) => drafts.filter((draft) => draft.id !== row.id))}
                              disabled={creating} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md disabled:opacity-50"
                              style={{ border: "1px solid var(--border)", color: "var(--danger)" }}
                              aria-label={`移除${row.student_name}的待送出登記`}>
                              <X size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
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

      <div hidden={workspace !== "collect"} className="space-y-5">
      <section aria-labelledby="activity-collection-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="activity-collection-heading" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            活動收款總覽
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            應收包含已收與待收；取消及退款訂單不列入。選一列即可查看該活動。
          </p>
        </div>
        {loading && activityOrders.length === 0 ? (
          <p className="rounded-lg px-4 py-8 text-center text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            正在整理各活動款項...
          </p>
        ) : loadFailed && activityOrders.length === 0 ? (
          <p className="rounded-lg px-4 py-8 text-center text-sm" role="alert"
            style={{ border: "1px solid var(--danger-border)", background: "var(--danger-dim)", color: "var(--danger)" }}>
            無法載入活動款項，請重新整理後再試。
          </p>
        ) : activityRows.length === 0 ? (
          <div className="rounded-lg px-4 py-8 text-center" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>目前還沒有有效訂單</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>替同學建立代訂後，應收與收款進度會出現在這裡。</p>
            <button type="button" onClick={openCreate} className="btn btn-ghost mt-3 min-h-11">幫同學下單</button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
              {activityRows.map((row) => {
                const key = row.activity_id ?? "none";
                return (
                  <div key={key} className="px-4 py-3" style={{ background: activityFilter === key ? "var(--primary-dim)" : undefined }}>
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 break-words text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{row.label}</h3>
                      <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{row.order_count} 筆</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div><p style={{ color: "var(--text-muted)" }}>應收</p><p className="mt-0.5 font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{money(row.total_amount)}</p></div>
                      <div><p style={{ color: "var(--text-muted)" }}>已收</p><p className="mt-0.5 font-medium tabular-nums" style={{ color: "var(--success)" }}>{money(row.collected_amount)}</p></div>
                      <div><p style={{ color: "var(--text-muted)" }}>待收</p><p className="mt-0.5 font-medium tabular-nums" style={{ color: "var(--warning)" }}>{money(row.outstanding_amount)}</p></div>
                    </div>
                    <p className="mt-2 text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>班聯已確認：{money(row.council_amount)}</p>
                    <button type="button" onClick={() => showActivityCollection(row.activity_id)}
                      className="mt-2 min-h-11 w-full rounded-md px-3 text-left text-xs font-medium"
                      style={{ border: "1px solid var(--border)", color: "var(--primary-text)" }}>
                      查看座號收款
                    </button>
                  </div>
                );
              })}
              <div className="px-4 py-3" style={{ background: "var(--bg-elevated)" }}>
                <div className="flex items-baseline justify-between gap-3">
                  <strong className="text-sm" style={{ color: "var(--text-primary)" }}>全部活動</strong>
                  <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{activityTotals.order_count} 筆</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><p style={{ color: "var(--text-muted)" }}>應收</p><p className="mt-0.5 font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{money(activityTotals.total_amount)}</p></div>
                  <div><p style={{ color: "var(--text-muted)" }}>已收</p><p className="mt-0.5 font-semibold tabular-nums" style={{ color: "var(--success)" }}>{money(activityTotals.collected_amount)}</p></div>
                  <div><p style={{ color: "var(--text-muted)" }}>待收</p><p className="mt-0.5 font-semibold tabular-nums" style={{ color: "var(--warning)" }}>{money(activityTotals.outstanding_amount)}</p></div>
                </div>
                <p className="mt-2 text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>班聯已確認：{money(activityTotals.council_amount)}</p>
                <button type="button" onClick={() => showActivityCollection(undefined)}
                  className="mt-2 min-h-11 w-full rounded-md px-3 text-left text-xs font-medium"
                  style={{ border: "1px solid var(--border)", color: "var(--primary-text)" }}>
                  查看全部活動訂單
                </button>
              </div>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[880px] text-sm" aria-label="各活動應收與收款金額">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                    {["活動", "訂單", "應收總額", "班代已收", "待收", "班聯已確認", ""].map((heading) => (
                      <th key={heading || "action"} scope="col" className="px-4 py-3 text-left text-xs font-semibold"
                        style={{ color: "var(--text-muted)" }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activityRows.map((row) => {
                    const key = row.activity_id ?? "none";
                    return (
                      <tr key={key} style={{ borderBottom: "1px solid var(--border)", background: activityFilter === key ? "var(--primary-dim)" : undefined }}>
                        <th scope="row" className="px-4 py-3 text-left font-medium" style={{ color: "var(--text-primary)" }}>{row.label}</th>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>{row.order_count}</td>
                        <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{money(row.total_amount)}</td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--success)" }}>{money(row.collected_amount)}</td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--warning)" }}>{money(row.outstanding_amount)}</td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>{money(row.council_amount)}</td>
                        <td className="px-4 py-2 text-right">
                          <button type="button" onClick={() => showActivityCollection(row.activity_id)}
                            className="min-h-11 rounded-md px-3 text-xs font-medium"
                            style={{ border: "1px solid var(--border)", color: "var(--primary-text)" }}>
                            查看座號收款
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: "var(--bg-elevated)" }}>
                    <th scope="row" className="px-4 py-3 text-left text-sm font-semibold" style={{ color: "var(--text-primary)" }}>全部活動</th>
                    <td className="px-4 py-3 font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>{activityTotals.order_count}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{money(activityTotals.total_amount)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: "var(--success)" }}>{money(activityTotals.collected_amount)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: "var(--warning)" }}>{money(activityTotals.outstanding_amount)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>{money(activityTotals.council_amount)}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => showActivityCollection(undefined)}
                        className="min-h-11 rounded-md px-3 text-xs font-medium"
                        style={{ border: "1px solid var(--border)", color: "var(--primary-text)" }}>
                        全部訂單
                      </button>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>

      {activityRows.length > 0 && !loadFailed && (
        <section aria-labelledby="seat-collection-heading" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="seat-collection-heading" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>依活動與座號收款</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>每位同學在此活動的應收與已收分開計算；代訂可直接帶入同學與活動。</p>
            </div>
            <label className="grid gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              活動
              <select className="input min-h-11 min-w-44" value={activeLedgerKey}
                onChange={(event) => { setLedgerActivityKey(event.target.value); setActivityFilter(event.target.value); }}>
                {activityRows.map((row) => (
                  <option key={row.activity_id ?? "none"} value={row.activity_id ?? "none"}>{row.label}</option>
                ))}
              </select>
            </label>
          </div>
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
                        <span className="shrink-0 text-xs" style={{ color: "var(--text-secondary)" }}>{row.orders.length} 筆</span>
                      </div>
                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        <div><dt style={{ color: "var(--text-secondary)" }}>應收</dt><dd className="font-semibold tabular-nums">{money(row.amount)}</dd></div>
                        <div><dt style={{ color: "var(--text-secondary)" }}>待收</dt><dd className="font-semibold tabular-nums">{money(outstanding)}</dd></div>
                        <div><dt style={{ color: "var(--text-secondary)" }}>班代已收</dt><dd className="tabular-nums">{money(row.collected)}</dd></div>
                        <div><dt style={{ color: "var(--text-secondary)" }}>班聯已確認</dt><dd className="tabular-nums">{money(row.councilPaid)}</dd></div>
                      </dl>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn btn-secondary min-h-11 px-3 text-xs"
                          disabled={!outstanding || busy !== null || loadFailed || batchBusy}
                          onClick={() => void setSeatCollected(row.id, true)}>{seatBusy ? "處理中" : "設為已收"}</button>
                        {row.collected > 0 && (
                          <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs"
                            disabled={busy !== null || loadFailed || batchBusy}
                            onClick={() => void setSeatCollected(row.id, false)}>撤銷收款</button>
                        )}
                        <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs"
                          disabled={!members.some((member) => member.id === row.id) || loadFailed}
                          onClick={() => openCreateForSeat(row.id)}>代訂</button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] text-sm" aria-label={`${ledgerActivity?.label ?? "活動"}各座號收款`}>
                <thead style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                  <tr>
                    {["座號", "同學", "訂單", "應收", "班代已收", "待收", "班聯已確認", "快捷操作"].map((heading) => (
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
                          {row.seat == null ? "—" : `${row.seat} 號`}
                        </th>
                        <td className="px-3 py-3" style={{ color: "var(--text-primary)" }}>{row.name}</td>
                        <td className="px-3 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>{row.orders.length} 筆</td>
                        <td className="px-3 py-3 tabular-nums" style={{ color: "var(--text-primary)" }}>{money(row.amount)}</td>
                        <td className="px-3 py-3 tabular-nums" style={{ color: "var(--success)" }}>{money(row.collected)}</td>
                        <td className="px-3 py-3 font-semibold tabular-nums" style={{ color: outstanding ? "var(--warning)" : "var(--text-secondary)" }}>{money(outstanding)}</td>
                        <td className="px-3 py-3 tabular-nums" style={{ color: "var(--text-secondary)" }}>{money(row.councilPaid)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="btn btn-secondary min-h-11 px-3 text-xs"
                              disabled={!outstanding || busy !== null || loadFailed || batchBusy}
                              onClick={() => void setSeatCollected(row.id, true)}>
                              {seatBusy ? "處理中" : "設為已收"}
                            </button>
                            {row.collected > 0 && (
                              <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs"
                                disabled={busy !== null || loadFailed || batchBusy}
                                onClick={() => void setSeatCollected(row.id, false)}>撤銷收款</button>
                            )}
                            <button type="button" className="btn btn-ghost min-h-11 px-3 text-xs"
                              disabled={!members.some((member) => member.id === row.id) || loadFailed}
                              onClick={() => openCreateForSeat(row.id)}>代訂</button>
                          </div>
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
        </section>
      )}

      </div>
      <div hidden={workspace !== "details"} className="space-y-5">
      <section aria-labelledby="product-collection-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="product-collection-heading" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>商品收款明細</h2>
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
          <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="divide-y md:hidden" style={{ borderColor: "var(--border)" }}>
              {productRows.map((row) => {
                const orderCount = row.collected_order_count + row.uncollected_order_count;
                return (
                  <article key={row.product_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 break-words text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{row.product_name}</h3>
                      <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{row.quantity} 件</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div><p style={{ color: "var(--text-muted)" }}>應收</p><p className="mt-0.5 font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{money(row.total_amount)}</p></div>
                      <div><p style={{ color: "var(--text-muted)" }}>已收</p><p className="mt-0.5 font-medium tabular-nums" style={{ color: "var(--success)" }}>{money(row.collected_amount)}</p></div>
                      <div><p style={{ color: "var(--text-muted)" }}>待收</p><p className="mt-0.5 font-medium tabular-nums" style={{ color: "var(--warning)" }}>{money(row.uncollected_amount)}</p></div>
                    </div>
                    <button type="button" onClick={() => showProductCollection(row.product_id, row.uncollected_order_count > 0)}
                      className="mt-2 min-h-11 w-full rounded-md px-3 text-left text-xs font-medium"
                      style={{ border: "1px solid var(--border)", color: "var(--primary-text)" }}>
                      {row.uncollected_order_count ? `查看 ${row.uncollected_order_count} 筆待收訂單` : `查看 ${orderCount} 筆訂單`}
                    </button>
                  </article>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm" aria-label="各商品訂購與收款金額">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                    {["商品", "件數／訂單", "應收總額", "已收", "待收", ""].map((heading) => (
                      <th key={heading || "action"} scope="col" className="px-4 py-3 text-left text-xs font-semibold"
                        style={{ color: "var(--text-muted)" }}>{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productRows.map((row) => {
                    const orderCount = row.collected_order_count + row.uncollected_order_count;
                    return (
                      <tr key={row.product_id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <th scope="row" className="max-w-xs px-4 py-3 text-left font-medium" style={{ color: "var(--text-primary)" }}>{row.product_name}</th>
                        <td className="px-4 py-3 text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>{row.quantity} 件 · {orderCount} 筆</td>
                        <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{money(row.total_amount)}</td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--success)" }}>{money(row.collected_amount)}</td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: "var(--warning)" }}>{money(row.uncollected_amount)}</td>
                        <td className="px-4 py-2 text-right">
                          <button type="button" onClick={() => showProductCollection(row.product_id, row.uncollected_order_count > 0)}
                            className="min-h-11 rounded-md px-3 text-xs font-medium"
                            style={{ border: "1px solid var(--border)", color: "var(--primary-text)" }}>
                            {row.uncollected_order_count ? `看 ${row.uncollected_order_count} 筆待收` : "查看訂單"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <div className="space-y-5">
        {/* 訂單列表 */}
        <section id="class-orders-list" className="min-w-0 scroll-mt-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>班級訂單 · {selectedActivityLabel}</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>確認收款只記錄班代收到同學款項，不會變更班聯會的整班繳款狀態。</p>
            </div>
            <span className="text-sm tabular-nums" style={{ color: "var(--text-muted)" }}>{visibleOrders.length} 筆</span>
          </div>
          <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="grid gap-3 md:grid-cols-[1fr_180px_160px]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={15} style={{ color: "var(--text-muted)" }} />
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
              <select className="input min-h-11" value={activityFilter} onChange={(e) => setActivityFilter(e.target.value)} aria-label="依活動篩選">
                <option value="all">全部活動</option>
                <option value="none">一般商品</option>
                {activityRows.filter((row) => row.activity_id).map((row) => (
                  <option key={row.activity_id} value={row.activity_id ?? ""}>{row.label}</option>
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

          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => {
                  const pageIds = selectablePageOrders.map((order) => order.id);
                  setSelectedIds((current) => allVisibleSelected
                    ? current.filter((id) => !pageIds.includes(id))
                    : Array.from(new Set([...current, ...pageIds])));
                }}
                  disabled={!selectablePageOrders.length}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs disabled:opacity-50"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  {allVisibleSelected ? "取消選取本頁" : "全選本頁"}
                </button>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>已選 {selectedOrders.length} 筆</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[...selectedActivityGroups.entries()].map(([activityKey, group]) => (
                  <div key={activityKey} className="flex flex-wrap items-center gap-1 rounded-md px-2 py-1"
                    style={{ border: "1px solid var(--border)" }}>
                    <span className="mr-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {group.label} · {group.orders.length} 筆
                    </span>
                    <button type="button" disabled={batchBusy} onClick={() => batchSetPaid(activityKey, true)}
                      className="min-h-9 rounded-md px-2 text-xs font-medium disabled:opacity-50"
                      style={{ border: "1px solid var(--border)", color: "var(--success)" }}>標記已收款</button>
                    <button type="button" disabled={batchBusy} onClick={() => batchSetPaid(activityKey, false)}
                      className="min-h-9 rounded-md px-2 text-xs font-medium disabled:opacity-50"
                      style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>撤銷收款</button>
                  </div>
                ))}
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
                {pageOrders.map((order) => (
                  <article key={order.id} className="rounded-md p-3" style={{ border: "1px solid var(--border)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/shop/orders/${order.id}?from=class`} className="block truncate text-xs font-mono font-medium hover:underline" style={{ color: "var(--primary)" }}>
                          {order.serial_number}
                        </Link>
                        <p className="mt-1 truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{order.user_name ?? "未具名訂購人"}</p>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                          {activityLabel(order.activity_id)} · {order.assistance_scope === "class_assisted" ? "幹部代訂" : "自行訂購"}
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
                      <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{money(order.total_price)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {isCollectableOrder(order) ? (
                        <button type="button" onClick={() => togglePaid(order)} disabled={busy === order.id}
                          className="min-h-11 rounded-md px-3 text-xs font-medium disabled:opacity-50"
                          aria-label={order.is_class_collected ? `撤銷${order.user_name ?? "此筆"}收款` : `標記${order.user_name ?? "此筆"}已收款`}
                          style={{ border: "1px solid var(--border)", color: order.is_class_collected ? "var(--text-secondary)" : "var(--success)" }}>
                          {order.is_class_collected ? "撤銷收款" : "標記已收"}
                        </button>
                      ) : (
                        <span className="inline-flex min-h-11 items-center px-3 text-xs" style={{ color: "var(--text-muted)" }}>
                          不列入收款
                        </span>
                      )}
                      <button type="button" disabled={!isCollectableOrder(order)}
                        onClick={() => setSelectedIds((current) => current.includes(order.id) ? current.filter((id) => id !== order.id) : [...current, order.id])}
                        aria-pressed={selectedSet.has(order.id)}
                        className="min-h-11 rounded-md px-3 text-xs disabled:opacity-50" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                        {!isCollectableOrder(order) ? "無法選取" : selectedSet.has(order.id) ? "取消選取" : "選取"}
                      </button>
                      {isCollectableOrder(order) && (
                        <>
                          {!order.is_paid && !order.is_class_collected && (
                            <button type="button" onClick={() => openEdit(order)} className="min-h-11 rounded-md px-3 text-xs"
                            style={{ border: "1px solid var(--border)", color: "var(--primary)" }}>修改</button>
                          )}
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
                      {["", "訂單編號", "訂購人", "活動", "來源", "狀態", "應收金額", "班代收款", "操作"].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-left text-xs font-semibold"
                          style={{ color: "var(--text-muted)" }} scope="col">{h}</th>
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
                            style={{ color: selectedSet.has(order.id) ? "var(--primary)" : "var(--text-muted)" }}>
                            {selectedSet.has(order.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/shop/orders/${order.id}?from=class`} className="text-xs font-mono hover:underline" style={{ color: "var(--primary)" }}>
                            {order.serial_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{order.user_name ?? "-"}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{activityLabel(order.activity_id)}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                          {order.assistance_scope === "class_assisted" ? "幹部代訂" : "自行訂購"}
                        </td>
                        <td className="px-4 py-3"><OrderStatusBadge status={order.status} /></td>
                        <td className="px-4 py-3 font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{money(order.total_price)}</td>
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
                                className="min-h-11 rounded-md px-3 text-xs disabled:opacity-50"
                                style={{ border: "1px solid var(--border)" }}>
                                {order.is_class_collected ? "撤銷收款" : "標記已收"}
                              </button>
                            ) : (
                              <span className="px-2 text-xs" style={{ color: "var(--text-muted)" }}>不列入收款</span>
                            )}
                            {isCollectableOrder(order) && (
                              <>
                                {!order.is_paid && !order.is_class_collected && (
                                  <button type="button" onClick={() => openEdit(order)} title="修改訂單"
                                  className="rounded-md p-1 hover:opacity-70" style={{ color: "var(--primary)" }}>
                                  <Edit2 size={14} />
                                  </button>
                                )}
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
          {visibleOrders.length > ORDER_LIST_PAGE_SIZE && (
            <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="訂單分頁">
              <p className="text-xs tabular-nums" aria-live="polite" style={{ color: "var(--text-muted)" }}>
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

      </div>

      {catalog.length > 0 && (
        <section aria-labelledby="close-management-heading" className="rounded-lg p-4"
          style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
          <h2 id="close-management-heading" className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>商品結單管理</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {closeActivityGroups.map((group) => {
              const statuses = group.categories
                .map((category) => closeStatus[category.id])
                .filter((status) => status?.is_closed);
              const isClosed = statuses.length === group.categories.length;
              const isPartiallyClosed = statuses.length > 0 && !isClosed;
              const status = statuses[0];
              const isBusy = closeBusy === group.key;
              return (
                <div key={group.key} className="flex items-center justify-between gap-3 rounded-md px-3 py-2"
                  style={{ border: `1px solid ${isClosed || isPartiallyClosed ? "var(--danger-border)" : "var(--border)"}`, background: isClosed || isPartiallyClosed ? "var(--danger-dim)" : "transparent" }}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{group.label}</p>
                    <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      分類：{group.categories.map((category) => category.name).join("、")}
                    </p>
                    {isClosed && status?.closed_at && (
                      <p className="text-xs" style={{ color: "var(--danger)" }}>
                        已結單 {new Date(status.closed_at).toLocaleDateString("zh-TW")} {status.closed_by_name ? `· ${status.closed_by_name}` : ""}
                      </p>
                    )}
                    {isPartiallyClosed && <p className="text-xs" style={{ color: "var(--danger)" }}>部分結單 {statuses.length}/{group.categories.length} 個分類</p>}
                    {!isClosed && !isPartiallyClosed && <p className="text-xs" style={{ color: "var(--text-muted)" }}>開放中</p>}
                  </div>
                  <button type="button" onClick={() => toggleActivityClose(group, isClosed)} disabled={isBusy || !myClassId}
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
