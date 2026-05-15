"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { mealApi, ApiError } from "@/lib/api";
import type {
  MenuScheduleOut, MenuScheduleListItem, MealVendorOut,
  MealOrderOut, MenuItemSummary,
} from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";

// ── 品項分類（關鍵字推導） ────────────────────────────────────────────────────

type ItemCategory = "全部" | "主食" | "麵食" | "湯品" | "飲料" | "點心" | "其他";

function inferCategory(name: string): ItemCategory {
  if (/飯|便當|丼|炒飯|粽/.test(name)) return "主食";
  if (/麵|米粉|冬粉|粄條|拉麵|烏龍|義大利/.test(name)) return "麵食";
  if (/湯|羹|燉/.test(name)) return "湯品";
  if (/飲料|茶|咖啡|拿鐵|豆漿|奶茶|果汁|水|可樂|沙瓦/.test(name)) return "飲料";
  if (/蛋糕|甜點|布丁|冰|麵包|餅乾|點心|吐司/.test(name)) return "點心";
  return "其他";
}

const CATEGORIES: ItemCategory[] = ["全部", "主食", "麵食", "湯品", "飲料", "點心", "其他"];

// ── 取餐時間格式化 ────────────────────────────────────────────────────────────

function fmtPickup(date: string, deadline: string) {
  const d = new Date(date);
  const dl = new Date(deadline);
  const dateStr = d.toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "short" });
  const timeStr = dl.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  return { dateStr, deadlineStr: timeStr };
}

// ── 倒數標籤 ─────────────────────────────────────────────────────────────────

function DeadlineBadge({ schedule }: { schedule: MenuScheduleListItem }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
  }, []);
  if (now === null) {
    return (
      <span className="badge" style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", borderColor: "var(--border)" }}>
        計算中
      </span>
    );
  }
  const deadline = new Date(schedule.order_deadline).getTime();
  const openTime = schedule.order_open_time ? new Date(schedule.order_open_time).getTime() : null;
  const diff = Math.round((deadline - now) / 60000);

  if (openTime && now < openTime) {
    const openIn = Math.round((openTime - now) / 60000);
    return (
      <span className="badge" style={{ background: "var(--status-upcoming-dim)", color: "var(--status-upcoming)", border: "1px solid var(--status-upcoming-border)" }}>
        {openIn < 60 ? `${openIn} 分後開放` : `${Math.round(openIn / 60)} 時後開放`}
      </span>
    );
  }
  if (schedule.is_closed || diff < 0) {
    return (
      <span className="badge" style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", borderColor: "var(--border)" }}>
        已結單
      </span>
    );
  }
  if (diff < 30) {
    return (
      <span className="badge animate-pulse" style={{ color: "var(--danger)", background: "var(--danger-dim)", borderColor: "var(--danger)" }}>
        剩 {diff} 分鐘！
      </span>
    );
  }
  return (
    <span className="badge" style={{ color: "var(--success)", background: "var(--success-dim)", borderColor: "var(--success)" }}>
      接受訂餐
    </span>
  );
}

// ── 訂餐 Modal（3 步驟：選擇 → 確認 → 成功） ─────────────────────────────────

type OrderStep = "select" | "confirm" | "success";

function OrderModal({
  schedule, vendorName, itemStats, onClose, onDone,
}: {
  schedule: MenuScheduleOut;
  vendorName: string;
  itemStats: Record<string, number>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<OrderStep>("select");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<ItemCategory>("全部");
  const [successOrder, setSuccessOrder] = useState<MealOrderOut | null>(null);

  // U10: ESC 關閉 modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "success") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [step, onClose]);

  const availableItems = schedule.items.filter(i => i.is_available);

  // 人氣排序：依 itemStats 降序，同分依名稱升序
  const sortedItems = useMemo(() => {
    return [...availableItems].sort((a, b) => {
      const ca = itemStats[a.id] ?? 0;
      const cb = itemStats[b.id] ?? 0;
      if (cb !== ca) return cb - ca;
      return a.name.localeCompare(b.name, "zh-TW");
    });
  }, [availableItems, itemStats]);

  const filteredItems = useMemo(() =>
    category === "全部" ? sortedItems : sortedItems.filter(i => inferCategory(i.name) === category),
  [sortedItems, category]);

  const usedCategories = useMemo(() => {
    const cats = new Set(sortedItems.map(i => inferCategory(i.name)));
    return CATEGORIES.filter(c => c === "全部" || cats.has(c));
  }, [sortedItems]);

  const setQty = (itemId: string, qty: number) => {
    // F3: 同時限制全域上限(20)與品項 max_quantity
    const item = availableItems.find(i => i.id === itemId);
    const cap = Math.min(20, item?.max_quantity ?? 20);
    setQuantities(prev => {
      const next = { ...prev };
      if (qty <= 0) delete next[itemId];
      else next[itemId] = Math.min(qty, cap);
      return next;
    });
  };

  const totalPrice = availableItems.reduce((s, item) => s + item.price * (quantities[item.id] ?? 0), 0);
  const selectedItems = availableItems.filter(i => (quantities[i.id] ?? 0) > 0);
  const hasItems = selectedItems.length > 0;

  const { dateStr, deadlineStr } = fmtPickup(schedule.date, schedule.order_deadline);

  const submit = async () => {
    if (!hasItems) { toast.error("請至少選擇一項餐點"); return; }
    setLoading(true);
    try {
      const order = await mealApi.createOrder({
        schedule_id: schedule.id,
        items: Object.entries(quantities)
          .filter(([, qty]) => qty > 0)
          .map(([menu_item_id, quantity]) => ({ menu_item_id, quantity })),
        notes: notes || undefined,
      });
      setSuccessOrder(order);
      setStep("success");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error("您已對此排程訂餐，每日限訂一次");
      } else {
        toast.error(e instanceof ApiError ? e.message : "訂餐失敗");
      }
    } finally { setLoading(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "rgba(0,0,0,0.65)" }}
      role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={step === "success" ? undefined : onClose} aria-hidden="true" />
      <div
        className="relative w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "92vh", background: "var(--bg-surface)", border: "1px solid var(--border)", boxShadow: "0 25px 50px rgba(0,0,0,0.5)" }}>

        {/* ── Step: 選擇品項 ── */}
        {step === "select" && (
          <>
            {/* Header */}
            <div className="px-5 pt-5 pb-3 flex-shrink-0">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  {/* U1: 步驟指示器 */}
                  <div className="flex items-center gap-1.5 mb-2">
                    {(["select", "confirm", "success"] as OrderStep[]).map((s, i) => {
                      const stepIdx = ["select", "confirm", "success"].indexOf(step);
                      return (
                        <div key={s} className="rounded-full transition-all duration-300"
                          style={{
                            height: "6px",
                            width: s === step ? "20px" : "6px",
                            background: i < stepIdx ? "var(--success)" : s === step ? "var(--primary)" : "var(--border-strong)",
                          }} />
                      );
                    })}
                    <span className="text-[10px] ml-1" style={{ color: "var(--text-muted)" }}>1 / 3</span>
                  </div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{vendorName}</p>
                  <h3 className="text-base font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>
                    {dateStr} 供餐
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    結單 {deadlineStr} · 已選 {selectedItems.length} 項
                  </p>
                </div>
                <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  aria-label="關閉訂餐視窗"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* 分類 Chips */}
              {usedCategories.length > 2 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
                  {usedCategories.map(cat => (
                    <button key={cat} onClick={() => setCategory(cat)}
                      className="flex-shrink-0 text-xs px-3 py-1 rounded-full transition-all"
                      style={cat === category
                        ? { background: "var(--primary)", color: "var(--primary-fg)", fontWeight: 600 }
                        : { background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto px-5 space-y-2 pb-3">
              {filteredItems.length === 0 && (
                <p className="text-sm text-center py-10" style={{ color: "var(--text-muted)" }}>此分類無品項</p>
              )}
              {filteredItems.map((item, idx) => {
                const qty = quantities[item.id] ?? 0;
                const count = itemStats[item.id] ?? 0;
                const isTop = idx === 0 && count > 0;
                return (
                  <div key={item.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 transition-all"
                    style={{
                      background: qty > 0 ? "var(--primary-dim)" : "var(--bg-surface)",
                      border: `1px solid ${qty > 0 ? "var(--border-strong)" : "var(--border)"}`,
                    }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.name}</p>
                        {isTop && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0"
                            style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8 7 6 10 6 14a6 6 0 0 0 12 0c0-4-2-7-6-12zM9.5 16a2.5 2.5 0 0 1 5 0c0 1.38-1.12 2.5-2.5 2.5S9.5 17.38 9.5 16z"/></svg>
                            最熱門
                          </span>
                        )}
                        {count > 0 && !isTop && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: "rgba(52,211,153,0.08)", color: "#34d399" }}>
                            已點 {count} 份
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>{item.description}</p>
                      )}
                      <p className="text-xs font-semibold mt-0.5" style={{ color: "var(--primary)" }}>
                        NT${item.price.toLocaleString()}
                        {item.max_quantity && (
                          <span className="ml-1.5 font-normal opacity-60">限量 {item.max_quantity} 份</span>
                        )}
                      </p>
                    </div>
                    {/* U2: 44px touch target (WCAG) */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => setQty(item.id, qty - 1)}
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold transition-colors"
                        aria-label={`減少 ${item.name}`}
                        style={{ background: qty > 0 ? "rgba(239,68,68,0.1)" : "var(--bg-elevated)", color: qty > 0 ? "#f87171" : "var(--text-muted)", border: "1px solid var(--border)" }}>
                        −
                      </button>
                      <span className="text-sm font-bold w-6 text-center" style={{ color: "var(--text-primary)" }}>{qty}</span>
                      <button onClick={() => setQty(item.id, qty + 1)}
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold transition-colors"
                        aria-label={`增加 ${item.name}`}
                        style={{ background: qty > 0 ? "var(--primary)" : "var(--bg-elevated)", color: qty > 0 ? "var(--primary-fg)" : "var(--text-muted)", border: "1px solid var(--border)" }}>
                        ＋
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer — U5: 永遠顯示摘要列，行動端不會因滾動而消失 */}
            <div className="px-5 pb-5 pt-3 flex-shrink-0 space-y-3"
              style={{ borderTop: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between px-3 py-2 rounded-xl transition-all"
                style={{
                  background: hasItems ? "var(--primary-dim)" : "var(--bg-surface)",
                  border: `1px solid ${hasItems ? "var(--border-strong)" : "var(--border)"}`,
                }}>
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {hasItems
                    ? `已選 ${selectedItems.length} 種 · ${Object.values(quantities).reduce((a, b) => a + b, 0)} 份`
                    : "尚未選擇品項"}
                </span>
                <span className="text-base font-bold" style={{ color: hasItems ? "var(--primary)" : "var(--text-muted)" }}>
                  NT${totalPrice.toLocaleString()}
                </span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => hasItems && setStep("confirm")}
                  disabled={!hasItems}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                  style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                  前往確認 →
                </button>
                <button onClick={onClose}
                  className="px-5 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                  取消
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Step: 確認訂單 ── */}
        {step === "confirm" && (
          <>
            <div className="px-5 pt-5 pb-3 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-3">
                <button onClick={() => setStep("select")}
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  aria-label="返回選擇品項"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div className="flex-1 min-w-0">
                  {/* U1: 步驟指示器 */}
                  <div className="flex items-center gap-1.5 mb-1">
                    {(["select", "confirm", "success"] as OrderStep[]).map((s, i) => {
                      const stepIdx = ["select", "confirm", "success"].indexOf(step);
                      return (
                        <div key={s} className="rounded-full transition-all duration-300"
                          style={{
                            height: "6px",
                            width: s === step ? "20px" : "6px",
                            background: i < stepIdx ? "var(--success)" : s === step ? "var(--primary)" : "var(--border-strong)",
                          }} />
                      );
                    })}
                    <span className="text-[10px] ml-1" style={{ color: "var(--text-muted)" }}>2 / 3</span>
                  </div>
                  <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>確認訂單</h3>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{vendorName} · {dateStr}</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* 取餐資訊卡 */}
              <div className="rounded-xl p-4 space-y-2"
                style={{ background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--primary)" }}>取餐資訊</p>
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--primary)", flexShrink: 0 }}>
                    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>{dateStr}</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--primary)", flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>結單時間 {deadlineStr}</span>
                </div>
              </div>

              {/* 品項清單 */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>訂餐明細</p>
                <div className="space-y-2">
                  {selectedItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-3 py-2"
                      style={{ borderBottom: "1px solid var(--border)" }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: "var(--text-primary)" }}>{item.name}</p>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                          NT${item.price} × {quantities[item.id]}
                        </p>
                      </div>
                      <span className="text-sm font-semibold" style={{ color: "var(--primary)" }}>
                        NT${(item.price * quantities[item.id]).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-3">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>合計</span>
                  <span className="text-xl font-bold" style={{ color: "var(--primary)" }}>
                    NT${totalPrice.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* 備註 U7: textarea + 字數計數 */}
              <div>
                <label className="text-xs font-medium flex items-center justify-between mb-1.5">
                  <span style={{ color: "var(--text-secondary)" }}>備註（選填）</span>
                  <span style={{ color: notes.length > 180 ? "var(--danger)" : "var(--text-muted)" }}>
                    {notes.length}/200
                  </span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value.slice(0, 200))}
                  placeholder="過敏、加辣、不加蔥…"
                  rows={2}
                  className="input w-full resize-none"
                  style={{ minHeight: "56px" }}
                />
              </div>
            </div>

            <div className="px-5 pb-5 pt-3 flex-shrink-0 flex gap-2" style={{ borderTop: "1px solid var(--border)" }}>
              <button onClick={submit} disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                {loading ? "送出中…" : "確認訂餐"}
              </button>
              <button onClick={() => setStep("select")}
                className="px-5 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                修改
              </button>
            </div>
          </>
        )}

        {/* ── Step: 訂餐成功 ── */}
        {step === "success" && successOrder && (
          <div className="flex flex-col items-center px-6 py-8 text-center space-y-5">
            {/* 成功圖示 */}
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "rgba(52,211,153,0.15)", border: "2px solid rgba(52,211,153,0.4)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <div>
              <p className="text-base font-semibold" style={{ color: "#34d399" }}>訂餐成功！</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{vendorName} · {dateStr}</p>
            </div>

            {/* U3: 取餐代碼 — 點擊複製 */}
            <button
              className="w-full rounded-2xl p-5 text-center active:scale-95 transition-transform"
              style={{ background: "var(--primary-dim)", border: "2px solid var(--border-strong)" }}
              onClick={() => {
                navigator.clipboard.writeText(successOrder.pickup_code)
                  .then(() => toast.success("已複製取餐代碼"))
                  .catch(() => {});
              }}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--primary)" }}>
                取餐代碼（點擊複製）
              </p>
              <p className="text-6xl font-black" style={{ color: "var(--text-primary)", fontFamily: "monospace", letterSpacing: "0.3em" }}>
                {successOrder.pickup_code}
              </p>
              <p className="text-xs mt-3 flex items-center justify-center gap-1" style={{ color: "var(--text-muted)" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                截圖或點此複製，取餐時出示給商家
              </p>
            </button>

            {/* 訂單摘要 */}
            <div className="w-full text-left space-y-1.5">
              {selectedItems.map(item => (
                <div key={item.id} className="flex justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                  <span>{item.name} × {quantities[item.id]}</span>
                  <span>NT${(item.price * quantities[item.id]).toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold pt-1"
                style={{ borderTop: "1px solid var(--border)", color: "var(--text-primary)" }}>
                <span>合計</span>
                <span style={{ color: "var(--primary)" }}>NT${totalPrice.toLocaleString()}</span>
              </div>
            </div>

            <div className="w-full flex gap-2 pt-2">
              <button onClick={() => { onDone(); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                完成
              </button>
              <Link href="/meal/orders"
                className="px-4 py-2.5 rounded-xl text-sm flex items-center"
                style={{ background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                查看訂單
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 排程卡片 ──────────────────────────────────────────────────────────────────

function ScheduleCard({
  schedule, vendor, itemStats, onOrder,
}: {
  schedule: MenuScheduleListItem;
  vendor: MealVendorOut;
  itemStats: Record<string, number>;
  onOrder: (s: MenuScheduleOut, v: MealVendorOut) => void;
}) {
  const [detail, setDetail] = useState<MenuScheduleOut | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const deadline = new Date(schedule.order_deadline);
  const openTime = schedule.order_open_time ? new Date(schedule.order_open_time) : null;
  const now = new Date();
  const isBeforeOpen = openTime !== null && now < openTime;
  const isOpen = !schedule.is_closed && deadline > now && !isBeforeOpen;
  const diffMin = Math.round((deadline.getTime() - now.getTime()) / 60000);

  const handleExpand = useCallback(async () => {
    if (detail) { setExpanded(e => !e); return; }
    setLoadingDetail(true);
    setExpanded(true);
    try {
      const d = await mealApi.getSchedule(schedule.id);
      setDetail(d);
    } catch { toast.error("載入排程詳情失敗"); setExpanded(false); }
    finally { setLoadingDetail(false); }
  }, [detail, schedule.id]);

  const handleOrder = () => {
    if (!detail) return;
    onOrder(detail, vendor);
  };

  // 找出最熱門的 3 個品項名稱（來自 itemStats key=item_id）
  const topItemIds = Object.entries(itemStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  return (
    <div className="card overflow-hidden"
      style={isOpen && diffMin < 30 ? { borderColor: "rgba(239,68,68,0.4)" } : {}}>
      {/* 卡片頭部：點擊展開/收合 */}
      <button className="w-full text-left p-4 flex items-start gap-3" onClick={handleExpand}>
        {/* 商家頭像 */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0"
          style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
          {vendor.name.charAt(0)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{vendor.name}</p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>
                {new Date(schedule.date).toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "short" })}
              </p>
            </div>
            <DeadlineBadge schedule={schedule} />
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <p className="text-xs" style={{ color: isOpen ? (diffMin < 30 ? "var(--danger)" : "var(--text-muted)") : "var(--text-disabled)" }}>
              {isOpen ? `截單 ${diffMin < 60 ? `${diffMin}分鐘後` : deadline.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
            {/* 熱門品項預覽 */}
            {topItemIds.length > 0 && detail && (
              <div className="flex gap-1 flex-wrap">
                {topItemIds.slice(0, 2).map(id => {
                  const item = detail.items.find(i => i.id === id);
                  return item ? (
                    <span key={id} className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24" }}>
                      {item.name}
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </div>
        </div>

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: "var(--text-muted)", flexShrink: 0, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "none" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* 展開區域：品項列表 */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {loadingDetail ? (
            /* U4: Skeleton loader */
            <div className="px-4 py-3 space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3 py-2 animate-pulse">
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 rounded w-3/4" style={{ background: "var(--bg-hover)" }} />
                    <div className="h-3 rounded w-1/3" style={{ background: "var(--bg-elevated)" }} />
                  </div>
                  <div className="h-4 rounded w-12" style={{ background: "var(--bg-hover)" }} />
                </div>
              ))}
            </div>
          ) : detail ? (
            <>
              {/* 品項 */}
              <div className="px-4 py-3 space-y-2">
                {detail.items.length === 0 ? (
                  <p className="text-sm py-2" style={{ color: "var(--text-muted)" }}>此排程尚無品項</p>
                ) : (
                  [...detail.items]
                    .sort((a, b) => (itemStats[b.id] ?? 0) - (itemStats[a.id] ?? 0))
                    .map((item: MenuItemSummary, idx) => {
                      const count = itemStats[item.id] ?? 0;
                      return (
                        <div key={item.id}
                          className="flex items-center gap-3 py-2"
                          style={{ borderBottom: "1px solid var(--border)", opacity: item.is_available ? 1 : 0.5 }}>
                          {idx === 0 && count > 0 ? (
                            <span className="w-5 h-5 flex items-center justify-center flex-shrink-0" style={{ color: "#fbbf24" }} aria-label="最熱門">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8 7 6 10 6 14a6 6 0 0 0 12 0c0-4-2-7-6-12z"/></svg>
                            </span>
                          ) : (
                            <span className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.name}</p>
                            {item.description && (
                              <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{item.description}</p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold" style={{ color: "var(--primary)" }}>NT${item.price}</p>
                            {count > 0 && (
                              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>已點 {count} 份</p>
                            )}
                            {!item.is_available && (
                              <p className="text-[10px]" style={{ color: "var(--danger)" }}>暫停供應</p>
                            )}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              {/* 訂餐按鈕 */}
              {schedule.note && (
                <p className="px-4 py-2 text-xs" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
                  備注：{schedule.note}
                </p>
              )}
              <div className="px-4 pb-4 pt-2">
                <button onClick={handleOrder}
                  disabled={!isOpen}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                  style={isOpen
                    ? { background: "var(--primary)", color: "var(--primary-fg)" }
                    : { background: "var(--bg-surface)", color: "var(--text-disabled)", border: "1px solid var(--border)" }}>
                  {isBeforeOpen ? "尚未開放訂餐" : isOpen ? "立即訂餐" : "已結單"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── 主頁面 ─────────────────────────────────────────────────────────────────────

export default function MealPage() {
  const { can } = usePermissions();
  const isManager = can("meal:manage");

  const [vendors, setVendors] = useState<MealVendorOut[]>([]);
  const [schedules, setSchedules] = useState<MenuScheduleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState<{ schedule: MenuScheduleOut; vendor: MealVendorOut } | null>(null);
  const [itemStats, setItemStats] = useState<Record<string, Record<string, number>>>({});

  // 篩選狀態
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const [v, s] = await Promise.all([
        mealApi.listVendors({ active_only: !isManager }),
        mealApi.listSchedules({ date_from: today }),
      ]);
      setVendors(v);
      setSchedules(s);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入失敗");
    } finally { setLoading(false); }
  }, [isManager]);

  useEffect(() => { load(); }, [load]);

  // P2: 用 useRef 追蹤已載入的 scheduleId，避免 stale closure 問題
  const loadedStatsRef = useRef<Set<string>>(new Set());
  const loadItemStats = useCallback(async (scheduleId: string) => {
    if (loadedStatsRef.current.has(scheduleId)) return;
    loadedStatsRef.current.add(scheduleId);
    try {
      const stats = await mealApi.getScheduleItemStats(scheduleId);
      const map: Record<string, number> = {};
      for (const s of stats) map[s.item_id] = s.total_ordered;
      setItemStats(prev => ({ ...prev, [scheduleId]: map }));
    } catch {
      // stats 失敗不影響訂餐流程，但移除已標記避免永久失敗
      loadedStatsRef.current.delete(scheduleId);
    }
  }, []);

  const vendorMap = useMemo(
    () => Object.fromEntries(vendors.map(v => [v.id, v])),
    [vendors],
  );

  // 過濾排程
  const filtered = useMemo(() => {
    let list = schedules;
    if (vendorFilter !== "all") list = list.filter(s => s.vendor_id === vendorFilter);
    if (!showClosed) {
      list = list.filter(s => {
        const dl = new Date(s.order_deadline);
        return !s.is_closed && dl > new Date();
      });
    }
    return list;
  }, [schedules, vendorFilter, showClosed]);

  const openCount = useMemo(() => schedules.filter(s => {
    const dl = new Date(s.order_deadline);
    const ot = s.order_open_time ? new Date(s.order_open_time) : null;
    return !s.is_closed && dl > new Date() && !(ot && new Date() < ot);
  }).length, [schedules]);

  const vendorsWithSchedules = useMemo(() => {
    const ids = new Set(schedules.map(s => s.vendor_id));
    return vendors.filter(v => ids.has(v.id));
  }, [vendors, schedules]);

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* 頁首 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>學餐訂購</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            {openCount > 0 ? `${openCount} 個排程開放訂餐中` : "目前無開放排程"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <Link href="/meal/vendor" className="btn btn-ghost text-xs px-3 py-2">
              商家管理 →
            </Link>
          )}
          <Link href="/meal/orders" className="btn btn-ghost">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
            </svg>
            我的訂單
          </Link>
        </div>
      </div>

      {/* 商家篩選 Chips */}
      {vendorsWithSchedules.length > 1 && !loading && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button onClick={() => setVendorFilter("all")}
            className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-all"
            style={vendorFilter === "all"
              ? { background: "var(--primary)", color: "var(--primary-fg)" }
              : { background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            全部
          </button>
          {vendorsWithSchedules.map(v => (
            <button key={v.id} onClick={() => setVendorFilter(v.id)}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-all"
              style={vendorFilter === v.id
                ? { background: "var(--primary)", color: "var(--primary-fg)" }
                : { background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              {v.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
          <div className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
            style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }} role="status" />
          <p className="text-sm">載入中…</p>
        </div>
      ) : (
        <>
          {/* 排程列表 */}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filtered.map(s => (
                <ScheduleCard
                  key={s.id}
                  schedule={s}
                  vendor={vendorMap[s.vendor_id] ?? { id: s.vendor_id, name: "未知商家" } as MealVendorOut}
                  itemStats={itemStats[s.id] ?? {}}
                  onOrder={(schedule, vendor) => {
                    setOrdering({ schedule, vendor });
                    loadItemStats(schedule.id);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.5" className="mx-auto mb-3 opacity-40">
                <path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
                <line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
              </svg>
              <p className="text-sm">目前沒有可訂餐的菜單排程</p>
              {showClosed
                ? <p className="text-xs mt-1">請稍後再試，或聯繫餐廳管理員</p>
                : (
                  <button onClick={() => setShowClosed(true)}
                    className="text-xs mt-2 underline" style={{ color: "var(--primary)" }}>
                    顯示已結單排程
                  </button>
                )}
            </div>
          )}

          {/* 顯示已結單排程切換 */}
          {filtered.length > 0 && (
            <button onClick={() => setShowClosed(c => !c)}
              className="text-xs flex items-center gap-1.5 mx-auto"
              style={{ color: "var(--text-muted)" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points={showClosed ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
              </svg>
              {showClosed ? "隱藏已結單排程" : "顯示已結單排程"}
            </button>
          )}
        </>
      )}

      {ordering && (
        <OrderModal
          schedule={ordering.schedule}
          vendorName={ordering.vendor.name}
          itemStats={itemStats[ordering.schedule.id] ?? {}}
          onClose={() => setOrdering(null)}
          onDone={() => { setOrdering(null); load(); }}
        />
      )}
    </div>
  );
}
