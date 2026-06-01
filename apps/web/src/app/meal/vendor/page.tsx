"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Edit3,
  PackagePlus,
  Plus,
  QrCode,
<<<<<<< HEAD
=======
  Search,
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
  Settings,
  Store,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
<<<<<<< HEAD
import { UserPicker } from "@/components/meal/UserPicker";
import { mealApi, type UserSummary } from "@/lib/api";
=======
import { mealApi, usersApi, type UserSummary } from "@/lib/api";
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
import type {
  MealAvailabilityOut,
  MealOrderListItem,
  MealPickupLookupOut,
  MealProductOut,
  MealVendorOut,
  VendorManagerOut,
} from "@/lib/types";
import {
  addDays,
  combineDateTime,
  datetimeLocal,
  eachDate,
  money,
  orderLabel,
  quickPickupSlots,
  statusLabel,
  today,
  toIso,
  weekdayIndex,
  type QuickPickupSlot,
} from "@/lib/mealVendorUtils";

type VendorTab = "overview" | "products" | "availability" | "orders" | "pickup" | "settings";
type ProductForm = {
  name: string;
  category: string;
  price: string;
  default_max_quantity: string;
  unlimited: boolean;
  image_url: string;
  description: string;
};
type AvailabilityForm = {
  mode: "single" | "bulk" | "permanent";
  product_ids: string[];
  service_date: string;
  date_from: string;
  date_to: string;
  weekdays: number[];
  price: string;
  max_quantity: string;
  max_unlimited: boolean;
  note: string;
  sale_start: string;
  sale_end: string;
  selected_slot_labels: string[];
  slot_label: string;
  pickup_start_time: string;
  pickup_end_time: string;
  order_deadline_time: string;
  capacity: string;
  capacity_unlimited: boolean;
};

const tabs: { key: VendorTab; label: string; icon: typeof Store }[] = [
  { key: "overview", label: "總覽", icon: Store },
  { key: "products", label: "商品", icon: PackagePlus },
  { key: "availability", label: "上架", icon: CalendarDays },
  { key: "orders", label: "訂單", icon: ClipboardList },
  { key: "pickup", label: "核銷", icon: QrCode },
  { key: "settings", label: "設定", icon: Settings },
];

<<<<<<< HEAD
=======
const statusLabel: Record<string, string> = {
  pending_review: "待審",
  approved: "已通過",
  rejected: "已退回",
  suspended: "已停用",
};

const orderLabel: Record<string, string> = {
  pending: "待確認",
  confirmed: "已確認",
  cancelled: "已取消",
  completed: "已完成",
};

type QuickPickupSlot = {
  label: string;
  start: string;
  end: string;
  deadline: string;
};

const quickPickupSlots: QuickPickupSlot[] = [
  { label: "第1節下課", start: "08:50", end: "09:10", deadline: "08:20" },
  { label: "第2節下課", start: "10:00", end: "10:10", deadline: "09:30" },
  { label: "第3節下課", start: "11:00", end: "11:10", deadline: "10:30" },
  { label: "午餐／午休", start: "12:00", end: "13:05", deadline: "11:30" },
  { label: "第5節下課", start: "13:55", end: "14:05", deadline: "13:25" },
  { label: "第6節下課", start: "14:55", end: "15:10", deadline: "14:25" },
  { label: "第7節下課", start: "16:00", end: "16:10", deadline: "15:30" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function datetimeLocal(date: string, time: string) {
  return `${date}T${time}`;
}

function eachDate(from: string, to: string) {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function weekdayIndex(dateString: string) {
  const day = new Date(`${dateString}T00:00:00`).getDay();
  return day === 0 ? 6 : day - 1;
}

function combineDateTime(dateString: string, timeString: string) {
  return new Date(datetimeLocal(dateString, timeString)).toISOString();
}

function money(value: number) {
  return `NT$ ${value.toLocaleString("zh-TW")}`;
}

function UserPicker({
  placeholder,
  onPick,
}: {
  placeholder: string;
  onPick: (user: UserSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      usersApi
        .listForSearch(query.trim())
        .then((items) => setResults(items.slice(0, 8)))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md px-3 py-2"
        style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <Search size={15} style={{ color: "var(--text-muted)" }} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full bg-transparent text-sm outline-none"
          placeholder={placeholder}
          style={{ color: "var(--text-primary)" }}
        />
      </div>
      {(results.length > 0 || loading) && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md"
          style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          {loading && <div className="px-3 py-2 text-xs text-muted">搜尋中...</div>}
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                onPick(user);
                setQuery("");
                setResults([]);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
              style={{ color: "var(--text-primary)" }}
            >
              <span className="font-medium">{user.display_name}</span>
              <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                {user.email}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
export default function VendorAdminPage() {
  const [tab, setTab] = useState<VendorTab>("overview");
  const [vendors, setVendors] = useState<MealVendorOut[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [products, setProducts] = useState<MealProductOut[]>([]);
  const [availabilities, setAvailabilities] = useState<MealAvailabilityOut[]>([]);
  const [orders, setOrders] = useState<MealOrderListItem[]>([]);
  const [managers, setManagers] = useState<VendorManagerOut[]>([]);
  const [loading, setLoading] = useState(true);

  const [showVendorModal, setShowVendorModal] = useState(false);
  const [vendorForm, setVendorForm] = useState({
    name: "",
    description: "",
    contact_phone: "",
    contact_email: "",
  });
  const [initialManager, setInitialManager] = useState<UserSummary | null>(null);
  const [vendorSaving, setVendorSaving] = useState(false);

  const [productForm, setProductForm] = useState<ProductForm>({
    name: "",
    category: "",
    price: "",
    default_max_quantity: "",
    unlimited: true,
    image_url: "",
    description: "",
  });
  const [productSaving, setProductSaving] = useState(false);

  const [availabilityForm, setAvailabilityForm] = useState<AvailabilityForm>({
    mode: "single",
    product_ids: [],
    service_date: today(),
    date_from: today(),
    date_to: addDays(7),
    weekdays: [0, 1, 2, 3, 4],
    price: "",
    max_quantity: "",
    max_unlimited: true,
    note: "",
    sale_start: datetimeLocal(today(), "07:00"),
    sale_end: datetimeLocal(today(), "11:50"),
    selected_slot_labels: ["午餐／午休"],
    slot_label: "中午",
    pickup_start_time: "12:00",
    pickup_end_time: "12:30",
    order_deadline_time: "11:50",
    capacity: "",
    capacity_unlimited: true,
  });
  const [availabilitySaving, setAvailabilitySaving] = useState(false);

  const [managerCandidate, setManagerCandidate] = useState<UserSummary | null>(null);
  const [managerSaving, setManagerSaving] = useState(false);
  const [pickupCode, setPickupCode] = useState("");
  const [pickupResult, setPickupResult] = useState<MealPickupLookupOut | null>(null);
  const [pickupSaving, setPickupSaving] = useState(false);

  const selectedVendor = useMemo(
    () => vendors.find((vendor) => vendor.id === selectedVendorId) ?? null,
    [vendors, selectedVendorId],
  );

  const todayOrders = useMemo(
    () => orders.filter((order) => order.created_at.slice(0, 10) === today()),
    [orders],
  );

  const orderStats = useMemo(() => ({
    total: orders.length,
    today: todayOrders.length,
    paid: orders.filter((order) => order.is_paid).length,
    completed: orders.filter((order) => order.status === "completed").length,
    revenue: orders.reduce((sum, order) => sum + order.total_price, 0),
  }), [orders, todayOrders.length]);

  const loadVendors = useCallback(async () => {
    const data = await mealApi.listVendors({ active_only: false });
    setVendors(data);
    setSelectedVendorId((current) => current || data[0]?.id || "");
  }, []);

  const loadVendorData = useCallback(async (vendorId: string) => {
    const [productItems, availabilityItems, orderItems, managerItems] = await Promise.all([
      mealApi.listProducts({ vendor_id: vendorId, active_only: false, limit: 100 }),
      mealApi.listAvailabilities({
        vendor_id: vendorId,
        date_from: addDays(-7),
        date_to: addDays(14),
        active_only: false,
        limit: 100,
      }),
      mealApi.listOrders({ vendor_id: vendorId, my_only: false, limit: 100 }),
      mealApi.listVendorManagers(vendorId).catch(() => []),
    ]);
    setProducts(productItems);
    setAvailabilities(availabilityItems);
    setOrders(orderItems);
    setManagers(managerItems);
    setAvailabilityForm((current) => ({
      ...current,
      product_ids: current.product_ids
        .filter((id) => productItems.some((product) => product.id === id && product.is_active)),
    }));
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadVendors()
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "商家載入失敗"))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [loadVendors]);

  useEffect(() => {
    if (!selectedVendorId) return;
    loadVendorData(selectedVendorId).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "商家資料載入失敗");
    });
  }, [selectedVendorId, loadVendorData]);

  async function createVendor() {
    if (!vendorForm.name.trim()) {
      toast.error("請輸入商家名稱");
      return;
    }
    setVendorSaving(true);
    try {
      const vendor = await mealApi.createVendor({
        name: vendorForm.name.trim(),
        description: vendorForm.description.trim() || null,
        contact_phone: vendorForm.contact_phone.trim() || null,
        contact_email: vendorForm.contact_email.trim() || null,
        manager_email: initialManager?.email ?? null,
      });
      toast.success(initialManager ? "商家與負責人權限已建立" : "商家已建立");
      setShowVendorModal(false);
      setVendorForm({ name: "", description: "", contact_phone: "", contact_email: "" });
      setInitialManager(null);
      await loadVendors();
      setSelectedVendorId(vendor.id);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "新增商家失敗");
    } finally {
      setVendorSaving(false);
    }
  }

  async function createProduct() {
    if (!selectedVendorId || !productForm.name.trim() || !productForm.price) {
      toast.error("請輸入商品名稱與價格");
      return;
    }
    setProductSaving(true);
    try {
      const product = await mealApi.createProduct({
        vendor_id: selectedVendorId,
        name: productForm.name.trim(),
        category: productForm.category.trim() || null,
        price: Number(productForm.price),
        default_max_quantity: productForm.unlimited ? null : productForm.default_max_quantity
          ? Number(productForm.default_max_quantity)
          : null,
        image_url: productForm.image_url.trim() || null,
        description: productForm.description.trim() || null,
      });
      toast.success("商品已新增");
      setProductForm({
        name: "",
        category: "",
        price: "",
        default_max_quantity: "",
        unlimited: true,
        image_url: "",
        description: "",
      });
      await loadVendorData(selectedVendorId);
      setAvailabilityForm((current) => ({
        ...current,
        product_ids: current.product_ids.length > 0 ? current.product_ids : [product.id],
      }));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "新增商品失敗");
    } finally {
      setProductSaving(false);
    }
  }

  async function createAvailability() {
    if (availabilityForm.product_ids.length === 0 || !availabilityForm.service_date) {
      toast.error("請選擇商品與供餐日期");
      return;
    }
    setAvailabilitySaving(true);
    try {
      const dates = availabilityForm.mode === "single"
        ? [availabilityForm.service_date]
        : eachDate(
            availabilityForm.date_from,
            availabilityForm.mode === "permanent" ? addDays(90) : availabilityForm.date_to,
          )
            .filter((dateString) => availabilityForm.weekdays.includes(weekdayIndex(dateString)));
      if (dates.length === 0) {
        toast.error("批量上架沒有符合的日期");
        return;
      }
      const quickSlotMap = new Map(quickPickupSlots.map((slot) => [slot.label, slot]));
      const activeProductIds = new Set(products.filter((product) => product.is_active).map((product) => product.id));
      const productIds = availabilityForm.product_ids.filter((productId) => activeProductIds.has(productId));
      if (productIds.length === 0) {
        toast.error("請選擇啟用中的商品再上架");
        return;
      }
      const selectedSlots = availabilityForm.selected_slot_labels
        .map((label) => quickSlotMap.get(label))
        .filter((slot): slot is QuickPickupSlot => Boolean(slot));
      if (selectedSlots.length === 0) {
        toast.error("請至少選擇一個可取餐時段");
        return;
      }
      for (const productId of productIds) {
        for (const serviceDate of dates) {
          await mealApi.createAvailability({
            product_id: productId,
            service_date: serviceDate,
            sale_start: availabilityForm.mode === "bulk"
              ? combineDateTime(serviceDate, availabilityForm.sale_start.slice(11, 16))
              : toIso(availabilityForm.sale_start),
            sale_end: availabilityForm.mode === "bulk"
              ? combineDateTime(serviceDate, availabilityForm.sale_end.slice(11, 16))
              : toIso(availabilityForm.sale_end),
            price: availabilityForm.price ? Number(availabilityForm.price) : null,
            max_quantity: availabilityForm.max_unlimited ? null : availabilityForm.max_quantity
              ? Number(availabilityForm.max_quantity)
              : null,
            note: availabilityForm.note.trim() || null,
            pickup_slots: selectedSlots.map((slot, index) => ({
              label: slot.label,
              sort_order: index,
              pickup_start: combineDateTime(serviceDate, slot.start),
              pickup_end: combineDateTime(serviceDate, slot.end),
              order_deadline: combineDateTime(serviceDate, slot.deadline),
              capacity: availabilityForm.capacity_unlimited ? null : availabilityForm.capacity
                ? Number(availabilityForm.capacity)
                : null,
            })),
          });
        }
      }
      toast.success(`已建立 ${dates.length * productIds.length} 筆上架`);
      await loadVendorData(selectedVendorId);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "建立上架失敗");
    } finally {
      setAvailabilitySaving(false);
    }
  }

  function scheduleProducts(productIds: string[]) {
    const activeProductIds = productIds.filter((productId) =>
      products.some((product) => product.id === productId && product.is_active),
    );
    if (activeProductIds.length === 0) {
      toast.error("請先選擇啟用中的商品");
      return;
    }
    setAvailabilityForm((current) => ({
      ...current,
      mode: activeProductIds.length > 1 ? "bulk" : current.mode,
      product_ids: activeProductIds,
    }));
    setTab("availability");
    toast.success(`已帶入 ${activeProductIds.length} 個商品，可直接設定上架時間`);
  }

  async function assignManager() {
    if (!selectedVendorId || !managerCandidate) {
      toast.error("請先搜尋並選擇負責人");
      return;
    }
    setManagerSaving(true);
    try {
      await mealApi.assignVendorManager(selectedVendorId, managerCandidate.email);
      toast.success("負責人已指派，並授予商家管理權限");
      setManagerCandidate(null);
      await loadVendorData(selectedVendorId);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "指派失敗");
    } finally {
      setManagerSaving(false);
    }
  }

  async function redeemPickup() {
    if (!pickupCode.trim()) {
      toast.error("請輸入個人五碼或班級領取碼");
      return;
    }
    setPickupSaving(true);
    try {
      const result = await mealApi.pickupLookup(pickupCode.trim(), true);
      setPickupResult(result);
      toast.success(result.message);
      await loadVendorData(selectedVendorId);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "核銷失敗");
    } finally {
      setPickupSaving(false);
    }
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--background)" }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 lg:px-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>學餐平台管理</p>
            <h1 className="text-2xl font-semibold tracking-normal" style={{ color: "var(--text-primary)" }}>
              商家營運後台
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setShowVendorModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--primary)" }}
          >
            <Plus size={16} /> 新增商家
          </button>
        </header>

        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-lg p-3" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>商家</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{vendors.length} 間</div>
            </div>
            <div className="flex flex-col gap-2">
              {loading && <div className="px-3 py-8 text-center text-sm text-muted">載入中...</div>}
              {!loading && vendors.length === 0 && (
                <div className="rounded-md p-4 text-sm" style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}>
                  還沒有商家，先建立第一間並指派負責人。
                </div>
              )}
              {vendors.map((vendor) => (
                <button
                  key={vendor.id}
                  type="button"
                  onClick={() => setSelectedVendorId(vendor.id)}
                  className="rounded-md p-3 text-left transition hover:bg-black/5"
                  style={{
                    border: vendor.id === selectedVendorId
                      ? "1px solid var(--primary)"
                      : "1px solid var(--border)",
                    background: vendor.id === selectedVendorId ? "var(--surface)" : "transparent",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {vendor.name}
                      </div>
                      <div className="mt-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                        {vendor.contact_phone || vendor.contact_email || "尚未設定聯絡資訊"}
                      </div>
                    </div>
                    <span className="shrink-0 rounded px-2 py-1 text-xs"
                      style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                      {statusLabel[vendor.status] ?? vendor.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0">
            {!selectedVendor ? (
              <div className="rounded-lg p-8 text-center text-sm"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                請選擇或新增商家。
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <VendorHero vendor={selectedVendor} managers={managers} stats={orderStats} />
                <div className="flex flex-wrap gap-2">
                  {tabs.map((item) => {
                    const Icon = item.icon;
                    const active = tab === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setTab(item.key)}
                        className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                        style={{
                          border: "1px solid var(--border)",
                          background: active ? "var(--primary)" : "var(--card-bg)",
                          color: active ? "white" : "var(--text-primary)",
                        }}
                      >
                        <Icon size={15} /> {item.label}
                      </button>
                    );
                  })}
                </div>

                {tab === "overview" && (
                  <OverviewPanel
                    products={products}
                    availabilities={availabilities}
                    todayOrders={todayOrders}
                    onTab={setTab}
                  />
                )}
                {tab === "products" && (
                  <ProductsPanel
                    products={products}
                    form={productForm}
                    setForm={setProductForm}
                    saving={productSaving}
                    onCreate={createProduct}
                    onRefresh={() => loadVendorData(selectedVendorId)}
                    onScheduleSelected={scheduleProducts}
                  />
                )}
                {tab === "availability" && (
                  <AvailabilityPanel
                    products={products}
                    availabilities={availabilities}
                    form={availabilityForm}
                    setForm={setAvailabilityForm}
                    saving={availabilitySaving}
                    onCreate={createAvailability}
                  />
                )}
                {tab === "orders" && <OrdersPanel orders={orders} />}
                {tab === "pickup" && (
                  <PickupPanel
                    code={pickupCode}
                    setCode={setPickupCode}
                    result={pickupResult}
                    saving={pickupSaving}
                    onRedeem={redeemPickup}
                  />
                )}
                {tab === "settings" && (
                  <SettingsPanel
                    vendor={selectedVendor}
                    managers={managers}
                    candidate={managerCandidate}
                    setCandidate={setManagerCandidate}
                    saving={managerSaving}
                    onAssign={assignManager}
                    onRefresh={() => loadVendorData(selectedVendorId)}
                  />
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {showVendorModal && (
        <Modal onClose={() => setShowVendorModal(false)} title="新增商家">
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>商家名稱</span>
              <input
                value={vendorForm.name}
                onChange={(event) => setVendorForm((current) => ({ ...current, name: event.target.value }))}
                className="rounded-md px-3 py-2 outline-none"
                style={{ border: "1px solid var(--border)", background: "var(--background)" }}
                placeholder="例如：一樓熱食部"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>商家描述</span>
              <textarea
                value={vendorForm.description}
                onChange={(event) => setVendorForm((current) => ({ ...current, description: event.target.value }))}
                className="min-h-20 rounded-md px-3 py-2 outline-none"
                style={{ border: "1px solid var(--border)", background: "var(--background)" }}
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>電話</span>
                <input
                  value={vendorForm.contact_phone}
                  onChange={(event) => setVendorForm((current) => ({ ...current, contact_phone: event.target.value }))}
                  className="rounded-md px-3 py-2 outline-none"
                  style={{ border: "1px solid var(--border)", background: "var(--background)" }}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span style={{ color: "var(--text-muted)" }}>信箱</span>
                <input
                  value={vendorForm.contact_email}
                  onChange={(event) => setVendorForm((current) => ({ ...current, contact_email: event.target.value }))}
                  className="rounded-md px-3 py-2 outline-none"
                  style={{ border: "1px solid var(--border)", background: "var(--background)" }}
                />
              </label>
            </div>
            <div className="grid gap-2">
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>負責人與權限</div>
              {initialManager ? (
                <div className="flex items-center justify-between rounded-md px-3 py-2"
                  style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
                  <div>
                    <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {initialManager.display_name}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>{initialManager.email}</div>
                  </div>
                  <button type="button" className="text-sm" onClick={() => setInitialManager(null)}>
                    取消
                  </button>
                </div>
              ) : (
                <UserPicker placeholder="搜尋使用者並設定為商家負責人" onPick={setInitialManager} />
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowVendorModal(false)} className="rounded-md px-4 py-2 text-sm"
                style={{ border: "1px solid var(--border)" }}>
                取消
              </button>
              <button type="button" onClick={createVendor} disabled={vendorSaving}
                className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ background: "var(--primary)" }}>
                {vendorSaving ? "建立中..." : "建立商家"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function VendorHero({
  vendor,
  managers,
  stats,
}: {
  vendor: MealVendorOut;
  managers: VendorManagerOut[];
  stats: { total: number; today: number; paid: number; completed: number; revenue: number };
}) {
  return (
    <div className="rounded-lg p-5" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{vendor.name}</h2>
            <span className="rounded px-2 py-1 text-xs" style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
              {statusLabel[vendor.status] ?? vendor.status}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--text-muted)" }}>
            {vendor.description || "尚未填寫商家描述。"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Metric label="今日訂單" value={stats.today} />
          <Metric label="全部訂單" value={stats.total} />
          <Metric label="已付款" value={stats.paid} />
          <Metric label="營收" value={money(stats.revenue)} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="inline-flex items-center gap-1"><Users size={14} /> {managers.length} 位負責人</span>
        <span>{vendor.contact_phone || "未填電話"}</span>
        <span>{vendor.contact_email || "未填信箱"}</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md px-3 py-2" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="mt-1 font-semibold" style={{ color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function OverviewPanel({
  products,
  availabilities,
  todayOrders,
  onTab,
}: {
  products: MealProductOut[];
  availabilities: MealAvailabilityOut[];
  todayOrders: MealOrderListItem[];
  onTab: (tab: VendorTab) => void;
}) {
  const actions: { label: string; icon: typeof Plus; tab: VendorTab }[] = [
    { label: "新增商品", icon: PackagePlus, tab: "products" },
    { label: "排定上架", icon: CalendarDays, tab: "availability" },
    { label: "快速核銷", icon: QrCode, tab: "pickup" },
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>今日營運</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Metric label="商品數" value={products.length} />
          <Metric label="近期上架" value={availabilities.length} />
          <Metric label="今日訂單" value={todayOrders.length} />
        </div>
        <div className="mt-5 overflow-hidden rounded-md" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
              <tr>
                <th className="px-3 py-2 text-left font-medium">訂單</th>
                <th className="px-3 py-2 text-left font-medium">狀態</th>
                <th className="px-3 py-2 text-right font-medium">金額</th>
              </tr>
            </thead>
            <tbody>
              {todayOrders.slice(0, 8).map((order) => (
                <tr key={order.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-3 py-2">{order.serial_number}</td>
                  <td className="px-3 py-2">{orderLabel[order.status] ?? order.status}</td>
                  <td className="px-3 py-2 text-right">{money(order.total_price)}</td>
                </tr>
              ))}
              {todayOrders.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-8 text-center" style={{ color: "var(--text-muted)" }}>今天尚無訂單</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid gap-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button key={action.tab} type="button" onClick={() => onTab(action.tab)}
              className="flex items-center justify-between rounded-lg p-4 text-left"
              style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
              <span className="inline-flex items-center gap-2 font-medium" style={{ color: "var(--text-primary)" }}>
                <Icon size={18} /> {action.label}
              </span>
              <Plus size={16} style={{ color: "var(--text-muted)" }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProductsPanel({
  products,
  form,
  setForm,
  saving,
  onCreate,
  onRefresh,
  onScheduleSelected,
}: {
  products: MealProductOut[];
  form: ProductForm;
  setForm: Dispatch<SetStateAction<ProductForm>>;
  saving: boolean;
  onCreate: () => void;
  onRefresh: () => void;
  onScheduleSelected: (productIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<MealProductOut | null>(null);
  const [editForm, setEditForm] = useState<ProductForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  function toggleSelected(productId: string) {
    setSelectedIds((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  }

  function startEdit(product: MealProductOut) {
    setEditing(product);
    setEditForm({
      name: product.name,
      category: product.category ?? "",
      price: String(product.price),
      default_max_quantity: product.default_max_quantity ? String(product.default_max_quantity) : "",
      unlimited: product.default_max_quantity === null,
      image_url: product.image_url ?? "",
      description: product.description ?? "",
    });
  }

  async function saveEdit() {
    if (!editing || !editForm || !editForm.name.trim() || !editForm.price) {
      toast.error("請填寫商品名稱與價格");
      return;
    }
    setEditSaving(true);
    try {
      await mealApi.updateProduct(editing.id, {
        name: editForm.name.trim(),
        category: editForm.category.trim() || null,
        price: Number(editForm.price),
        default_max_quantity: editForm.unlimited ? null : editForm.default_max_quantity
          ? Number(editForm.default_max_quantity)
          : null,
        image_url: editForm.image_url.trim() || null,
        description: editForm.description.trim() || null,
      });
      toast.success("商品已更新");
      setEditing(null);
      setEditForm(null);
      onRefresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "更新商品失敗");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>新增商品</h3>
        <div className="mt-4 grid gap-3">
          {form.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.image_url} alt="商品圖片預覽" className="h-36 w-full rounded-md object-cover"
              style={{ border: "1px solid var(--border)" }} />
          )}
          <input className="input" placeholder="商品名稱" value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          <input className="input" placeholder="分類，例如：便當、飲料" value={form.category}
            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} />
          <label className="grid gap-1 text-sm">
            <span style={{ color: "var(--text-muted)" }}>商品圖片</span>
            <input className="input" type="file" accept="image/*"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  const uploaded = await mealApi.uploadImage(file);
                  setForm((current) => ({ ...current, image_url: uploaded.url }));
                  toast.success("圖片已上傳");
                } catch (error: unknown) {
                  toast.error(error instanceof Error ? error.message : "圖片上傳失敗");
                }
              }} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <input className="input" type="number" min={0} placeholder="價格" value={form.price}
              onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} />
            <label className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)", background: "var(--background)" }}>
              <input type="checkbox" checked={form.unlimited}
                onChange={(event) => setForm((current) => ({ ...current, unlimited: event.target.checked }))} />
              無限制
            </label>
          </div>
          {!form.unlimited && (
            <input className="input" type="number" min={1} placeholder="預設限量"
              value={form.default_max_quantity}
              onChange={(event) => setForm((current) => ({ ...current, default_max_quantity: event.target.value }))} />
          )}
          <textarea className="input min-h-20" placeholder="描述" value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          <button type="button" onClick={onCreate} disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--primary)" }}>
            {saving ? "新增中..." : "新增商品"}
          </button>
        </div>
      </div>
      <div className="rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>商品目錄</h3>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              已選 {selectedIds.length} 個商品
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)" }}
              onClick={() => setSelectedIds(products.map((product) => product.id))}>
              全選
            </button>
            <button type="button" className="rounded-md px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)" }}
              onClick={() => setSelectedIds([])}>
              清除
            </button>
            <button type="button" disabled={selectedIds.length === 0}
              onClick={() => onScheduleSelected(selectedIds)}
              className="rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--primary)" }}>
              批量排定上架
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
              <tr>
                <th className="w-10 px-3 py-2 text-left">
                  <input type="checkbox" checked={products.length > 0 && selectedIds.length === products.length}
                    onChange={(event) => setSelectedIds(event.target.checked
                      ? products.map((product) => product.id)
                      : [])} />
                </th>
                <th className="px-3 py-2 text-left font-medium">商品</th>
                <th className="px-3 py-2 text-left font-medium">分類</th>
                <th className="px-3 py-2 text-right font-medium">價格</th>
                <th className="px-3 py-2 text-left font-medium">數量</th>
                <th className="px-3 py-2 text-left font-medium">狀態</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selectedIds.includes(product.id)}
                      onChange={() => toggleSelected(product.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt={product.name}
                          className="h-12 w-12 rounded-md object-cover" />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-md text-xs"
                          style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                          無圖
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium" style={{ color: "var(--text-primary)" }}>
                          {product.name}
                        </div>
                        <div className="line-clamp-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          {product.description || "尚未填寫描述"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{product.category || "未分類"}</td>
                  <td className="px-3 py-2 text-right">{money(product.price)}</td>
                  <td className="px-3 py-2">
                    {product.default_max_quantity ? `限量 ${product.default_max_quantity}` : "無限制"}
                  </td>
                  <td className="px-3 py-2">{product.is_active ? "啟用中" : "已停用"}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => startEdit(product)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                        style={{ border: "1px solid var(--border)" }}>
                        <Edit3 size={13} /> 編輯
                      </button>
                      <button type="button" onClick={async () => {
                        const nextActive = !product.is_active;
                        await mealApi.updateProduct(product.id, { is_active: nextActive });
                        toast.success(nextActive ? "商品已啟用" : "商品已停用");
                        onRefresh();
                      }} className="rounded px-2 py-1 text-xs" style={{ border: "1px solid var(--border)" }}>
                        {product.is_active ? "停用" : "啟用"}
                      </button>
                      <button type="button" onClick={() => onScheduleSelected([product.id])}
                        className="rounded px-2 py-1 text-xs text-white"
                        style={{ background: "var(--primary)" }}>
                        排上架
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center" style={{ color: "var(--text-muted)" }}>
                  還沒有商品，先建立菜單目錄。
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {editing && editForm && (
        <Modal onClose={() => { setEditing(null); setEditForm(null); }} title="編輯商品">
          <ProductEditorForm form={editForm} setForm={setEditForm} />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setEditing(null); setEditForm(null); }}
              className="rounded-md px-4 py-2 text-sm" style={{ border: "1px solid var(--border)" }}>
              取消
            </button>
            <button type="button" onClick={saveEdit} disabled={editSaving}
              className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--primary)" }}>
              {editSaving ? "儲存中..." : "儲存變更"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProductEditorForm({
  form,
  setForm,
}: {
  form: ProductForm;
  setForm: Dispatch<SetStateAction<ProductForm | null>>;
}) {
  return (
    <div className="grid gap-3">
      {form.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={form.image_url} alt="商品圖片預覽" className="h-40 w-full rounded-md object-cover"
          style={{ border: "1px solid var(--border)" }} />
      )}
      <input className="input" placeholder="商品名稱" value={form.name}
        onChange={(event) => setForm((current) => current && ({ ...current, name: event.target.value }))} />
      <input className="input" placeholder="分類" value={form.category}
        onChange={(event) => setForm((current) => current && ({ ...current, category: event.target.value }))} />
      <label className="grid gap-1 text-sm">
        <span style={{ color: "var(--text-muted)" }}>商品圖片</span>
        <input className="input" type="file" accept="image/*"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              const uploaded = await mealApi.uploadImage(file);
              setForm((current) => current && ({ ...current, image_url: uploaded.url }));
              toast.success("圖片已上傳");
            } catch (error: unknown) {
              toast.error(error instanceof Error ? error.message : "圖片上傳失敗");
            }
          }} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <input className="input" type="number" min={0} placeholder="價格" value={form.price}
          onChange={(event) => setForm((current) => current && ({ ...current, price: event.target.value }))} />
        <label className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          style={{ border: "1px solid var(--border)", background: "var(--background)" }}>
          <input type="checkbox" checked={form.unlimited}
            onChange={(event) => setForm((current) => current && ({
              ...current,
              unlimited: event.target.checked,
            }))} />
          無限制
        </label>
      </div>
      {!form.unlimited && (
        <input className="input" type="number" min={1} placeholder="預設限量"
          value={form.default_max_quantity}
          onChange={(event) => setForm((current) => current && ({
            ...current,
            default_max_quantity: event.target.value,
          }))} />
      )}
      <textarea className="input min-h-24" placeholder="描述" value={form.description}
        onChange={(event) => setForm((current) => current && ({ ...current, description: event.target.value }))} />
    </div>
  );
}

function AvailabilityPanel({
  products,
  availabilities,
  form,
  setForm,
  saving,
  onCreate,
}: {
  products: MealProductOut[];
  availabilities: MealAvailabilityOut[];
  form: AvailabilityForm;
  setForm: Dispatch<SetStateAction<AvailabilityForm>>;
  saving: boolean;
  onCreate: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const selectedProducts = products.filter((product) => form.product_ids.includes(product.id));
  const dateCount = form.mode === "single"
    ? 1
    : eachDate(form.date_from, form.mode === "permanent" ? addDays(90) : form.date_to)
        .filter((dateString) => form.weekdays.includes(weekdayIndex(dateString))).length;
  const totalCount = dateCount * form.product_ids.length;
  const slotCount = form.selected_slot_labels.length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="grid gap-4">
        <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>1. 商品</h3>
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {form.product_ids.length} / {products.length}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-md px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)" }}
              onClick={() => setForm((current) => ({
                ...current,
                product_ids: products.filter((product) => product.is_active).map((product) => product.id),
              }))}>
              全部啟用商品
            </button>
            <button type="button" className="rounded-md px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)" }}
              onClick={() => setForm((current) => ({ ...current, product_ids: [] }))}>
              清除
            </button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {products.map((product) => {
              const checked = form.product_ids.includes(product.id);
              return (
                <button key={product.id} type="button"
                  disabled={!product.is_active}
                  onClick={() => setForm((current) => ({
                    ...current,
                    product_ids: checked
                      ? current.product_ids.filter((id) => id !== product.id)
                      : [...current.product_ids, product.id],
                  }))}
                  className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm"
                  style={{
                    border: checked ? "1px solid var(--primary)" : "1px solid var(--border)",
                    background: checked ? "var(--surface)" : "transparent",
                    opacity: product.is_active ? 1 : 0.45,
                  }}>
                  <span className="truncate" style={{ color: "var(--text-primary)" }}>
                    {product.name}{!product.is_active ? "（已停用）" : ""}
                  </span>
                  <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                    {money(product.price)}
                  </span>
                </button>
              );
            })}
            {products.length === 0 && <EmptyState text="請先建立商品" />}
          </div>
        </div>

        <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>2. 日期</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["single", "bulk", "permanent"] as const).map((mode) => (
              <button key={mode} type="button"
                onClick={() => setForm((current) => ({ ...current, mode }))}
                className="rounded-md px-3 py-2 text-sm"
                style={{
                  border: "1px solid var(--border)",
                  background: form.mode === mode ? "var(--primary)" : "var(--surface)",
                  color: form.mode === mode ? "white" : "var(--text-primary)",
                }}>
                {mode === "single" ? "單日" : mode === "bulk" ? "多日" : "永久"}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {form.mode === "single" ? (
              <input className="input" type="date" value={form.service_date}
                onChange={(event) => setForm((current) => ({ ...current, service_date: event.target.value }))} />
            ) : (
              <div className="grid gap-3">
                <div className={form.mode === "permanent" ? "grid gap-3" : "grid grid-cols-2 gap-3"}>
                  <input className="input" type="date" value={form.date_from}
                    onChange={(event) => setForm((current) => ({ ...current, date_from: event.target.value }))} />
                  {form.mode === "bulk" && (
                    <input className="input" type="date" value={form.date_to}
                      onChange={(event) => setForm((current) => ({ ...current, date_to: event.target.value }))} />
                  )}
                </div>
                {form.mode === "permanent" && (
                  <div className="rounded-md px-3 py-2 text-sm" style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                    永久上架會從開始日往後先建立 90 天，之後可由排程延展。
                  </div>
                )}
                <div className="grid grid-cols-7 gap-1">
                  {["一", "二", "三", "四", "五", "六", "日"].map((label, index) => (
                    <button key={label} type="button"
                      onClick={() => setForm((current) => ({
                        ...current,
                        weekdays: current.weekdays.includes(index)
                          ? current.weekdays.filter((item) => item !== index)
                          : [...current.weekdays, index].sort(),
                      }))}
                      className="rounded-md px-2 py-2 text-xs"
                      style={{
                        border: "1px solid var(--border)",
                        background: form.weekdays.includes(index) ? "var(--primary)" : "var(--surface)",
                        color: form.weekdays.includes(index) ? "white" : "var(--text-primary)",
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>3. 開放給學生選的取餐時段</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {quickPickupSlots.map((slot) => {
              const active = form.selected_slot_labels.includes(slot.label);
              return (
              <button key={slot.label} type="button" className="rounded-md px-3 py-2 text-sm"
                style={{
                  border: "1px solid var(--border)",
                  background: active ? "var(--primary)" : "var(--surface)",
                  color: active ? "white" : "var(--text-primary)",
                }}
                onClick={() => setForm((current) => ({
                  ...current,
                  selected_slot_labels: active
                    ? current.selected_slot_labels.filter((label) => label !== slot.label)
                    : [...current.selected_slot_labels, slot.label],
                }))}>
                {slot.label} · {slot.start}
              </button>
              );
            })}
          </div>
          <div className="mt-3 rounded-md px-3 py-2 text-sm" style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
            學生下單時會從你勾選的 {slotCount} 個時段中選一個。結單時間已預設為取餐前 30 分鐘。
          </div>
          <button type="button" className="mt-3 text-sm"
            style={{ color: "var(--primary)" }}
            onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? "收起進階設定" : "進階設定"}
          </button>
          {showAdvanced && (
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <input className="input" type="datetime-local" value={form.sale_start}
                  onChange={(event) => setForm((current) => ({ ...current, sale_start: event.target.value }))} />
                <input className="input" type="datetime-local" value={form.sale_end}
                  onChange={(event) => setForm((current) => ({ ...current, sale_end: event.target.value }))} />
              </div>
              <input className="input" type="number" min={0} placeholder="覆寫價格，留空使用商品價格" value={form.price}
                onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  style={{ border: "1px solid var(--border)", background: "var(--background)" }}>
                  <input type="checkbox" checked={form.max_unlimited}
                    onChange={(event) => setForm((current) => ({ ...current, max_unlimited: event.target.checked }))} />
                  總量無限制
                </label>
                <label className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  style={{ border: "1px solid var(--border)", background: "var(--background)" }}>
                  <input type="checkbox" checked={form.capacity_unlimited}
                    onChange={(event) => setForm((current) => ({ ...current, capacity_unlimited: event.target.checked }))} />
                  時段無限制
                </label>
              </div>
              {!form.max_unlimited && (
                <input className="input" type="number" min={1} placeholder="總限量" value={form.max_quantity}
                  onChange={(event) => setForm((current) => ({ ...current, max_quantity: event.target.value }))} />
              )}
              {!form.capacity_unlimited && (
                <input className="input" type="number" min={1} placeholder="時段容量" value={form.capacity}
                  onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))} />
              )}
              <textarea className="input min-h-16" placeholder="備註" value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>確認</h3>
        <div className="mt-3 grid gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <div className="flex justify-between"><span>商品</span><strong>{form.product_ids.length}</strong></div>
          <div className="flex justify-between"><span>日期</span><strong>{dateCount}</strong></div>
          <div className="flex justify-between"><span>建立</span><strong>{totalCount}</strong></div>
          <div className="flex justify-between"><span>可選時段</span><strong>{slotCount}</strong></div>
        </div>
        {selectedProducts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {selectedProducts.slice(0, 8).map((product) => (
              <span key={product.id} className="rounded px-2 py-1 text-xs"
                style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                {product.name}
              </span>
            ))}
          </div>
        )}
        {form.selected_slot_labels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {form.selected_slot_labels.map((label) => (
              <span key={label} className="rounded px-2 py-1 text-xs"
                style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                {label}
              </span>
            ))}
          </div>
        )}
        <button type="button" onClick={onCreate}
          disabled={saving || products.length === 0 || totalCount === 0 || slotCount === 0}
          className="mt-4 w-full rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--primary)" }}>
          {saving ? "建立中..." : form.mode === "permanent" ? `永久上架（先建立 ${totalCount} 筆）` : `建立 ${totalCount} 筆上架`}
        </button>
      </div>

      <div className="overflow-hidden rounded-lg xl:col-span-2" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
            <tr>
              <th className="px-3 py-2 text-left font-medium">日期</th>
              <th className="px-3 py-2 text-left font-medium">商品</th>
              <th className="px-3 py-2 text-left font-medium">取餐</th>
              <th className="px-3 py-2 text-right font-medium">價格</th>
            </tr>
          </thead>
          <tbody>
            {availabilities.map((item) => (
              <tr key={item.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="px-3 py-2">{item.service_date}</td>
                <td className="px-3 py-2">{item.product?.name ?? "商品"}</td>
                <td className="px-3 py-2">
                  {item.pickup_slots.map((slot) => slot.label).join("、") || "未設定"}
                </td>
                <td className="px-3 py-2 text-right">{money(item.price)}</td>
              </tr>
            ))}
            {availabilities.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-8 text-center" style={{ color: "var(--text-muted)" }}>尚未排定上架</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrdersPanel({ orders }: { orders: MealOrderListItem[] }) {
  return (
    <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
      <table className="w-full text-sm">
        <thead style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
          <tr>
            <th className="px-3 py-2 text-left font-medium">訂單</th>
            <th className="px-3 py-2 text-left font-medium">取餐碼</th>
            <th className="px-3 py-2 text-left font-medium">狀態</th>
            <th className="px-3 py-2 text-left font-medium">收款</th>
            <th className="px-3 py-2 text-right font-medium">金額</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td className="px-3 py-2">{order.serial_number}</td>
              <td className="px-3 py-2 font-mono">{order.pickup_code}</td>
              <td className="px-3 py-2">{orderLabel[order.status] ?? order.status}</td>
              <td className="px-3 py-2">{order.is_paid ? "已收" : "未收"}</td>
              <td className="px-3 py-2 text-right">{money(order.total_price)}</td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-8 text-center" style={{ color: "var(--text-muted)" }}>尚無訂單</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PickupPanel({
  code,
  setCode,
  result,
  saving,
  onRedeem,
}: {
  code: string;
  setCode: (value: string) => void;
  result: MealPickupLookupOut | null;
  saving: boolean;
  onRedeem: () => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>快速核銷</h3>
        <div className="mt-4 flex gap-2">
          <input className="input font-mono text-lg" value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="五碼或班級領取碼" />
          <button type="button" onClick={onRedeem} disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--primary)" }}>
            核銷
          </button>
        </div>
      </div>
      {result ? (
        <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          <div className="flex items-center gap-2 font-semibold" style={{ color: "var(--text-primary)" }}>
            <CheckCircle2 size={18} /> {result.message}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Metric label="符合訂單" value={result.matched_orders} />
            <Metric label="已核銷" value={result.completed_orders} />
            <Metric label="金額" value={money(result.total_price)} />
          </div>
        </div>
      ) : (
        <EmptyState text="輸入學生五碼可核銷個人訂單，輸入班級碼可整班批次核銷。" />
      )}
    </div>
  );
}

function SettingsPanel({
  vendor,
  managers,
  candidate,
  setCandidate,
  saving,
  onAssign,
  onRefresh,
}: {
  vendor: MealVendorOut;
  managers: VendorManagerOut[];
  candidate: UserSummary | null;
  setCandidate: (user: UserSummary | null) => void;
  saving: boolean;
  onAssign: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>快捷設定負責人</h3>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          指派後會同步建立商家管理人紀錄、商家組織職位與 `meal:manage` 權限。
        </p>
        <div className="mt-4 grid gap-3">
          {candidate ? (
            <div className="flex items-center justify-between rounded-md px-3 py-2"
              style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
              <div>
                <div className="text-sm font-medium">{candidate.display_name}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{candidate.email}</div>
              </div>
              <button type="button" className="text-sm" onClick={() => setCandidate(null)}>取消</button>
            </div>
          ) : (
            <UserPicker placeholder="搜尋負責人 Email 或姓名" onPick={setCandidate} />
          )}
          <button type="button" onClick={onAssign} disabled={saving || !candidate}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--primary)" }}>
            {saving ? "指派中..." : "指派並給權限"}
          </button>
        </div>
      </div>
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>目前負責人</h3>
        <div className="mt-4 grid gap-2">
          {managers.map((manager) => (
            <div key={manager.user_id} className="flex items-center justify-between rounded-md px-3 py-2"
              style={{ border: "1px solid var(--border)" }}>
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {manager.display_name}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{manager.email}</div>
              </div>
              <button type="button" className="rounded px-2 py-1 text-xs"
                style={{ border: "1px solid var(--border)" }}
                onClick={async () => {
                  await mealApi.removeVendorManager(vendor.id, manager.user_id);
                  toast.success("已移除負責人");
                  onRefresh();
                }}>
                移除
              </button>
            </div>
          ))}
          {managers.length === 0 && <EmptyState text="尚未指派負責人。" />}
        </div>
        <div className="mt-4 rounded-md px-3 py-2 text-xs"
          style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
          權限細節由系統自動維護，這裡只需要管理實際負責人。
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg p-6 text-center text-sm"
      style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}>
      {text}
    </div>
  );
}
