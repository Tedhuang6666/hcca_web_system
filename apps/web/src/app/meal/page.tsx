"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock, ClipboardList, ShoppingBag, Store } from "lucide-react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import { ApiError, mealApi } from "@/lib/api";
import {
  fetchTaiwanCalendarForDates,
  isSchoolOrderingOffDay,
  type TaiwanCalendarDay,
} from "@/lib/taiwanCalendar";
import type {
  MealAvailabilityOut,
  MealOrderOut,
  MealPickupSlotOut,
  MealVendorOut,
} from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { usePersistedState } from "@/hooks/usePersistedState";
import { today, addDays } from "@/lib/dateUtils";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";

const RANGE_DAYS = 14;

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(value: number) {
  return `NT$ ${value.toLocaleString("zh-TW")}`;
}

function isSlotOpen(slot: MealPickupSlotOut) {
  return slot.is_active && new Date(slot.order_deadline).getTime() > Date.now();
}

function availableSlots(item: MealAvailabilityOut) {
  return item.pickup_slots
    .filter(isSlotOpen)
    .sort((a, b) => a.sort_order - b.sort_order || a.pickup_start.localeCompare(b.pickup_start));
}

function dateOptions() {
  return Array.from({ length: RANGE_DAYS + 1 }, (_, index) => addDays(index));
}

function OrderModal({
  availability,
  vendor,
  onClose,
  onDone,
}: {
  availability: MealAvailabilityOut;
  vendor: MealVendorOut | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const slots = availableSlots(availability);
  const [slotId, setSlotId] = useState(slots[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<MealOrderOut | null>(null);

  const selectedSlot = slots.find((slot) => slot.id === slotId) ?? slots[0];
  const total = availability.price * quantity;

  async function submit() {
    if (!selectedSlot) {
      toast.error("請選擇取餐時間");
      return;
    }
    setSaving(true);
    try {
      const order = await mealApi.createOrder({
        pickup_slot_id: selectedSlot.id,
        items: [{ availability_id: availability.id, quantity }],
        notes: notes.trim() || undefined,
      });
      setSuccess(order);
      toast.success("訂餐成功");
    } catch (error: unknown) {
      toast.error(error instanceof ApiError ? error.message : "訂餐失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={success ? onDone : onClose} title={success ? "訂餐成功" : "確認訂餐"} size="xl">
      {success ? (
        <div className="grid gap-5 text-center">
          <div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>取餐代碼</p>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(success.pickup_code).catch(() => {})}
              className="mt-2 w-full rounded-lg px-4 py-5 font-mono text-5xl font-black tracking-widest"
              style={{ border: "1px solid var(--border)", background: "var(--primary-dim)", color: "var(--text-primary)" }}
            >
              {success.pickup_code}
            </button>
          </div>
          <div className="rounded-lg p-3 text-sm" style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
            {vendor?.name ?? "商家"} · {availability.product?.name ?? "商品"} · {money(success.total_price)}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onDone} className="flex-1 rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ background: "var(--primary)" }}>
              完成
            </button>
            <Link href="/meal/orders" className="rounded-md px-4 py-2 text-sm"
              style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
              我的訂單
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="flex gap-3">
            {availability.product?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={availability.product.image_url} alt={availability.product.name}
                className="h-20 w-20 rounded-md object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-md"
                style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                <ShoppingBag size={24} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>{vendor?.name ?? "商家"}</p>
              <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {availability.product?.name ?? "商品"}
              </h3>
              <p className="mt-1 text-sm font-semibold" style={{ color: "var(--primary)" }}>
                {formatDate(availability.service_date)} · {money(availability.price)}
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium" style={{ color: "var(--text-primary)" }}>取餐時間</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {slots.map((slot) => {
                const active = slot.id === slotId;
                return (
                  <button key={slot.id} type="button" onClick={() => setSlotId(slot.id)}
                    className="rounded-md px-3 py-2 text-left text-sm"
                    style={{
                      border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
                      background: active ? "var(--primary-dim)" : "var(--surface)",
                      color: "var(--text-primary)",
                    }}>
                    <span className="block font-medium">{slot.label}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {formatTime(slot.pickup_start)}-{formatTime(slot.pickup_end)} · {formatTime(slot.order_deadline)} 結單
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>數量</span>
              <input className="input" type="number" min={1} max={20} value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} />
            </label>
            <label className="grid gap-1 text-sm">
              <span style={{ color: "var(--text-muted)" }}>備註</span>
              <input className="input" value={notes} maxLength={120}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="過敏、不加辣、其他需求" />
            </label>
          </div>

          <div className="flex items-center justify-between rounded-md px-3 py-2"
            style={{ background: "var(--surface)" }}>
            <span style={{ color: "var(--text-muted)" }}>合計</span>
            <strong style={{ color: "var(--primary)" }}>{money(total)}</strong>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm"
              style={{ border: "1px solid var(--border)" }}>
              取消
            </button>
            <button type="button" onClick={submit} disabled={saving || slots.length === 0}
              className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--primary)" }}>
              {saving ? "送出中..." : "送出訂單"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function MealPage() {
  const { can } = usePermissions();
  const isManager = can("meal:manage");
  const allDates = useMemo(() => dateOptions(), []);

  const MEAL_VENDORS_KEY = "meal/vendors";
  const MEAL_AVAIL_KEY = "meal/availabilities";
  const [vendors, setVendors] = useState<MealVendorOut[]>(() => cacheGet<MealVendorOut[]>(MEAL_VENDORS_KEY) ?? []);
  const [availabilities, setAvailabilities] = useState<MealAvailabilityOut[]>(() => cacheGet<MealAvailabilityOut[]>(MEAL_AVAIL_KEY) ?? []);
  const [holidays, setHolidays] = useState<Map<string, TaiwanCalendarDay>>(new Map());
  const [loading, setLoading] = useState(!cacheHas(MEAL_VENDORS_KEY));
  const [vendorFilter, setVendorFilter] = usePersistedState<string>("hcca:pref:meal:vendor:v1", "all");
  const [dateFilter, setDateFilter] = usePersistedState<string>("hcca:pref:meal:date:v1", "all");
  const [ordering, setOrdering] = useState<MealAvailabilityOut | null>(null);

  const load = useCallback(async () => {
    if (!cacheHas(MEAL_VENDORS_KEY)) setLoading(true);
    try {
      const [vendorItems, availabilityItems] = await Promise.all([
        mealApi.listVendors({ active_only: true }),
        mealApi.listAvailabilities({
          date_from: today(),
          date_to: addDays(RANGE_DAYS),
          active_only: true,
          limit: 100,
        }),
      ]);
      setVendors(vendorItems);
      setAvailabilities(availabilityItems);
      cacheSet(MEAL_VENDORS_KEY, vendorItems);
      cacheSet(MEAL_AVAIL_KEY, availabilityItems);
    } catch (error: unknown) {
      toast.error(error instanceof ApiError ? error.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetchTaiwanCalendarForDates(allDates).then((items) => {
      if (!cancelled) setHolidays(items);
    });
    return () => { cancelled = true; };
  }, [allDates]);

  const dates = useMemo(
    () => allDates.filter((date) => !isSchoolOrderingOffDay(date, holidays)),
    [allDates, holidays],
  );

  const vendorMap = useMemo(
    () => Object.fromEntries(vendors.map((vendor) => [vendor.id, vendor])),
    [vendors],
  );

  const visibleItems = useMemo(() => {
    return availabilities
      .filter((item) => item.is_available && item.product?.is_active !== false)
      .filter((item) => !isSchoolOrderingOffDay(item.service_date, holidays))
      .filter((item) => availableSlots(item).length > 0)
      .filter((item) => vendorFilter === "all" || item.vendor_id === vendorFilter)
      .filter((item) => dateFilter === "all" || item.service_date === dateFilter)
      .sort((a, b) =>
        a.service_date.localeCompare(b.service_date)
        || (a.product?.name ?? "").localeCompare(b.product?.name ?? "", "zh-TW")
      );
  }, [availabilities, vendorFilter, dateFilter, holidays]);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, MealAvailabilityOut[]>();
    for (const item of visibleItems) {
      const list = map.get(item.service_date) ?? [];
      list.push(item);
      map.set(item.service_date, list);
    }
    return [...map.entries()];
  }, [visibleItems]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-5">
      <header className="workspace-header flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>學餐訂購</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            可預訂未來 {RANGE_DAYS} 天的餐點。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isManager && (
            <Link href="/meal/vendor" className="btn btn-ghost text-sm">
              商家管理
            </Link>
          )}
          <Link href="/meal/orders" className="btn btn-ghost text-sm">
            <ClipboardList size={15} /> 我的訂單
          </Link>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-[1fr_220px]">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={() => setDateFilter("all")}
            className="shrink-0 rounded-md px-3 py-2 text-sm"
            style={{
              border: "1px solid var(--border)",
              background: dateFilter === "all" ? "var(--primary)" : "var(--card-bg)",
              color: dateFilter === "all" ? "white" : "var(--text-primary)",
            }}>
            全部日期
          </button>
          {dates.map((date) => (
            <button key={date} type="button" onClick={() => setDateFilter(date)}
              className="shrink-0 rounded-md px-3 py-2 text-sm"
              style={{
                border: "1px solid var(--border)",
                background: dateFilter === date ? "var(--primary)" : "var(--card-bg)",
                color: dateFilter === date ? "white" : "var(--text-primary)",
              }}>
              {date === today() ? "今天" : formatDate(date)}
            </button>
          ))}
        </div>
        <select className="input" value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}>
          <option value="all">全部商家</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
          ))}
        </select>
      </section>

      {loading ? (
        <div className="py-20 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
      ) : groupedByDate.length === 0 ? (
        <div className="rounded-lg py-20 text-center" style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}>
          <ShoppingBag className="mx-auto mb-3 opacity-50" size={38} />
          <p className="text-sm">目前沒有可預訂的餐點</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {groupedByDate.map(([date, items]) => (
            <section key={date} className="grid gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays size={18} style={{ color: "var(--primary)" }} />
                <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {date === today() ? "今天" : formatDate(date)}
                </h2>
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>{items.length} 項</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => {
                  const vendor = vendorMap[item.vendor_id];
                  const slots = availableSlots(item);
                  return (
                    <article key={item.id} className="overflow-hidden rounded-lg"
                      style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
                      {item.product?.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.product.image_url} alt={item.product.name}
                          className="h-36 w-full object-cover" />
                      ) : (
                        <div className="flex h-28 items-center justify-center"
                          style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                          <ShoppingBag size={30} />
                        </div>
                      )}
                      <div className="grid gap-3 p-4">
                        <div>
                          <p className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                            <Store size={13} /> {vendor?.name ?? "商家"}
                          </p>
                          <h3 className="mt-1 line-clamp-1 font-semibold" style={{ color: "var(--text-primary)" }}>
                            {item.product?.name ?? "商品"}
                          </h3>
                          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                            {item.product?.description || item.note || "可提前預訂"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {slots.slice(0, 3).map((slot) => (
                            <span key={slot.id} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                              style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                              <Clock size={12} /> {slot.label}
                            </span>
                          ))}
                          {slots.length > 3 && (
                            <span className="rounded px-2 py-1 text-xs"
                              style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                              +{slots.length - 3}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <strong style={{ color: "var(--primary)" }}>{money(item.price)}</strong>
                          <button type="button" onClick={() => setOrdering(item)}
                            className="rounded-md px-3 py-2 text-sm font-medium text-white"
                            style={{ background: "var(--primary)" }}>
                            選擇
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {ordering && (
        <OrderModal
          availability={ordering}
          vendor={vendorMap[ordering.vendor_id]}
          onClose={() => setOrdering(null)}
          onDone={() => { setOrdering(null); load(); }}
        />
      )}
    </main>
  );
}
