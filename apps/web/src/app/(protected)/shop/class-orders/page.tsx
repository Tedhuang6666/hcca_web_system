"use client";

import NumberInput from "@/components/ui/NumberInput";
import Modal from "@/components/ui/Modal";
import CollectionCategoryPicker from "@/components/shop/CollectionCategoryPicker";
import SupplementOrders from "@/components/shop/SupplementOrders";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Edit2, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { classApi, shopApi, apiErrorMessage } from "@/lib/api";
import { orderScopeKey, catalogScopeKey, orderScopeParams, isOrderingClosed } from "@/lib/shop-order-scope";
import { mergeDraftItems } from "@/lib/shop-order-items";
import { flattenCatalog, money } from "@/lib/shop-class-orders";
import { AssistedOrderDraftList } from "@/components/shop/AssistedOrderDraftList";
import { ClassOrderCollectionPanel } from "@/components/shop/ClassOrderCollectionPanel";
import { ClassOrdersListPanel } from "@/components/shop/ClassOrdersListPanel";
import type { AssistedItemDraft, AssistedOrderDraft } from "@/components/shop/classOrderTypes";
import {
  buildCategoryLabels, buildCategoryRows, buildProductFilterOptions, buildProductRows,
  buildSeatRows, isCollectableOrder, resolveActiveLedgerKey,
} from "@/components/shop/classOrderSelectors";
import type {
  CatalogCategoryOut,
  ClassMemberOut,
  CloseStatusItem,
  OrderListItem,
  OrderOut,
  ProductOut,
  ShopClassSummaryOut,
} from "@/lib/types";

type PaidFilter = "all" | "paid" | "unpaid";
type AssistedFilter = "all" | "assisted";

type ClassOrderQuery = NonNullable<Parameters<typeof shopApi.listClassOrders>[0]>;
const CLASS_ORDER_PAGE_SIZE = 500;
const ORDER_LIST_PAGE_SIZE = 50;

const emptySummary: ShopClassSummaryOut = {
  class_count: 0, order_count: 0, item_count: 0, total_amount: 0,
  paid_amount: 0, unpaid_amount: 0, paid_order_count: 0, unpaid_order_count: 0,
  assisted_order_count: 0, product_rows: [],
};



function scrollToSection(id: string) {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior, block: "start" }));
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
  const [seatFilter, setSeatFilter] = useState<"all" | "unpaid" | "paid">("all");
  const [seatSearch, setSeatSearch] = useState("");
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [categoryOrders, setCategoryOrders] = useState<OrderListItem[]>([]);
  const [productSummary, setProductSummary] = useState<ShopClassSummaryOut>(emptySummary);
  const [members, setMembers] = useState<ClassMemberOut[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersLoadFailed, setMembersLoadFailed] = useState(false);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [submitMessage, setSubmitMessage] = useState("");
  const [catalog, setCatalog] = useState<CatalogCategoryOut[]>([]);
  const [myClassId, setMyClassId] = useState<string | null>(null);
  const [closeStatus, setCloseStatus] = useState<Record<string, CloseStatusItem>>({});
  const [productDetail, setProductDetail] = useState<ProductOut | null>(null);
  const [productDetailFailed, setProductDetailFailed] = useState(false);
  const loadVersion = useRef(0);
  const membersLoadVersion = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [assistedFilter, setAssistedFilter] = useState<AssistedFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);
  const [collectionConfirmation, setCollectionConfirmation] = useState<{
    memberId: string; name: string; categoryLabel: string;
    categories: { label: string; amount: number }[];
    orderIds: string[]; amount: number; collected: boolean;
  } | null>(null);
  const collectionSubmitting = useRef(false);
  const [recipientMode, setRecipientMode] = useState<"single" | "batch">("single");
  const [batchStudentIds, setBatchStudentIds] = useState<string[]>([]);
  const [recipientFilter, setRecipientFilter] = useState("");
  const [orderProductSearch, setOrderProductSearch] = useState("");
  const [variantSearches, setVariantSearches] = useState<Record<string, string>>({});
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
  const [editProductsOpen, setEditProductsOpen] = useState(false);
  const productSearchRef = useRef<HTMLInputElement>(null);
  const productOptionsRef = useRef<HTMLFieldSetElement>(null);
  const [studentId, setStudentId] = useState("");
  const [orderProductId, setOrderProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [optionIds, setOptionIds] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const composerRecipientIds = useMemo(() => recipientMode === "batch" ? batchStudentIds : [studentId].filter(Boolean),
    [recipientMode, batchStudentIds, studentId]);
  const recipientKey = composerRecipientIds.map((id) => {
    const member = members.find((item) => item.id === id);
    return member?.user_id ?? member?.roster_entry_id ?? id;
  }).sort().join(",");
  const [purchaseOptions, setPurchaseOptions] = useState<{ key: string; allowed: Set<string> } | null>(null);
  const [purchaseOptionsError, setPurchaseOptionsError] = useState<string | null>(null);
  const [purchaseOptionsRetry, setPurchaseOptionsRetry] = useState(0);
  const purchaseOptionsReady = purchaseOptions?.key === recipientKey;
  const purchaseOptionsFailed = purchaseOptionsError === recipientKey;

  // 取消確認
  const [cancelTarget, setCancelTarget] = useState<OrderListItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const catalogProducts = useMemo(() => flattenCatalog(catalog), [catalog]);
  const categoryLabels = useMemo(() => buildCategoryLabels(catalog), [catalog]);

  const categoryLabel = useCallback((categoryId: string | null | undefined) => {
    if (!categoryId || categoryId === "none") return "一般商品";
    return categoryLabels.get(categoryId) ?? `已結束分類 · ${categoryId.slice(0, 6)}`;
  }, [categoryLabels]);

  const categoryRows = useMemo(
    () => buildCategoryRows(catalog, categoryOrders, categoryLabel),
    [categoryOrders, categoryLabel, catalog],
  );
  const activeLedgerKey = useMemo(
    () => resolveActiveLedgerKey(categoryRows, catalogLoading, selectedCategoryKey),
    [categoryRows, catalogLoading, selectedCategoryKey],
  );
  const ledgerCategories = categoryRows.filter((row) => row.key === activeLedgerKey);
  const ledgerCategoryLabel = ledgerCategories[0]?.label ?? "請先選擇商品分類";
  const composerCategoryKey = activeLedgerKey;
  const scopedCatalog = catalog.filter((category) => catalogScopeKey(category) === activeLedgerKey);
  const activeProducts = useMemo(
    () => catalogProducts.filter((product) => {
      const category = catalog.find((item) => item.id === product.categoryId);
      return product.status === "active" && !(category && isOrderingClosed(category))
        && !(closeStatus[product.categoryId]?.is_closed && closeStatus[product.categoryId]?.is_global)
        && (!category?.order_closed_at || new Date(category.order_closed_at).getTime() > Date.now());
    }),
    [catalogProducts, catalog, closeStatus],
  );
  const formProducts = useMemo(
    () => {
      const reserved = [...assistedItems, ...assistedOrderDrafts.filter((draft) => composerRecipientIds.includes(draft.student_id)).flatMap((draft) => draft.items)];
      const reservedGroups = new Set(reserved.map((item) => catalogProducts.find((product) => product.id === item.product_id)?.purchase_group).filter(Boolean));
      return activeProducts.filter((product) => {
        const existing = editOrder?.items.some((item) => item.product_id === product.id);
        const groupReserved = product.purchase_group && reservedGroups.has(product.purchase_group);
        const allowed = existing || (purchaseOptionsReady && purchaseOptions.allowed.has(product.id) && !groupReserved);
        const scope = orderScopeKey({ category_id: product.categoryId });
        return allowed && (editOrder ? scope === orderScopeKey(editOrder)
          : scope === composerCategoryKey);
      });
    },
    [activeProducts, editOrder, composerCategoryKey, assistedItems, assistedOrderDrafts, catalogProducts, composerRecipientIds, purchaseOptionsReady, purchaseOptions],
  );
  const orderProductResults = useMemo(() => {
    const needle = orderProductSearch.trim().toLocaleLowerCase("zh-Hant");
    if (!needle) return formProducts;
    return formProducts.filter((product) =>
      [product.name, product.category, product.series]
        .some((value) => value.toLocaleLowerCase("zh-Hant").includes(needle)),
    );
  }, [formProducts, orderProductSearch]);
  const selectedOrderProduct = formProducts.find((product) => product.id === orderProductId);
  const productRows = useMemo(
    () => buildProductRows(activeProducts, activeLedgerKey, categoryFilter, productSummary.product_rows),
    [activeProducts, activeLedgerKey, categoryFilter, productSummary.product_rows],
  );
  const productFilterOptions = useMemo(
    () => buildProductFilterOptions(catalogProducts, activeLedgerKey, categoryFilter, productRows),
    [activeLedgerKey, categoryFilter, catalogProducts, productRows],
  );
  const seatRows = useMemo(
    () => buildSeatRows(categoryOrders, activeLedgerKey, members),
    [categoryOrders, activeLedgerKey, members],
  );
  const filteredSeatRows = seatRows.filter((row) =>
    `${row.seat ?? ""} ${row.name}`.includes(seatSearch.trim())
    && (seatFilter === "all" || (seatFilter === "unpaid"
      ? row.amount > row.collected : row.orders.length > 0 && row.amount === row.collected)),
  );
  const seatCollectionTotals = useMemo(() => seatRows.reduce((totals, row) => ({
    amount: totals.amount + row.amount,
    collected: totals.collected + row.collected,
  }), { amount: 0, collected: 0 }), [seatRows]);

  const filterCategoryRows = scopedCatalog.map((category) => ({
    key: `category:${category.id}`, label: category.name,
  }));
  const selectedCategoryLabel = categoryFilter === "all"
    ? ledgerCategoryLabel
    : categoryFilter === "none" ? "一般商品"
      : filterCategoryRows.find((row) => row.key === categoryFilter)?.label ?? "所選分類";

  const currentOptionIds = productDetail?.variant_groups
    .map((group) => optionIds[group.id])
    .filter((optionId): optionId is string => Boolean(optionId)) ?? [];
  const currentItemReady = Boolean(
    selectedOrderProduct && productDetail?.id === orderProductId && currentOptionIds.length === productDetail.variant_groups.length
      && (productDetail.purchase_allowed !== false || editOrder?.items.some((item) => item.product_id === orderProductId)),
  );
  const quantityLimit = Math.min(100, selectedOrderProduct?.purchase_group ? 1 : productDetail?.max_quantity_per_user ?? 100);
  const currentUnitPrice = (productDetail?.price ?? 0) + (productDetail?.variant_groups ?? [])
    .reduce((total, group) => {
      const option = group.options.find((item) => item.id === optionIds[group.id]);
      return total + (option?.price_delta ?? 0);
    }, 0);
  const assistedTotal = assistedItems.reduce((total, item) => total + item.quantity * item.unit_price, 0)
    + (currentItemReady && orderProductId ? quantity * currentUnitPrice : 0);
  const currentDraftItemCount = assistedItems.length + (currentItemReady ? 1 : 0);
  const recipientIds = composerRecipientIds;
  const selectedStudent = members.find((member) => member.id === studentId);
  const sortedMembers = [...members].sort((a, b) =>
    (a.seat_number ?? 1000) - (b.seat_number ?? 1000)
      || a.display_name.localeCompare(b.display_name, "zh-Hant"),
  );
  const filteredRecipients = sortedMembers.filter((member) =>
    ((member.seat_number == null ? "" : String(member.seat_number)) + " " + member.display_name)
      .toLowerCase().includes(recipientFilter.trim().toLowerCase()),
  );
  const hasAllVisibleRecipients = filteredRecipients.length > 0
    && filteredRecipients.every((member) => batchStudentIds.includes(member.id));
  const pendingDraftStudentCount = new Set([
    ...assistedOrderDrafts.map((draft) => draft.student_id),
    ...(currentDraftItemCount > 0 ? recipientIds : []),
  ]).size;
  const pendingDraftSubtotal = assistedOrderDrafts.reduce((total, draft) => total
    + draft.items.reduce((amount, item) => amount + item.quantity * item.unit_price, 0), 0)
    + assistedTotal * recipientIds.length;
  const hasCurrentComposerInput = Boolean(studentId || batchStudentIds.length || notes.trim() || assistedItems.length > 0 || orderProductId);
  const hasIncompleteCurrentItem = Boolean(orderProductId && !currentItemReady);
  const canQueueCurrentDraft = Boolean(
    !editOrder && recipientIds.length && currentDraftItemCount > 0 && !hasIncompleteCurrentItem,
  );
  useEffect(() => {
    if (workspace !== "order" || (editOrder && !editProductsOpen)) return;
    if (orderProductId && productDetail?.id === orderProductId) {
      productOptionsRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    } else if (!orderProductId && (studentId || editProductsOpen)) {
      productSearchRef.current?.focus();
    }
  }, [workspace, studentId, orderProductId, productDetail, editOrder, editProductsOpen]);
  const assistedOrderDraftRows = useMemo(() => assistedOrderDrafts.map((draft) => {
    const categoryTotals = new Map<string, { key: string; category_id: string | null; label: string; amount: number }>();
    for (const item of draft.items) {
      const key = item.scope_key;
      const row = categoryTotals.get(key) ?? {
        key,
        category_id: item.category_id,
        label: categoryLabel(key),
        amount: 0,
      };
      row.amount += item.quantity * item.unit_price;
      categoryTotals.set(key, row);
    }
    return {
      ...draft,
      subtotal: draft.items.reduce((total, item) => total + item.quantity * item.unit_price, 0),
      category_totals: [...categoryTotals.values()],
    };
  }), [assistedOrderDrafts, categoryLabel]);

  const loadMembers = useCallback(async () => {
    const version = ++membersLoadVersion.current;
    setMembersLoading(true);
    setMembersLoadFailed(false);
    try {
      const schoolClass = await classApi.myClass();
      const data = schoolClass ? await classApi.members(schoolClass.id) : [];
      if (version !== membersLoadVersion.current) return;
      setMyClassId(schoolClass?.id ?? null);
      setMembers(data);
    } catch {
      if (version !== membersLoadVersion.current) return;
      setMembers([]);
      setMembersLoadFailed(true);
    } finally {
      if (version === membersLoadVersion.current) setMembersLoading(false);
    }
  }, []);

  const load = useCallback(async (refreshMembers = true) => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadFailed(false);
    const scope = {
      ...orderScopeParams(activeLedgerKey),
      ...(categoryFilter.startsWith("category:") ? { category_id: categoryFilter.slice(9) } : {}),
    };
    const params: ClassOrderQuery = { ...scope };
    if (paidFilter !== "all") params.is_class_collected = paidFilter === "paid" ? "true" : "false";
    if (assistedFilter === "assisted") params.assisted_only = "true";
    if (productFilter) params.product_id = productFilter;
    if (memberFilter) params.member_user_id = memberFilter;
    const filteredOrdersPromise = activeLedgerKey ? listAllClassOrders(params) : Promise.resolve([]);
    const categoryOrdersPromise = listAllClassOrders();
    try {
      const [orderItems, categoryItems, productStatus] = await Promise.all([
        filteredOrdersPromise,
        categoryOrdersPromise,
        activeLedgerKey ? shopApi.classSummary(scope) : Promise.resolve(emptySummary),
        refreshMembers ? loadMembers() : Promise.resolve(),
      ]);
      if (version !== loadVersion.current) return;
      setOrders(orderItems);
      setCategoryOrders(categoryItems);
      setProductSummary(productStatus);
      setSelectedIds((cur) => cur.filter((id) => orderItems.some((order) =>
        order.id === id && isCollectableOrder(order))));
    } catch (e) {
      if (version !== loadVersion.current) return;
      setLoadFailed(true);
      toast.error(apiErrorMessage(e, "載入失敗"));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [activeLedgerKey, categoryFilter, assistedFilter, paidFilter, productFilter, memberFilter, loadMembers]);

  const loadCloseStatus = useCallback(async (catIds: string[], classId: string) => {
    if (!catIds.length) return;
    try {
      const res = await shopApi.getCloseStatus(catIds, classId);
      setCloseStatus(res.statuses);
    } catch {
      setCloseStatus({});
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);
  useEffect(() => { void loadMembers(); }, [loadMembers]);

  const loadCatalog = useCallback(async () => {
    setCatalogFailed(false);
    setCatalogLoading(true);
    try {
      setCatalog(await shopApi.catalog(undefined, true));
    } catch {
      setCatalogFailed(true);
      setCatalog([]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    let active = true;
    setPurchaseOptions(null);
    setPurchaseOptionsError(null);
    if (!recipientKey) return;
    Promise.all(recipientKey.split(",").map((id) => shopApi.catalog(undefined, true, undefined, id)))
      .then((catalogs) => {
        if (!active) return;
        const choices = catalogs.map((tree) => new Set(flattenCatalog(tree)
          .filter((product) => product.purchase_allowed !== false).map((product) => product.id)));
        setPurchaseOptions({ key: recipientKey, allowed: new Set([...choices[0]].filter((id) => choices.every((choice) => choice.has(id)))) });
      })
      .catch(() => { if (active) setPurchaseOptionsError(recipientKey); });
    return () => { active = false; };
  }, [recipientKey, purchaseOptionsRetry, catalog]);

  useEffect(() => {
    if (myClassId && catalog.length) void loadCloseStatus(catalog.map((cat) => cat.id), myClassId);
  }, [catalog, myClassId, loadCloseStatus]);

  useEffect(() => {
    let active = true;
    setProductDetail(null);
    setProductDetailFailed(false);
    if (!orderProductId) {
      setOptionIds({});
      return;
    }
    shopApi.getProduct(orderProductId, recipientKey.split(",")[0] || undefined)
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
      .catch((e) => {
        if (!active) return;
        setProductDetailFailed(true);
        toast.error(apiErrorMessage(e, "商品載入失敗"));
      });
    return () => { active = false; };
  }, [editOrder, orderProductId, recipientKey]);

  const openCreate = () => {
    setWorkspace("order");
    if (formOpen && (editOrder || hasCurrentComposerInput)) {
      scrollToSection("class-order-form");
      return;
    }
    setFormOpen(true);
    setEditOrder(null);
    setStudentId("");
    setBatchStudentIds([]);
    setRecipientFilter("");
    setOrderProductSearch("");
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
    setRecipientMode("single");
    setBatchStudentIds([]);
    setRecipientFilter("");
    setOrderProductSearch("");
    setStudentId(memberId);
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
    setEditOrder(null);
    setEditProductsOpen(false);
    setRecipientMode("single");
    setBatchStudentIds([]);
    setOrderProductSearch("");
    setOrderProductId("");
    setQuantity(1);
    setOptionIds({});
    setAssistedItems([]);
    try {
      const full = await shopApi.getOrder(order.id);
      setEditOrder(full);
      setStudentId(full.user_id ?? "");
      setNotes(full.notes ?? "");
      setAssistedItems(full.items.slice(1).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name ?? "未命名商品",
        scope_key: orderScopeKey(full),
        category_id: full.category_id ?? null,
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

  const validPurchaseGroups = (items: AssistedItemDraft[]) => {
    const quantities = new Map<string, number>();
    for (const item of items) {
      const group = catalogProducts.find((product) => product.id === item.product_id)?.purchase_group;
      if (!group) continue;
      quantities.set(group, (quantities.get(group) ?? 0) + item.quantity);
    }
    if ([...quantities.values()].some((count) => count > 1)) {
      toast.error("同組商品每位同學合計只能訂購一張，請調整清單");
      return false;
    }
    return true;
  };

  const addCurrentProduct = () => {
    if (!recipientIds.length) { toast.error("請先選擇同班學生"); return; }
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
    const categoryId = editOrder?.category_id
      ?? catalogProducts.find((product) => product.id === productDetail.id)?.categoryId
      ?? null;
    const nextItems = mergeDraftItems([...assistedItems, {
      id: `${productDetail.id}-${Date.now()}-${Math.random()}`,
      product_id: productDetail.id,
      product_name: productDetail.name,
      scope_key: editOrder ? orderScopeKey(editOrder) : orderScopeKey({ category_id: categoryId }),
      category_id: categoryId,
      quantity,
      option_ids: currentOptionIds,
      option_label: optionLabel,
      unit_price: currentUnitPrice,
    }]);
    if (!validPurchaseGroups(nextItems)) return;
    if (nextItems.some((item) => item.quantity > 100)) {
      toast.error("同一商品規格每次最多登記 100 件，請調整數量");
      return;
    }
    setAssistedItems(nextItems);
    setOrderProductId("");
    setOrderProductSearch("");
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
        scope_key: editOrder ? orderScopeKey(editOrder) : orderScopeKey({ category_id: catalogProducts.find((product) => product.id === productDetail.id)?.categoryId }),
        category_id: editOrder?.category_id
          ?? catalogProducts.find((product) => product.id === productDetail.id)?.categoryId
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
    const nextItems = nextQuantity ? [...items, { ...item, quantity: nextQuantity }] : items;
    if (!validPurchaseGroups(nextItems)) return;
    setAssistedItems(nextItems);
    setOrderProductId("");
    setOrderProductSearch("");
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
    if (!recipientIds.length) { toast.error("請先選擇同班學生"); return; }
    if (hasIncompleteCurrentItem) { toast.error("請先完成商品規格"); return; }
    const items = currentComposerItems();
    if (!items.length) { toast.error("請先加入至少一項商品"); return; }
    const drafts = buildDrafts(items);
    if (drafts.some((draft) => !validPurchaseGroups(draft.items))) return;
    if (drafts.some((draft) => draft.items.some((item) => item.quantity > 100))) {
      toast.error("同一位同學的同一商品規格每次最多 100 件");
      return;
    }
    setAssistedOrderDrafts(drafts);
    setStudentId("");
    setBatchStudentIds([]);
    setOrderProductId("");
    setQuantity(1);
    setOptionIds({});
    setNotes("");
    setAssistedItems([]);
    toast.success(recipientMode === "batch"
      ? "已將商品加入 " + recipientIds.length + " 位同學的待送出清單，可繼續設定下一組"
      : "已將" + (selectedStudent?.display_name ?? "這位同學") + "的商品加入待送出清單，可繼續登記下一位");
  };

  const loadAssistedDraft = (draft: AssistedOrderDraft) => {
    if (hasCurrentComposerInput) {
      toast.info("請先把目前填寫的商品加入清單，再載入其他同學");
      return;
    }
    setAssistedOrderDrafts((drafts) => drafts.filter((item) => item.id !== draft.id));
    setEditOrder(null);
    setRecipientMode("single");
    setBatchStudentIds([]);
    setStudentId(draft.student_id);
    setOrderProductId("");
    setOrderProductSearch("");
    setQuantity(1);
    setOptionIds({});
    setNotes(draft.notes);
    setAssistedItems(draft.items);
    setFormOpen(true);
  };

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const seatByMemberId = new Map(members.map((member) => [member.id, member.seat_number]));
    return orders
      .filter((order) => order.status !== "cancelled"
        && (!needle
          || order.serial_number.toLowerCase().includes(needle)
          || (order.user_name ?? "").toLowerCase().includes(needle)
          || (order.class_label ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => (seatByMemberId.get(a.user_id ?? "") ?? Number.POSITIVE_INFINITY)
        - (seatByMemberId.get(b.user_id ?? "") ?? Number.POSITIVE_INFINITY)
        || (a.user_name ?? "").localeCompare(b.user_name ?? "", "zh-Hant")
        || (a.serial_number ?? "").localeCompare(b.serial_number ?? ""));
  }, [members, orders, query]);

  const selectedSet = new Set(selectedIds);
  const selectedOrders = visibleOrders.filter((order) =>
    selectedSet.has(order.id) && isCollectableOrder(order));
  const selectedCategoryGroups = new Map<string, { label: string; orders: OrderListItem[] }>();
  for (const order of selectedOrders) {
    const key = orderScopeKey(order);
    const group = selectedCategoryGroups.get(key) ?? {
      label: order.category_name ?? categoryLabel(key),
      orders: [],
    };
    group.orders.push(order);
    selectedCategoryGroups.set(key, group);
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
  }, [categoryFilter, assistedFilter, memberFilter, paidFilter, productFilter, query]);

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
    if (!ledgerCategories.length || busy !== null || batchBusy) return;
    const row = seatRows.find((item) => item.id === memberId);
    const targets = row?.orders.filter((order) => order.is_class_collected !== collected) ?? [];
    if (!targets.length) return;
    setCollectionConfirmation({
      memberId, name: row?.name ?? "同學", categoryLabel: ledgerCategoryLabel,
      categories: ledgerCategories.map((category) => ({ label: category.label,
        amount: targets.filter((order) => orderScopeKey(order) === category.key).reduce((sum, order) => sum + order.total_price, 0),
      })).filter((category) => category.amount > 0), orderIds: targets.map((order) => order.id),
      amount: targets.reduce((sum, order) => sum + order.total_price, 0), collected,
    });
  };

  const confirmSeatCollection = async () => {
    if (!collectionConfirmation || collectionSubmitting.current) return;
    const target = collectionConfirmation;
    collectionSubmitting.current = true;
    const targets = target.orderIds;
    const collected = target.collected;
    const memberId = target.memberId;
    setBusy(`seat:${memberId}`);
    try {
      const results = await Promise.allSettled(targets.map((id) => shopApi.setClassCollected(id, collected)));
      const failed = results.filter((result) => result.status === "rejected");
      setCollectionConfirmation(null);
      if (failed.length) {
        toast.error(`已更新 ${targets.length - failed.length} 筆，${failed.length} 筆未完成。請確認更新後的狀態再試。`);
        return;
      }
      toast.success(`${target.name}的${target.categoryLabel}預購已${collected ? "記錄收款" : "撤銷收款"}`);
    } catch (error) {
      toast.error(apiErrorMessage(error, "收款狀態更新失敗"));
    } finally {
      await load();
      setBusy(null);
      collectionSubmitting.current = false;
    }
  };

  const batchSetPaid = async (categoryKey: string, isPaid: boolean) => {
    const targets = (selectedCategoryGroups.get(categoryKey)?.orders ?? [])
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
      toast.error("請先選擇同班學生");
      return;
    }
    if (editOrder && !studentId) { toast.error("找不到訂單的學生資料"); return; }
    if (editOrder && currentItems.length === 0) { toast.error("請至少保留一項商品"); return; }

    const draftsToSubmit = editOrder
      ? []
      : currentItems.length ? buildDrafts(currentItems) : assistedOrderDrafts;
    if (editOrder ? !validPurchaseGroups(currentItems)
      : draftsToSubmit.some((draft) => !validPurchaseGroups(draft.items))) return;
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
            const member = members.find((item) => item.id === draft.student_id);
            await shopApi.createClassOrder({
              ...(member?.roster_entry_id && !member.user_id
                ? { roster_entry_id: member.roster_entry_id }
                : { user_id: draft.student_id }),
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
          setBatchStudentIds([]);
          setOrderProductId("");
          setOrderProductSearch("");
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

        setSubmitMessage(`已完成 ${draftsToSubmit.length} 位同學的訂購。已繳款後的追加會另列補收款，由該筆訂購同學自行付款，班聯確認後歸回原班級。`);
        toast.success(`已完成 ${draftsToSubmit.length} 位同學、${draftsToSubmit.reduce((count, draft) => count + draft.items.length, 0)} 項商品登記`);
        setAssistedOrderDrafts([]);
      }
      setEditOrder(null);
      setStudentId("");
      setBatchStudentIds([]);
      setOrderProductId("");
      setOrderProductSearch("");
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

  const showProductCollection = (productId: string, hasUncollectedOrders: boolean) => {
    setWorkspace("details");
    const product = catalogProducts.find((item) => item.id === productId);
    const category = catalog.find((item) => item.id === product?.categoryId);
    setCategoryFilter(category ? `category:${category.id}` : "none");
    setProductFilter(productId);
    setPaidFilter(hasUncollectedOrders ? "unpaid" : "all");
    setAssistedFilter("all");
    setMemberFilter("");
    setQuery("");
    scrollToSection("class-orders-list");
  };

  const clearFilters = () => {
    setCategoryFilter("all");
    setProductFilter("");
    setPaidFilter("all");
    setAssistedFilter("all");
    setMemberFilter("");
    setQuery("");
    setSelectedIds([]);
    setOrderPage(0);
  };

  return (
    <div className="shop-class-orders-page mx-auto min-w-0 w-full max-w-7xl space-y-5 px-4 py-5">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold text-fg-primary!">班代工作</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} className="btn btn-ghost min-h-11 min-w-11" aria-label="重新整理">
            <RefreshCw size={15} /> <span className="hidden sm:inline">重新整理</span>
          </button>
        </div>
      </header>

      {categoryRows.length > 0 && <section className="space-y-2" aria-label="目前處理商品分類">
        <CollectionCategoryPicker options={categoryRows} selected={activeLedgerKey || null} label="商品分類"
          disabled={busy !== null || batchBusy || creating || loading || catalogLoading || catalogFailed || loadFailed
            || Boolean(editOrder || collectionConfirmation || cancelTarget || orderProductId)
            || assistedItems.length > 0 || assistedOrderDrafts.length > 0}
          onChange={(key) => {
            if (key === activeLedgerKey) return;
            loadVersion.current += 1;
            setSelectedCategoryKey(key);
            setCategoryFilter("all");
            setOrders([]);
            setProductSummary(emptySummary);
            setLoading(true);
            setProductFilter(""); setMemberFilter(""); setQuery(""); setPaidFilter("all"); setAssistedFilter("all");
            setSelectedIds([]); setOrderPage(0); setSeatSearch(""); setSeatFilter("all");
            setStudentId(""); setBatchStudentIds([]); setNotes(""); setOrderProductSearch(""); setSubmitMessage("");
          }} />
        {(assistedItems.length > 0 || assistedOrderDrafts.length > 0 || orderProductId || editOrder) && <p className="text-sm text-fg-secondary!">請先完成目前的代訂或修改，再切換商品分類。</p>}
        <p className="font-semibold">目前商品分類：{ledgerCategoryLabel}</p>
      </section>}
      {!activeLedgerKey && !loading && categoryRows.length > 0 && <p role="status">尚未選擇商品分類</p>}

      {loadFailed && (
        <p className="rounded-md px-3 py-2 text-sm border! border-danger-border! bg-danger-soft! text-danger!" role="alert"
          >
          載入失敗，目前顯示上次載入的資料。請重新整理後再操作。
        </p>
      )}

      {!formOpen && assistedOrderDraftRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 border! border-border! bg-elevated!"
          >
          <p className="text-sm text-fg-secondary!">
            尚有 {assistedOrderDraftRows.length} 位同學、{assistedOrderDraftRows.reduce((count, row) => count + row.items.length, 0)} 項商品待送出
          </p>
          <button type="button" onClick={openCreate} className="btn btn-ghost min-h-11 px-3 text-xs">
            繼續登記
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <nav className="shop-task-switch w-full min-w-0 sm:w-auto sm:flex-1" aria-label="班代工作">
        {([
          ["order", "幫同學訂購"], ["collect", "登記收款"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={workspace === key}
            onClick={() => { setWorkspace(key); if (key === "order") setFormOpen(true); }}>
            {label}
          </button>
        ))}
      </nav>
      </div>

      <details className="shop-class-tools">
        <summary className="min-h-11 cursor-pointer py-3 text-sm text-fg-secondary!">訂單查詢與其他工具</summary>
        <div className="space-y-3 pb-4">
          <button type="button" className="btn btn-ghost min-h-11 text-sm"
            aria-pressed={workspace === "details"} onClick={(event) => {
              setWorkspace("details");
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}>
            查詢／修改訂單
          </button>
          <details>
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">追加訂單與補收款</summary>
            {myClassId && activeLedgerKey && <SupplementOrders key={activeLedgerKey} categoryKey={activeLedgerKey} canRejoin onRejoined={() => { void load(); }} />}
          </details>
          <details>
            <summary className="min-h-11 cursor-pointer py-3 text-sm">加購與繳款說明</summary>
            <p className="max-w-prose text-sm text-fg-secondary!">
              班聯結單或統一截止後停止代購；繳款後追加由同學自行補繳。
            </p>
          </details>
        </div>
      </details>

      {workspace === "details" && activeLedgerKey && (
        <label className="flex flex-wrap items-center gap-3 text-sm font-medium">
          整理商品分類
          <select className="input min-h-11 w-full sm:w-auto" aria-label="整理商品分類" value={categoryFilter}
            onChange={(event) => { setCategoryFilter(event.target.value); setProductFilter(""); setSelectedIds([]); }}>
            <option value="all">目前分類全部商品</option>
            {filterCategoryRows.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
          </select>
          <span className="text-fg-muted!">商品統計與訂單清單依所選商品分類整理</span>
        </label>
      )}

      {submitMessage && <p role="status" className="rounded-md p-3 text-sm bg-elevated!">{submitMessage}</p>}
      {workspace === "order" && catalogFailed && (
        <p role="alert">無法載入可訂購商品。<button type="button" className="btn btn-ghost min-h-11" onClick={() => window.location.reload()}>重新載入</button></p>
      )}
      {workspace === "order" && (formOpen || hasCurrentComposerInput) && activeLedgerKey && (
        <section id="class-order-form" className="scroll-mt-5 rounded-lg p-4 border! border-border! bg-card!">
          {editOrder && <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg-primary!">
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
              setBatchStudentIds([]);
              setOrderProductId("");
              setOrderProductSearch("");
              setQuantity(1);
              setOptionIds({});
              setNotes("");
              setAssistedItems([]);
            }}
              className="min-h-11 min-w-11 text-fg-muted!"  aria-label="關閉下單表單">
              <X size={15} />
            </button>
          </div>}
          {(editOrder || composerCategoryKey) && <p className="mb-3 text-sm text-fg-secondary!">
            {editOrder ? "修改品項與數量後儲存。" : `目前代訂 ${categoryRows.find((row) => row.key === composerCategoryKey)?.label ?? "所選分類"}`}
          </p>}
          {!editOrder && <div className="mb-5">
            <ol className="shop-order-steps" aria-label="代訂步驟">
              {["選同學", "選商品", "確認送出"].map((label, index) => {
                const step = !recipientIds.length ? 0 : currentDraftItemCount > 0 && !hasIncompleteCurrentItem ? 2 : 1;
                return <li key={label} aria-current={step === index ? "step" : undefined}>
                  <span aria-hidden="true">{index + 1}</span>{label}
                </li>;
              })}
            </ol>
            <h2 className="mt-4 text-lg font-semibold text-fg-primary!">
              {!recipientIds.length ? "先選一位同學" : "替同學選商品，確認後送出"}
            </h2>
          </div>}
          {!editOrder && (
            <details className="mb-4">
            <summary className="min-h-11 cursor-pointer py-3 text-sm text-fg-secondary!">
              {recipientMode === "batch" ? "正在幫多人訂購相同商品" : "要幫多人訂購相同商品？"}
            </summary>
            <div className="flex flex-wrap gap-2 pb-3" role="group" aria-label="代訂方式">
              <button type="button" aria-pressed={recipientMode === "single"}
                disabled={creating || currentDraftItemCount > 0 || Boolean(orderProductId) || Boolean(notes.trim())}
                onClick={() => {
                  setRecipientMode("single");
                  setStudentId("");
                  setBatchStudentIds([]);
                  setOrderProductSearch("");
                }}
                className="min-h-11 rounded-md px-3 text-sm font-medium disabled:opacity-50"
                style={recipientMode === "single"
                  ? { border: "1px solid var(--border-strong)", background: "var(--primary-dim)", color: "var(--primary-text)" }
                  : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                逐位代訂
              </button>
              <button type="button" aria-pressed={recipientMode === "batch"}
                disabled={creating || currentDraftItemCount > 0 || Boolean(orderProductId) || Boolean(notes.trim())}
                onClick={() => {
                  setRecipientMode("batch");
                  setStudentId("");
                  setBatchStudentIds([]);
                  setRecipientFilter("");
                  setOrderProductSearch("");
                }}
                className="min-h-11 rounded-md px-3 text-sm font-medium disabled:opacity-50"
                style={recipientMode === "batch"
                  ? { border: "1px solid var(--border-strong)", background: "var(--primary-dim)", color: "var(--primary-text)" }
                  : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                批次給多人
              </button>
            </div>
            </details>
          )}
          {(editOrder || recipientMode === "single") && (
            <section className="mb-5" aria-label="訂購同學">
              {studentId ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-semibold text-fg-primary!">
                    {selectedStudent?.seat_number != null && <span className="mr-2 tabular-nums">{selectedStudent.seat_number} 號</span>}
                    {selectedStudent?.display_name ?? orders.find((order) => order.id === editOrder?.id)?.user_name ?? "訂購同學"}
                  </p>
                  {selectedStudent?.user_id && <Link
                    href={{
                      pathname: "/shop",
                      query: {
                        class_member_user_id: selectedStudent.user_id,
                        class_member_name: selectedStudent.display_name,
                      },
                    }}
                    className="btn btn-ghost min-h-11 text-sm"
                  >
                    到商品頁調整總量
                  </Link>}
                  {!editOrder && <button type="button" className="btn btn-ghost min-h-11 text-sm"
                    disabled={creating} onClick={() => {
                      setStudentId("");
                      setRecipientFilter("");
                      setOrderProductId("");
                      setOrderProductSearch("");
                      setAssistedItems([]);
                      setOptionIds({});
                      setQuantity(1);
                      setNotes("");
                    }}>
                    {assistedItems.length > 0 || orderProductId || notes.trim() ? "清空並重選同學" : "更換同學"}
                  </button>}
                </div>
              ) : (
                <>
                  <label className="mb-3 grid max-w-lg gap-2 text-sm">
                    <span className="font-semibold">替哪位同學訂購？</span>
                    <input type="search" className="input min-h-11" placeholder="搜尋座號或姓名，或直接點選下方名冊"
                      aria-label="搜尋同學" value={recipientFilter}
                      onChange={(event) => setRecipientFilter(event.target.value)}
                      disabled={creating || membersLoading || membersLoadFailed} />
                  </label>
                  <div className="shop-seat-picker" role="group" aria-label="同學搜尋結果">
                    {membersLoading ? <p role="status">正在載入本班名冊…</p>
                      : membersLoadFailed ? <p role="alert">無法載入本班名冊，請重新整理後再試。</p>
                      : members.length === 0 ? <p role="status">目前沒有本班名冊，請聯絡班聯會確認班級與座號資料。</p>
                      : filteredRecipients.length === 0 ? <p role="status">找不到符合的同學，請換個座號或姓名。</p>
                      : filteredRecipients.map((member) => (
                        <button type="button" key={member.id} disabled={creating}
                          onClick={() => { setStudentId(member.id); setRecipientFilter(""); }}>
                          <strong>{member.seat_number == null ? "未編座號" : `${member.seat_number} 號`}</strong>
                          <span>{member.display_name}</span>
                        </button>
                      ))}
                  </div>
                </>
              )}
            </section>
          )}
          {!editOrder && recipientMode === "batch" && (
            <fieldset disabled={creating || membersLoading || membersLoadFailed || currentDraftItemCount > 0 || Boolean(orderProductId)}
              className="mb-5 grid min-w-0 gap-3 rounded-md p-3 border! border-border! bg-elevated!"
              >
              <legend className="px-1 text-sm font-semibold text-fg-primary!">一次套用給多位同學</legend>
              {membersLoading ? (
                <p role="status" className="text-sm text-fg-muted!">正在載入本班名冊...</p>
              ) : membersLoadFailed ? (
                <p role="alert" className="text-sm text-danger!">無法載入本班名冊，請重新整理後再試。</p>
              ) : members.length === 0 ? (
                <p role="status" className="text-sm text-fg-muted!">本班名冊目前沒有可選的學生。</p>
              ) : (
                <>
                  <label className="grid max-w-lg gap-1 text-sm">
                    <span className="text-fg-secondary!">搜尋座號或姓名</span>
                    <input className="input min-h-11" type="search" value={recipientFilter}
                      onChange={(event) => setRecipientFilter(event.target.value)} placeholder="例如：12 或 王小明" />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn btn-ghost min-h-11 px-3 text-sm"
                      disabled={filteredRecipients.length === 0}
                      aria-pressed={hasAllVisibleRecipients}
                      onClick={() => setBatchStudentIds((current) => hasAllVisibleRecipients
                        ? current.filter((id) => !filteredRecipients.some((member) => member.id === id))
                        : [...new Set([...current, ...filteredRecipients.map((member) => member.id)])])}>
                      {hasAllVisibleRecipients ? "取消選取顯示的同學" : "選取顯示的 " + filteredRecipients.length + " 位"}
                    </button>
                    <button type="button" className="btn btn-ghost min-h-11 px-3 text-sm"
                      disabled={batchStudentIds.length === 0} onClick={() => setBatchStudentIds([])}>
                      清除選取
                    </button>
                    <span role="status" className="text-sm font-medium text-accent-text!">
                      已選 {batchStudentIds.length} 位同學
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-md border! border-border! bg-card!"
                    role="group" aria-label="批次代訂同學名單"
                    >
                    {filteredRecipients.length === 0 ? (
                      <p role="status" className="px-3 py-4 text-sm text-fg-muted!">找不到符合的同學，請調整搜尋內容。</p>
                    ) : (
                      <ul className="divide-y border-border!">
                        {filteredRecipients.map((member) => (
                          <li key={member.id}>
                            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                              <input type="checkbox" checked={batchStudentIds.includes(member.id)}
                                onChange={() => setBatchStudentIds((current) => current.includes(member.id)
                                  ? current.filter((id) => id !== member.id)
                                  : [...current, member.id])} />
                              <span className="tabular-nums text-fg-muted!">
                                {member.seat_number == null ? "未編座號" : member.seat_number + " 號"}
                              </span>
                              <span className="font-medium text-fg-primary!">{member.display_name}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </fieldset>
          )}
          {recipientIds.length > 0 && <>
          {(!editOrder || editProductsOpen) && <>
          <h3 className="mb-3 text-sm font-semibold text-fg-primary!">選商品與規格</h3>
          {!purchaseOptionsReady && <p role={purchaseOptionsFailed ? "alert" : "status"} className="mb-3 text-sm">
            {purchaseOptionsFailed ? "無法確認同學的購買資格，請重新載入。" : "正在確認同學可訂購的商品…"}
            {purchaseOptionsFailed && <button type="button" className="btn btn-ghost min-h-11 ml-2" onClick={() => setPurchaseOptionsRetry((value) => value + 1)}>重新確認購買資格</button>}
          </p>}
          {recipientMode === "batch" && purchaseOptionsReady && <p className="mb-3 text-sm text-fg-muted!">只顯示所有已選同學都能訂購的商品。</p>}
          <fieldset ref={productOptionsRef} disabled={creating || catalogFailed || !purchaseOptionsReady || !recipientIds.length || membersLoading || membersLoadFailed} className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <legend className="sr-only">加入商品與規格</legend>
            <div className="grid min-w-0 gap-2 sm:col-span-2 xl:col-span-3">
              {!orderProductId && <>
              <label className="grid max-w-xl gap-1 text-sm">
                <span className="text-fg-muted!">搜尋商品</span>
                <input ref={productSearchRef} className="input min-h-11" type="search" value={orderProductSearch}
                  onChange={(event) => setOrderProductSearch(event.target.value)}
                  placeholder="輸入關鍵字篩選，或直接選擇商品" />
              </label>
              <div className="max-h-56 overflow-y-auto rounded-md border! border-border! bg-card!"
                role="group" aria-label="商品搜尋結果"
                >
                {orderProductResults.length === 0 ? (
                  <p role="status" className="px-3 py-4 text-sm text-fg-muted!">
                    {orderProductSearch.trim()
                      ? "找不到符合的商品，請試試商品名稱、分類或系列。"
                      : "目前沒有符合所選同學資格的可訂商品。"}
                  </p>
                ) : (
                  <ul className="divide-y border-border!">
                    {orderProductResults.map((product) => (
                      <li key={product.id}>
                        <button type="button" aria-pressed={orderProductId === product.id}
                          onClick={() => {
                            setVariantSearches({});
                            setOptionIds({});
                            setOrderProductId(product.id);
                          }}
                          className="flex min-h-12 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                          style={orderProductId === product.id
                            ? { background: "var(--primary-dim)", color: "var(--primary-text)" }
                            : { color: "var(--text-primary)" }}>
                          <span className="font-medium">{product.name}</span>
                          <span className="text-xs text-fg-secondary!">
                            {product.category} / {product.series} · {money(product.price)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {orderProductResults.length > 12 && (
                <p role="status" className="text-xs text-fg-muted!">
                  共 {orderProductResults.length} 項可訂商品
                </p>
              )}
              </>}
              {selectedOrderProduct && (
                <div className="flex items-center justify-between gap-3">
                <p role="status" className="text-sm font-medium text-accent-text!">
                  {selectedOrderProduct.name} · {money(currentUnitPrice)} / 件
                </p>
                <button type="button" className="btn btn-ghost min-h-11 shrink-0 text-sm"
                  onClick={() => { setOrderProductId(""); setOptionIds({}); setVariantSearches({}); }}>換商品</button>
                </div>
              )}
              {orderProductId && !productDetail && <p role={productDetailFailed ? "alert" : "status"} className="text-sm">
                {productDetailFailed ? "無法載入商品規格，請點「換商品」重新選擇。" : "正在載入商品規格…"}
              </p>}
              {productDetail?.purchase_allowed === false && !editOrder && <p role="alert">{productDetail.purchase_restriction ?? "此同學目前無法訂購此商品，請重新選擇。"}</p>}
            </div>
            {productDetail?.variant_groups.map((group) => {
              const options = group.options.filter((option) => option.is_active);
              const searchableOptions = options.length > 12;
              const optionNeedle = (variantSearches[group.id] ?? "").trim().toLocaleLowerCase("zh-Hant");
              const visibleOptions = searchableOptions
                ? optionNeedle
                  ? options.filter((option) => option.value.toLocaleLowerCase("zh-Hant").includes(optionNeedle)).slice(0, 12)
                  : []
                : options;
              return (
                <fieldset key={group.id} className="grid min-w-0 gap-1 text-sm">
                  <legend className="mb-1 text-fg-muted!">{group.name}</legend>
                  {options.length > 0 ? (
                    <>
                      {searchableOptions && (
                        <label className="grid max-w-xl gap-1">
                          <span className="sr-only">搜尋{group.name}</span>
                          <input className="input min-h-11" type="search" value={variantSearches[group.id] ?? ""}
                            onChange={(event) => setVariantSearches((current) => ({ ...current, [group.id]: event.target.value }))}
                            placeholder={`搜尋${group.name}（${options.length} 個規格）`} />
                        </label>
                      )}
                      {searchableOptions && !optionNeedle && (
                        <p role="status" className="text-xs text-fg-muted!">
                          輸入規格關鍵字後選擇；目前已選：{options.find((option) => option.id === optionIds[group.id])?.value ?? "尚未選擇"}
                        </p>
                      )}
                      {searchableOptions && optionNeedle && visibleOptions.length === 0 && (
                        <p role="status" className="text-xs text-fg-muted!">找不到符合的規格，請調整搜尋內容。</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                      {visibleOptions.map((option) => {
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
                                ? { border: "1px solid var(--border-strong)", background: "var(--primary-dim)", color: "var(--primary-text)" }
                                : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                              {option.value}
                              {option.price_delta !== 0 && (
                                <span className="text-xs tabular-nums text-fg-muted!">
                                  {option.price_delta > 0 ? "+" : "−"}{money(Math.abs(option.price_delta))}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                      </div>
                      {searchableOptions && optionNeedle && options.filter((option) => option.value.toLocaleLowerCase("zh-Hant").includes(optionNeedle)).length > 12 && (
                        <p role="status" className="text-xs text-fg-muted!">
                          符合多於 12 個規格，請輸入更多關鍵字縮小範圍。
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-fg-muted!" role="status" >
                      目前沒有可選規格，請通知商品管理者。
                    </p>
                  )}
                </fieldset>
              );
            })}
            {orderProductId && <label className="grid max-w-32 gap-1 text-sm">
              <span className="text-fg-muted!">{recipientMode === "batch" ? "每位數量" : "數量"}</span>
              <NumberInput className="input min-h-11" type="number" min={1} max={quantityLimit} value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(quantityLimit, Number(e.target.value) || 1)))} />
            </label>}
            {orderProductId && selectedOrderProduct?.purchase_group && <p role="status" className="text-sm">同組商品每人限購一張</p>}
            {orderProductId && <div className="flex items-end sm:col-span-2 xl:col-span-3">
              <button type="button" onClick={addCurrentProduct}
                disabled={!currentItemReady || creating}
                className="btn btn-ghost min-h-11 w-full disabled:opacity-50 sm:w-auto">
                <Plus size={14} /> 加入清單，繼續選商品
              </button>
            </div>}
          </fieldset>
          </>}
          {editOrder && !editProductsOpen && orderProductId && !productDetail && <p role={productDetailFailed ? "alert" : "status"} className="text-sm">
            {productDetailFailed ? "無法載入訂單品項，請重新整理後再試。" : "正在載入訂單品項…"}
          </p>}
          {(assistedItems.length > 0 || (editOrder && orderProductId && currentItemReady)) && (
            <div className="mt-4 rounded-md border! border-border!">
              <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-b! border-b-border! bg-elevated!"
                >
                <h3 className="text-xs font-semibold text-fg-secondary!">
                  {recipientMode === "batch"
                    ? recipientIds.length + " 位同學的商品清單"
                    : (selectedStudent?.display_name ?? "這位同學") + "的商品清單"}
                </h3>
                <span className="text-xs tabular-nums text-fg-muted!">
                  {recipientMode === "batch"
                    ? "每人 " + money(assistedTotal) + " · " + recipientIds.length + " 位合計 " + money(assistedTotal * recipientIds.length)
                    : currentComposerItems().length + " 項 · 商品小計 " + money(assistedTotal)}
                </span>
              </div>
              <ul className="divide-y border-border!">
                {currentComposerItems().map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                    <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                      <p className="break-words text-sm font-medium text-fg-primary!">{item.product_name}</p>
                      <p className="mt-0.5 text-xs text-fg-secondary!">
                        {categoryLabel(item.scope_key)} · {item.option_label || "標準規格"} · {money(item.unit_price)} / 件
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      {recipientMode === "batch" ? "每人數量" : "數量"}
                      <NumberInput className="input min-h-11 w-20 text-center tabular-nums" type="number" min={1} max={catalogProducts.find((product) => product.id === item.product_id)?.purchase_group ? 1 : 100}
                        disabled={creating} value={item.quantity} aria-label={recipientMode === "batch" ? "每人" + item.product_name + "數量" : item.product_name + "數量"}
                        onChange={(event) => updateComposerItem(item, Math.max(1, Math.min(100, Number(event.target.value) || 1)))} />
                    </label>
                    <strong className="text-right text-sm tabular-nums">
                      {recipientMode === "batch"
                        ? "每人 " + money(item.quantity * item.unit_price)
                        : money(item.quantity * item.unit_price)}
                    </strong>
                    <button type="button" disabled={creating} onClick={() => updateComposerItem(item, 0)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md"
                      aria-label={`移除${item.product_name}`}><X size={15} /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {editOrder && !editProductsOpen && <button type="button" className="btn btn-ghost mt-3 min-h-11 text-sm"
            disabled={creating || Boolean(orderProductId && !currentItemReady)}
            onClick={() => {
              setAssistedItems(currentComposerItems());
              setOrderProductId("");
              setOptionIds({});
              setQuantity(1);
              setEditProductsOpen(true);
            }}><Plus size={14} /> 新增商品</button>}
          <details className="mt-3" key={editOrder?.id ?? studentId} open={notes.trim() ? true : undefined}>
            <summary className="min-h-11 cursor-pointer py-3 text-sm text-fg-secondary!">備註（選填）</summary>
          <label className="grid gap-1 text-sm">
            <span className="text-fg-muted!">
              {recipientMode === "batch" ? "備註（所有同學相同）" : "備註"}
            </span>
            <input className="input min-h-11" disabled={creating || !recipientIds.length} value={notes} maxLength={500}
              onChange={(event) => setNotes(event.target.value)} placeholder="尺寸確認等" />
          </label>
          </details>
          </>}
          {(currentDraftItemCount > 0 || assistedOrderDrafts.length > 0 || editOrder) && <div className="shop-composer-actions mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
            data-pending={pendingDraftStudentCount > 0 || Boolean(editOrder)}>
            {!editOrder && (
              <button type="button" onClick={queueCurrentDraft}
                disabled={!canQueueCurrentDraft || creating || catalogFailed}
                className="btn btn-ghost min-h-11 disabled:opacity-50">
                {recipientMode === "batch" ? "加入待送出，設定下一組" : "加入待送出，登記下一位"}
              </button>
            )}
            <button type="button" onClick={submitOrder}
              disabled={creating || catalogFailed || membersLoading || membersLoadFailed || !myClassId || (editOrder
                ? currentDraftItemCount === 0 || !studentId
                : pendingDraftStudentCount === 0
                  || hasIncompleteCurrentItem
                  || (currentDraftItemCount > 0 && !recipientIds.length))}
              className="btn min-h-11 whitespace-normal disabled:opacity-50 bg-accent! text-accent-foreground! border-0!"
              >
              {creating ? "處理中..." : editOrder
                ? `儲存修改 · 小計 ${money(assistedTotal)}`
                : assistedOrderDrafts.length > 0
                  ? `送出待送出清單（${pendingDraftStudentCount} 位）· 小計 ${money(pendingDraftSubtotal)}`
                  : recipientMode === "batch" && recipientIds.length > 0
                    ? "送出" + recipientIds.length + " 位同學的訂單 · 小計 " + money(assistedTotal * recipientIds.length)
                    : "送出" + (selectedStudent ? selectedStudent.display_name + "的" : "") + "訂單 · 小計 " + money(assistedTotal)}
            </button>
          </div>}
          <AssistedOrderDraftList
            rows={assistedOrderDraftRows}
            creating={creating}
            hasCurrentComposerInput={hasCurrentComposerInput}
            onLoadDraft={loadAssistedDraft}
            onRemoveDraft={(id) => setAssistedOrderDrafts((drafts) => drafts.filter((draft) => draft.id !== id))}
          />

          {membersLoading && (
            <p className="mt-3 text-sm text-fg-muted!" role="status" >正在載入本班名冊...</p>
          )}
          {!membersLoading && membersLoadFailed && (
            <p className="mt-3 text-sm text-danger!" role="alert" >無法載入本班名冊，請重新整理頁面；若問題持續，請洽系統管理員。</p>
          )}
          {!membersLoading && !membersLoadFailed && !myClassId && (
            <p className="mt-3 text-sm text-danger!" role="alert" >找不到你任職的班級，暫時無法建立代訂。</p>
          )}
          {!membersLoading && !membersLoadFailed && myClassId && members.length === 0 && (
            <p className="mt-3 text-sm text-fg-muted!" role="status" >本班名冊目前沒有可選的學生。</p>
          )}
        </section>
      )}

      {collectionConfirmation && <Modal title={collectionConfirmation.collected ? "核對同學收款" : "撤銷同學收款"}
        size="sm" mobileFullscreen={false} onClose={() => { if (!collectionSubmitting.current) setCollectionConfirmation(null); }}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
          <dt>收款明細</dt><dd className="space-y-2">{collectionConfirmation.categories.map((category) => <p key={category.label} className="flex flex-wrap justify-between gap-x-3"><strong>{category.label}</strong><span className="tabular-nums">{money(category.amount)}</span></p>)}</dd>
          <dt>同學</dt><dd>{collectionConfirmation.name}</dd>
          <dt>{collectionConfirmation.collected ? "本次合計" : "撤銷合計"}</dt>
          <dd className="text-lg font-semibold tabular-nums">{money(collectionConfirmation.amount)}</dd>
        </dl>
        <p className="mt-4 text-sm text-fg-secondary!">只登記上列商品分類的款項。</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost min-h-11" disabled={busy !== null}
            onClick={() => setCollectionConfirmation(null)}>返回核對</button>
          <button type="button" className="btn btn-primary min-h-11" disabled={busy !== null}
            onClick={() => void confirmSeatCollection()}>{busy !== null ? "處理中…" : collectionConfirmation.collected ? "確認收到款項" : "確認撤銷收款"}</button>
        </div>
      </Modal>}
      <div hidden={workspace !== "collect"} className="space-y-5">
        <ClassOrderCollectionPanel
          categoryRows={categoryRows}
          ledgerCategories={ledgerCategories}
          ledgerCategoryLabel={ledgerCategoryLabel}
          loading={loading}
          loadFailed={loadFailed}
          seatCollectionTotals={seatCollectionTotals}
          seatSearch={seatSearch}
          setSeatSearch={setSeatSearch}
          seatFilter={seatFilter}
          setSeatFilter={setSeatFilter}
          membersLoading={membersLoading}
          membersLoadFailed={membersLoadFailed}
          filteredSeatRows={filteredSeatRows}
          members={members}
          busy={busy}
          batchBusy={batchBusy}
          setSeatCollected={setSeatCollected}
          openCreateForSeat={openCreateForSeat}
        />

      </div>

      <div hidden={workspace !== "details" || !activeLedgerKey} className="space-y-5">

      <div className="space-y-5">
        {/* 訂單列表 */}
        <ClassOrdersListPanel
          selectedCategoryLabel={selectedCategoryLabel}
          visibleOrders={visibleOrders}
          query={query}
          setQuery={setQuery}
          members={members}
          memberFilter={memberFilter}
          setMemberFilter={setMemberFilter}
          paidFilter={paidFilter}
          setPaidFilter={setPaidFilter}
          assistedFilter={assistedFilter}
          setAssistedFilter={setAssistedFilter}
          productFilter={productFilter}
          setProductFilter={setProductFilter}
          setCategoryFilter={(value) => { setCategoryFilter(value); setProductFilter(""); setSelectedIds([]); }}
          categoryFilter={categoryFilter}
          productFilterOptions={productFilterOptions}
          filterCategoryRows={filterCategoryRows}
          clearFilters={clearFilters}
          selectablePageOrders={selectablePageOrders}
          allVisibleSelected={allVisibleSelected}
          setSelectedIds={setSelectedIds}
          selectedOrders={selectedOrders}
          selectedCategoryGroups={selectedCategoryGroups}
          batchBusy={batchBusy}
          batchSetPaid={batchSetPaid}
          loading={loading}
          openCreate={openCreate}
          pageOrders={pageOrders}
          categoryLabel={categoryLabel}
          togglePaid={togglePaid}
          busy={busy}
          selectedSet={selectedSet}
          openEdit={openEdit}
          load={load}
          onCancelOrder={(order) => { setCancelTarget(order); setCancelReason(""); }}
          currentPage={currentPage}
          pageCount={pageCount}
          setOrderPage={setOrderPage}
          orderListPageSize={ORDER_LIST_PAGE_SIZE}
        />

      </div>

      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-fg-secondary!">商品統計</summary>
      <section aria-labelledby="product-collection-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="product-collection-heading" className="text-lg font-semibold text-fg-primary!">商品收款明細 · {selectedCategoryLabel}</h2>
          <p className="text-xs text-fg-muted!">收款紀錄代表班代已向同學收款；整班繳款由班聯會確認。</p>
        </div>
        {loading && productSummary.product_rows.length === 0 ? (
          <p className="rounded-lg px-4 py-8 text-center text-sm border! border-border! text-fg-muted!">
            正在載入商品收款狀況...
          </p>
        ) : loadFailed && productSummary.product_rows.length === 0 ? (
          <p className="rounded-lg px-4 py-8 text-center text-sm border! border-danger-border! bg-danger-soft! text-danger!" role="alert"
            >
            無法載入商品收款狀況，請重新整理後再試。
          </p>
        ) : productRows.length === 0 ? (
          <div className="rounded-lg px-4 py-8 text-center border! border-border! bg-elevated!">
            <p className="text-sm font-medium text-fg-primary!">目前沒有可追蹤的商品</p>
            <p className="mt-1 text-sm text-fg-muted!">商品開放或有新登記後，收款進度會顯示在這裡。</p>
            {activeProducts.length > 0 && (
              <button type="button" onClick={openCreate} className="btn btn-ghost mt-3 min-h-11">替同學下單</button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border! border-border! bg-card!">
            <div className="divide-y md:hidden border-border!">
              {productRows.map((row) => {
                const orderCount = row.collected_order_count + row.uncollected_order_count;
                return (
                  <article key={row.product_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 break-words text-sm font-semibold text-fg-primary!">{row.product_name}</h3>
                      <span className="shrink-0 text-xs tabular-nums text-fg-muted!">{row.quantity} 件</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div><p className="text-fg-muted!">應收</p><p className="mt-0.5 font-medium tabular-nums text-fg-primary!">{money(row.total_amount)}</p></div>
                      <div><p className="text-fg-muted!">已收</p><p className="mt-0.5 font-medium tabular-nums text-success!">{money(row.collected_amount)}</p></div>
                      <div><p className="text-fg-muted!">待收</p><p className="mt-0.5 font-medium tabular-nums text-warning!">{money(row.uncollected_amount)}</p></div>
                    </div>
                    <button type="button" onClick={() => showProductCollection(row.product_id, row.uncollected_order_count > 0)}
                      className="mt-2 min-h-11 w-full rounded-md px-3 text-left text-xs font-medium border! border-border! text-accent-text!"
                      >
                      {row.uncollected_order_count ? `查看 ${row.uncollected_order_count} 筆待收訂單` : `查看 ${orderCount} 筆訂單`}
                    </button>
                  </article>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm" aria-label="各商品訂購與收款金額">
                <thead>
                  <tr className="border-b! border-b-border! bg-elevated!">
                    {["商品", "件數／訂單", "應收總額", "已收", "待收", ""].map((heading) => (
                      <th key={heading || "action"} scope="col" className="px-4 py-3 text-left text-xs font-semibold text-fg-muted!"
                        >{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productRows.map((row) => {
                    const orderCount = row.collected_order_count + row.uncollected_order_count;
                    return (
                      <tr key={row.product_id}  className="border-b! border-b-border!">
                        <th scope="row" className="max-w-xs px-4 py-3 text-left font-medium text-fg-primary!">{row.product_name}</th>
                        <td className="px-4 py-3 text-xs tabular-nums text-fg-secondary!">{row.quantity} 件 · {orderCount} 筆</td>
                        <td className="px-4 py-3 font-semibold tabular-nums text-fg-primary!">{money(row.total_amount)}</td>
                        <td className="px-4 py-3 tabular-nums text-success!">{money(row.collected_amount)}</td>
                        <td className="px-4 py-3 tabular-nums text-warning!">{money(row.uncollected_amount)}</td>
                        <td className="px-4 py-2 text-right">
                          <button type="button" onClick={() => showProductCollection(row.product_id, row.uncollected_order_count > 0)}
                            className="min-h-11 rounded-md px-3 text-xs font-medium border! border-border! text-accent-text!"
                            >
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
      </details>

      </div>

      {/* 取消訂單 Modal */}
      {cancelTarget && (
        <Modal
          title="確認取消訂單"
          size="md"
          onClose={() => setCancelTarget(null)}
          footer={
            <>
              <button type="button" onClick={() => setCancelTarget(null)} className="btn btn-ghost">返回</button>
              <button type="button" onClick={confirmCancel} disabled={busy === cancelTarget.id} className="btn btn-danger">
                {busy === cancelTarget.id ? "取消中…" : "確認取消訂單"}
              </button>
            </>
          }>
          <p className="mb-4 text-sm text-fg-secondary!">
            訂單 <span className="font-mono font-semibold">{cancelTarget.serial_number}</span>（{cancelTarget.user_name}）
            取消後將退回庫存，無法復原。
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-fg-muted!">取消原因（選填）</span>
            <input className="input w-full" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="填寫取消原因" />
          </label>
        </Modal>
      )}
    </div>
  );
}
