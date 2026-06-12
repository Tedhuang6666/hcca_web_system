"use client";

import { useState } from "react";
import { toast } from "sonner";

import { mealApi } from "@/lib/api";
import { today } from "@/lib/dateUtils";
import type {
  MealOrderOut,
  MealOrderStatus,
  MealVendorOut,
  MenuItemSummary,
  MenuScheduleListItem,
  MenuScheduleOut,
  PickupListItemOut,
} from "@/lib/types";

// ── 型別 ─────────────────────────────────────────────────────────────────────

export type Tab = "overview" | "schedules" | "orders" | "prep" | "pickup";

export interface ItemForm {
  name: string; description: string; price: string; max_quantity: string; is_unlimited: boolean;
}
export const EMPTY_ITEM: ItemForm = { name: "", description: "", price: "", max_quantity: "", is_unlimited: true };

export interface ScheduleForm {
  vendor_id: string; date: string;
  order_open_time: string; order_deadline: string; note: string;
}
export const EMPTY_SCH: ScheduleForm = { vendor_id: "", date: "", order_open_time: "", order_deadline: "", note: "" };

// ── 工具函式 ─────────────────────────────────────────────────────────────────

export function fmtDT(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function orderStatusLabel(s: MealOrderStatus) {
  return { pending: "待確認", confirmed: "已確認", cancelled: "已取消", completed: "已完成" }[s] ?? s;
}

export function orderStatusColor(s: MealOrderStatus) {
  return {
    pending: { bg: "rgba(251,191,36,0.12)", color: "#fbbf24" },
    confirmed: { bg: "var(--primary-dim)", color: "var(--primary)" },
    cancelled: { bg: "rgba(239,68,68,0.08)", color: "#f87171" },
    completed: { bg: "rgba(52,211,153,0.12)", color: "#34d399" },
  }[s] ?? { bg: "transparent", color: "var(--text-muted)" };
}

// ── 子元件：菜單品項列表（排程詳細中使用） ────────────────────────────────────

export function ItemsPanel({ schedule, onChanged }: { schedule: MenuScheduleOut; onChanged: () => void }) {
  const [form, setForm] = useState<ItemForm>(EMPTY_ITEM);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ItemForm>(EMPTY_ITEM);
  const [saving, setSaving] = useState(false);

  function itemToForm(item: MenuItemSummary): ItemForm {
    return {
      name: item.name,
      description: item.description ?? "",
      price: String(item.price),
      max_quantity: item.max_quantity != null ? String(item.max_quantity) : "",
      is_unlimited: item.max_quantity == null,
    };
  }

  async function handleAdd() {
    if (!form.name.trim() || !form.price) { toast.error("請填寫品名與價格"); return; }
    setSaving(true);
    try {
      await mealApi.addMenuItem(schedule.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        price: Number(form.price),
        max_quantity: form.is_unlimited ? undefined : (form.max_quantity ? Number(form.max_quantity) : undefined),
      });
      setForm(EMPTY_ITEM);
      onChanged();
      toast.success("品項已新增");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "新增失敗");
    } finally { setSaving(false); }
  }

  async function handleEdit(itemId: string) {
    if (!editForm.name.trim() || !editForm.price) { toast.error("請填寫品名與價格"); return; }
    setSaving(true);
    try {
      await mealApi.updateMenuItem(itemId, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        price: Number(editForm.price),
        max_quantity: editForm.is_unlimited ? null : (editForm.max_quantity ? Number(editForm.max_quantity) : null),
      });
      setEditId(null);
      onChanged();
      toast.success("品項已更新");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "更新失敗");
    } finally { setSaving(false); }
  }

  async function handleDelete(itemId: string) {
    if (!confirm("確定刪除此品項？")) return;
    try {
      await mealApi.deleteMenuItem(itemId);
      onChanged();
      toast.success("品項已刪除");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "刪除失敗");
    }
  }

  async function toggleAvailable(item: MenuItemSummary) {
    try {
      await mealApi.updateMenuItem(item.id, { is_available: !item.is_available });
      onChanged();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "操作失敗");
    }
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
        菜單品項（{schedule.items.length} 項）
      </p>

      {/* 品項列表 */}
      {schedule.items.length === 0 && (
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>尚無品項</p>
      )}
      <div className="space-y-2 mb-4">
        {schedule.items.map(item => (
          <div key={item.id}
            className="rounded-lg px-3 py-2 flex items-center gap-3"
            style={{ background: "var(--card-bg-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
            {editId === item.id ? (
              // 編輯模式
              <div className="flex-1 grid grid-cols-2 gap-2">
                <input className="input-sm col-span-2" placeholder="品名*"
                  value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                <input className="input-sm" placeholder="描述"
                  value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                <input className="input-sm" type="number" placeholder="價格*"
                  value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))} />
                <label className="flex items-center gap-1 text-xs col-span-2" style={{ color: "var(--text-muted)" }}>
                  <input type="checkbox" checked={editForm.is_unlimited}
                    onChange={e => setEditForm(f => ({ ...f, is_unlimited: e.target.checked }))} />
                  無限量
                </label>
                {!editForm.is_unlimited && (
                  <input className="input-sm" type="number" placeholder="最大數量"
                    value={editForm.max_quantity} onChange={e => setEditForm(f => ({ ...f, max_quantity: e.target.value }))} />
                )}
                <div className="flex gap-2 col-span-2">
                  <button className="btn-sm btn-primary" disabled={saving}
                    onClick={() => handleEdit(item.id)}>儲存</button>
                  <button className="btn-sm" onClick={() => setEditId(null)}>取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.name}</span>
                  {item.description && <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>{item.description}</span>}
                </div>
                <span className="text-sm font-semibold" style={{ color: "var(--primary)" }}>NT${item.price}</span>
                {item.max_quantity != null && (
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>限{item.max_quantity}份</span>
                )}
                <button
                  onClick={() => toggleAvailable(item)}
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={item.is_available
                    ? { background: "rgba(52,211,153,0.12)", color: "#34d399" }
                    : { background: "rgba(239,68,68,0.08)", color: "#f87171" }}>
                  {item.is_available ? "供應中" : "暫停"}
                </button>
                {!schedule.is_closed && (
                  <>
                    <button className="btn-icon" onClick={() => { setEditId(item.id); setEditForm(itemToForm(item)); }}
                      title="編輯">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button className="btn-icon text-red-400" onClick={() => handleDelete(item.id)} title="刪除">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* 新增品項表單 */}
      {!schedule.is_closed && (
        <div className="rounded-lg p-3" style={{ background: "var(--primary-dim)", border: "1px dashed var(--border-strong)" }}>
          <p className="text-xs mb-2 font-medium" style={{ color: "var(--primary)" }}>新增品項</p>
          <div className="grid grid-cols-2 gap-2">
            <input className="input-sm col-span-2" placeholder="品名*"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="input-sm" placeholder="描述（選填）"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <input className="input-sm" type="number" placeholder="價格（NT$）*"
              value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            <label className="flex items-center gap-1 text-xs col-span-2" style={{ color: "var(--text-muted)" }}>
              <input type="checkbox" checked={form.is_unlimited}
                onChange={e => setForm(f => ({ ...f, is_unlimited: e.target.checked }))} />
              無限量（取消勾選可設最大份數）
            </label>
            {!form.is_unlimited && (
              <input className="input-sm" type="number" placeholder="最大份數"
                value={form.max_quantity} onChange={e => setForm(f => ({ ...f, max_quantity: e.target.value }))} />
            )}
          </div>
          <button className="btn-sm btn-primary mt-2" disabled={saving} onClick={handleAdd}>
            {saving ? "新增中…" : "+ 加入品項"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── 核銷管理 Tab ──────────────────────────────────────────────────────────────

function statusLabel(s: MealOrderStatus) {
  return { pending: "待確認", confirmed: "已確認", cancelled: "已取消", completed: "已領餐" }[s] ?? s;
}
function statusStyle(s: MealOrderStatus) {
  return {
    pending: { bg: "rgba(251,191,36,0.1)", color: "#fbbf24" },
    confirmed: { bg: "var(--primary-dim)", color: "var(--primary)" },
    cancelled: { bg: "rgba(239,68,68,0.08)", color: "#f87171" },
    completed: { bg: "rgba(52,211,153,0.1)", color: "#34d399" },
  }[s] ?? { bg: "transparent", color: "var(--text-muted)" };
}

export function PickupTab({
  vendors, schedules, onCompleteOrder, onConfirmOrder,
}: {
  vendors: MealVendorOut[];
  schedules: MenuScheduleListItem[];
  onCompleteOrder: (id: string) => Promise<void>;
  onConfirmOrder: (id: string) => Promise<void>;
}) {
  const [serial, setSerial] = useState("");
  const [lookupResult, setLookupResult] = useState<MealOrderOut | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [pickupSchedule, setPickupSchedule] = useState("");
  const [pickupList, setPickupList] = useState<PickupListItemOut[]>([]);
  const [pickupLoading, setPickupLoading] = useState(false);

  async function handleLookup(codeOverride?: string) {
    const code = (codeOverride ?? serial).trim();
    if (!code) return;
    setLookupLoading(true);
    setLookupError("");
    setLookupResult(null);
    try {
      const order = await mealApi.lookupByCode(code);
      setLookupResult(order);
    } catch (e: unknown) {
      setLookupError(e instanceof Error ? e.message : "查無此代碼");
    } finally { setLookupLoading(false); }
  }

  async function handlePickupListLoad(scheduleId: string) {
    setPickupSchedule(scheduleId);
    if (!scheduleId) { setPickupList([]); return; }
    setPickupLoading(true);
    try {
      const list = await mealApi.getPickupList(scheduleId);
      setPickupList(list);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "載入失敗");
    } finally { setPickupLoading(false); }
  }

  async function handleComplete(orderId: string) {
    setActionLoading(true);
    try {
      await onCompleteOrder(orderId);
      if (lookupResult?.id === orderId) {
        setLookupResult(r => r ? { ...r, status: "completed" } : r);
      }
      setPickupList(list => list.map(item =>
        item.order_id === orderId ? { ...item, status: "completed" } : item
      ));
    } finally { setActionLoading(false); }
  }

  async function handleConfirm(orderId: string) {
    setActionLoading(true);
    try {
      await onConfirmOrder(orderId);
      if (lookupResult?.id === orderId) {
        setLookupResult(r => r ? { ...r, status: "confirmed" } : r);
      }
      setPickupList(list => list.map(item =>
        item.order_id === orderId ? { ...item, status: "confirmed" } : item
      ));
    } finally { setActionLoading(false); }
  }

  const vendorMap = Object.fromEntries(vendors.map(v => [v.id, v.name]));

  const pickedCount = pickupList.filter(p => p.status === "completed").length;
  const pendingCount = pickupList.filter(p => p.status === "pending").length;
  const confirmedCount = pickupList.filter(p => p.status === "confirmed").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* ── 左：代碼查詢 ── */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            代碼核銷
          </h3>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl px-3 py-2 text-sm font-mono tracking-widest"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              placeholder="12345"
              maxLength={5}
              value={serial}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                setSerial(v);
                // 取餐碼輸入完整後自動查詢。
                if (v.length === 5) handleLookup(v);
              }}
              onKeyDown={e => e.key === "Enter" && handleLookup()}
            />
            <button
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ background: "var(--primary)", color: "var(--primary-fg)" }}
              disabled={lookupLoading || !serial.trim()}
              onClick={() => handleLookup()}>
              {lookupLoading ? "…" : "查詢"}
            </button>
          </div>

          {/* 查詢結果 */}
          {lookupError && (
            <div className="rounded-xl p-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <p className="text-sm" style={{ color: "#f87171" }}>{lookupError}</p>
            </div>
          )}

          {lookupResult && (() => {
            const st = statusStyle(lookupResult.status as MealOrderStatus);
            return (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                {/* 代碼 + 狀態 */}
                <div className="px-4 py-3 flex items-center justify-between"
                  style={{ background: "var(--card-bg)" }}>
                  <div>
                    <p className="text-3xl font-black font-mono" style={{ color: "var(--text-primary)", letterSpacing: "0.2em" }}>
                      {lookupResult.pickup_code}
                    </p>
                    <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {lookupResult.serial_number}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full font-semibold"
                    style={{ background: st.bg, color: st.color }}>
                    {statusLabel(lookupResult.status as MealOrderStatus)}
                  </span>
                </div>

                {/* 品項明細 */}
                <div className="px-4 py-3 space-y-1.5" style={{ background: "rgba(255,255,255,0.02)", borderTop: "1px solid var(--border)" }}>
                  {lookupResult.items.map(item => (
                    <div key={item.id} className="flex justify-between text-xs">
                      <span style={{ color: "var(--text-muted)" }}>× {item.quantity}</span>
                      <span className="font-medium flex-1 mx-2" style={{ color: "var(--text-primary)" }}>
                        {item.product_name_snapshot ?? `（品項 ID: ${(item.menu_item_id ?? item.availability_id ?? "").slice(0, 8)}…）`}
                      </span>
                      <span style={{ color: "var(--primary)" }}>NT${item.subtotal}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1 font-semibold text-sm"
                    style={{ borderTop: "1px solid var(--border)", color: "var(--text-primary)" }}>
                    <span>合計</span>
                    <span style={{ color: "var(--primary)" }}>NT${lookupResult.total_price}</span>
                  </div>
                </div>

                {/* 操作按鈕 */}
                <div className="px-4 py-3 flex gap-2" style={{ borderTop: "1px solid var(--border)", background: "var(--card-bg)" }}>
                  {lookupResult.status === "pending" && (
                    <button className="flex-1 py-2 rounded-lg text-xs font-semibold"
                      style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}
                      disabled={actionLoading}
                      onClick={() => handleConfirm(lookupResult.id)}>
                      確認訂單
                    </button>
                  )}
                  {(lookupResult.status === "pending" || lookupResult.status === "confirmed") && (
                    <button className="flex-1 py-2 rounded-lg text-xs font-semibold"
                      style={{ background: "rgba(52,211,153,0.1)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}
                      disabled={actionLoading}
                      onClick={() => handleComplete(lookupResult.id)}>
                      ✓ 確認領餐
                    </button>
                  )}
                  {lookupResult.status === "completed" && (
                    <div className="flex-1 py-2 rounded-lg text-xs font-semibold text-center"
                      style={{ background: "rgba(52,211,153,0.08)", color: "#34d399" }}>
                      已領餐 ✓
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── 右：領餐名單 ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>領餐名單</h3>
            {pickupList.length > 0 && (
              <div className="flex gap-1.5 text-[10px]">
                <span className="px-1.5 py-0.5 rounded" style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}>
                  已領 {pickedCount}
                </span>
                <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                  確認 {confirmedCount}
                </span>
                <span className="px-1.5 py-0.5 rounded" style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24" }}>
                  待確認 {pendingCount}
                </span>
              </div>
            )}
          </div>
          <select
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            value={pickupSchedule}
            onChange={e => handlePickupListLoad(e.target.value)}>
            <option value="">選擇排程…</option>
            {schedules.map(s => (
              <option key={s.id} value={s.id}>
                {s.date} — {vendorMap[s.vendor_id] ?? "未知"}
              </option>
            ))}
          </select>

          {pickupLoading && (
            <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>載入中…</p>
          )}

          {!pickupLoading && pickupList.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)", maxHeight: 480, overflowY: "auto" }}>
              {pickupList.map((item, idx) => {
                const st = statusStyle(item.status as MealOrderStatus);
                return (
                  <div key={item.order_id}
                    className="px-3 py-2.5 flex items-center gap-3"
                    style={{
                      background: idx % 2 === 0 ? "var(--card-bg)" : "rgba(255,255,255,0.02)",
                      borderBottom: "1px solid var(--border)",
                    }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                          {item.display_name}
                        </p>
                        {item.student_id && (
                          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>#{item.student_id}</p>
                        )}
                        {item.is_no_show && (
                          <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}>
                            未取餐
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono mt-0.5 tracking-widest" style={{ color: "var(--primary)" }}>
                        {item.pickup_code}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: st.bg, color: st.color }}>
                      {statusLabel(item.status as MealOrderStatus)}
                    </span>
                    <div className="flex-shrink-0 flex gap-1">
                      {item.status === "pending" && (
                        <button
                          className="text-[10px] px-2 py-1 rounded"
                          style={{ background: "var(--primary-dim)", color: "var(--primary)" }}
                          disabled={actionLoading}
                          onClick={() => handleConfirm(item.order_id)}>
                          確認
                        </button>
                      )}
                      {(item.status === "pending" || item.status === "confirmed") && (
                        <button
                          className="text-[10px] px-2 py-1 rounded"
                          style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}
                          disabled={actionLoading}
                          onClick={() => handleComplete(item.order_id)}>
                          領餐✓
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!pickupLoading && pickupSchedule && pickupList.length === 0 && (
            <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>此排程無訂單</p>
          )}
        </div>
      </div>
    </div>
  );
}
