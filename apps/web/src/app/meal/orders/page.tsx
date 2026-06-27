"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { mealApi, apiErrorMessage } from "@/lib/api";
import type { MealOrderListItem, MealOrderOut, MealOrderStatus, MenuScheduleListItem, MealVendorOut } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";

const STATUS_CFG: Record<MealOrderStatus, { label: string; color: string; bg: string; border: string }> = {
  pending:   { label: "待確認", color: "var(--warning)",    bg: "var(--warning-dim)",   border: "var(--warning)" },
  confirmed: { label: "已確認", color: "var(--success)",    bg: "var(--success-dim)",   border: "var(--success)" },
  cancelled: { label: "已取消", color: "var(--text-muted)", bg: "var(--bg-elevated)",   border: "var(--border)" },
  completed: { label: "已完成", color: "var(--info)",       bg: "var(--info-dim)",      border: "var(--info)" },
};

// ── 展開式訂單列 ──────────────────────────────────────────────────────────────

function OrderRow({
  order,
  onCancel, onConfirm, onComplete,
  isManager,
  selected, onSelect,
}: {
  order: MealOrderListItem;
  onCancel?: (id: string) => Promise<void>;
  onConfirm?: (id: string) => Promise<void>;
  onComplete?: (id: string) => Promise<void>;
  isManager: boolean;
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<MealOrderOut | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [acting, setActing] = useState(false);
  const cfg = STATUS_CFG[order.status];

  const expand = async () => {
    setExpanded(e => !e);
    if (!detail && !expanded) {
      setLoadingDetail(true);
      try {
        const d = await mealApi.getOrder(order.id);
        setDetail(d);
      } catch { toast.error("載入訂單詳情失敗"); }
      finally { setLoadingDetail(false); }
    }
  };

  const act = async (fn: (id: string) => Promise<void>, id: string) => {
    setActing(true);
    try { await fn(id); }
    finally { setActing(false); }
  };

  return (
    <li>
      {/* 主行 */}
      <div
        className="flex items-center gap-4 px-5 py-4 transition-colors cursor-pointer select-none"
        style={{ borderBottom: "1px solid var(--border)" }}
        onClick={expand}>

        {/* 批次選取核取框（僅待確認訂單） */}
        {onSelect && order.status === "pending" && (
          <div onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={e => onSelect(order.id, e.target.checked)}
              className="accent-sky-400 w-4 h-4 flex-shrink-0"
              aria-label={`選取訂單 ${order.serial_number}`}
            />
          </div>
        )}
        {onSelect && order.status !== "pending" && (
          <div className="w-4 flex-shrink-0" aria-hidden="true" />
        )}

        {/* 展開箭頭 */}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" style={{ color: "var(--text-muted)", flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>

        {/* 字號 + 日期 */}
        <div className="flex-shrink-0 min-w-0">
          <p className="text-xs font-mono" style={{ color: "var(--primary)" }}>{order.serial_number}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {new Date(order.created_at).toLocaleDateString("zh-TW")}
          </p>
        </div>

        {/* 金額 */}
        <div className="flex-1 text-center">
          <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            NT${order.total_price.toLocaleString()}
          </p>
        </div>

        {/* 狀態 */}
        <span
          className="badge flex-shrink-0"
          style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
          {cfg.label}
        </span>

        {/* 操作按鈕 */}
        <div className="flex gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {order.status === "pending" && onCancel && (
            <button
              onClick={() => act(onCancel, order.id)}
              disabled={acting}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
              style={{ color: "var(--danger)", border: "1px solid rgba(239,68,68,0.3)" }}>
              {acting ? "處理中…" : "取消"}
            </button>
          )}
          {isManager && order.status === "pending" && onConfirm && (
            <button
              onClick={() => act(onConfirm, order.id)}
              disabled={acting}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
              style={{ color: "var(--success)", border: "1px solid rgba(34,197,94,0.3)", background: "var(--success-dim)" }}>
              確認
            </button>
          )}
          {isManager && order.status === "confirmed" && onComplete && (
            <button
              onClick={() => act(onComplete, order.id)}
              disabled={acting}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
              style={{ color: "var(--info)", border: "1px solid rgba(59,130,246,0.3)", background: "var(--info-dim)" }}>
              完成取餐
            </button>
          )}
        </div>
      </div>

      {/* 展開的品項明細 */}
      {expanded && (
        <div className="px-6 py-3 space-y-2" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
          {loadingDetail ? (
            <p className="text-xs text-center py-2" style={{ color: "var(--text-muted)" }}>載入中…</p>
          ) : detail ? (
            <>
              {detail.items.map(item => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                      {item.quantity}
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {item.product_name_snapshot ?? `品項 #${(item.menu_item_id ?? item.availability_id ?? "").slice(-6)}`}
                    </span>
                  </div>
                  <span style={{ color: "var(--text-primary)" }}>
                    NT${item.subtotal.toLocaleString()}
                    <span className="ml-1" style={{ color: "var(--text-muted)" }}>
                      ({item.quantity} × NT${item.unit_price})
                    </span>
                  </span>
                </div>
              ))}
              {detail.notes && (
                <p className="text-xs pt-1 mt-1" style={{ color: "var(--text-muted)", borderTop: "1px dashed var(--border)" }}>
                  備註：{detail.notes}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>無法載入明細</p>
          )}
        </div>
      )}
    </li>
  );
}

// ── 商家管理面板（meal:manage） ────────────────────────────────────────────────

function VendorDashboard() {
  const [vendors, setVendors] = useState<MealVendorOut[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [schedules, setSchedules] = useState<MenuScheduleListItem[]>([]);
  const [selectedSchedule, setSelectedSchedule] = useState<string>("");
  const [orders, setOrders] = useState<MealOrderListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statsMode, setStatsMode] = useState<"all" | "pending" | "confirmed">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchConfirming, setBatchConfirming] = useState(false);

  useEffect(() => {
    mealApi.listVendors({ active_only: false })
      .then(v => { setVendors(v); if (v.length) setSelectedVendor(v[0].id); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedVendor) return;
    const today = new Date();
    const pastMonth = new Date(today);
    pastMonth.setDate(today.getDate() - 30);
    mealApi.listSchedules({
      vendor_id: selectedVendor,
      date_from: pastMonth.toISOString().split("T")[0],
    }).then(s => {
      const sorted = [...s].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      setSchedules(sorted);
      setSelectedSchedule(sorted[0]?.id ?? "");
    }).catch(() => {});
  }, [selectedVendor]);

  const loadOrders = useCallback(async () => {
    if (!selectedSchedule) { setOrders([]); return; }
    setLoading(true);
    try {
      const all = await mealApi.listOrders({ my_only: false, schedule_id: selectedSchedule, limit: 100 });
      setOrders(all);
    } catch (e) { toast.error(apiErrorMessage(e, "載入失敗")); }
    finally { setLoading(false); }
  }, [selectedSchedule]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const handleConfirm = async (id: string) => {
    try { await mealApi.confirmOrder(id); toast.success("已確認"); await loadOrders(); }
    catch (e) { toast.error(apiErrorMessage(e, "操作失敗")); }
  };

  const handleBatchConfirm = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`確定批次確認 ${selectedIds.size} 筆待確認訂單？`)) return;
    setBatchConfirming(true);
    let succeeded = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try { await mealApi.confirmOrder(id); succeeded++; }
      catch { failed++; }
    }
    setBatchConfirming(false);
    setSelectedIds(new Set());
    if (failed > 0) toast.error(`${succeeded} 筆成功，${failed} 筆失敗`);
    else toast.success(`已批次確認 ${succeeded} 筆訂單`);
    await loadOrders();
  };

  const handleSelectOrder = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleComplete = async (id: string) => {
    try { await mealApi.completeOrder(id); toast.success("已標記完成"); await loadOrders(); }
    catch (e) { toast.error(apiErrorMessage(e, "操作失敗")); }
  };

  const filtered = orders.filter(o =>
    statsMode === "all" ? true : o.status === statsMode
  );

  const pendingOrders = filtered.filter(o => o.status === "pending");
  const allPendingSelected = pendingOrders.length > 0 && pendingOrders.every(o => selectedIds.has(o.id));

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      pendingOrders.forEach(o => { if (checked) next.add(o.id); else next.delete(o.id); });
      return next;
    });
  };

  const stats = {
    total:     orders.length,
    pending:   orders.filter(o => o.status === "pending").length,
    confirmed: orders.filter(o => o.status === "confirmed").length,
    completed: orders.filter(o => o.status === "completed").length,
    cancelled: orders.filter(o => o.status === "cancelled").length,
    revenue:   orders.filter(o => o.status !== "cancelled").reduce((s, o) => s + o.total_price, 0),
  };

  const downloadReport = async (format: "xlsx" | "csv") => {
    try {
      const res = await mealApi.downloadReport(format, { schedule_id: selectedSchedule || undefined });
      if (!res.ok) { toast.error("匯出失敗"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `meal_orders.${format}`; a.click();
      URL.revokeObjectURL(url);
      toast.success(`已匯出 ${format.toUpperCase()}`);
    } catch { toast.error("匯出失敗"); }
  };

  const selectedScheduleInfo = schedules.find(s => s.id === selectedSchedule);

  return (
    <div className="space-y-4">
      {/* 篩選器 */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>商家</label>
            <select
              value={selectedVendor}
              onChange={e => setSelectedVendor(e.target.value)}
              className="input w-full text-sm">
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.name}{!v.is_active ? " (停用)" : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>供餐排程</label>
            <select
              value={selectedSchedule}
              onChange={e => setSelectedSchedule(e.target.value)}
              className="input w-full text-sm">
              {schedules.length === 0
                ? <option value="">（無排程）</option>
                : schedules.map(s => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.date).toLocaleDateString("zh-TW")}
                    {s.is_closed ? " [已結單]" : " [開放中]"}
                  </option>
                ))}
            </select>
          </div>
        </div>
        {selectedScheduleInfo && (
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              截單時間：{new Date(selectedScheduleInfo.order_deadline).toLocaleString("zh-TW")}
            </p>
            <div className="flex gap-2">
              <button onClick={() => downloadReport("xlsx")}
                className="btn btn-ghost text-xs px-3 py-1.5">
                匯出 Excel
              </button>
              <button onClick={() => downloadReport("csv")}
                className="btn btn-ghost text-xs px-3 py-1.5">
                匯出 CSV
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 統計卡片 */}
      {orders.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: "總訂單", value: stats.total, key: "all" },
            { label: "待確認", value: stats.pending, key: "pending" },
            { label: "已確認", value: stats.confirmed, key: "confirmed" },
            { label: "已完成", value: stats.completed, key: null },
            { label: "已取消", value: stats.cancelled, key: null },
            { label: "總營收", value: `NT$${stats.revenue.toLocaleString()}`, key: null },
          ].map(({ label, value, key }) => (
            <button
              key={label}
              onClick={() => key && setStatsMode(key as typeof statsMode)}
              className="card p-3 text-center transition-colors"
              style={key && statsMode === key
                ? { border: "1px solid var(--primary)", background: "var(--primary-dim)" }
                : {}}
              disabled={!key}>
              <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
              <p className="text-base font-bold" style={{ color: "var(--primary)" }}>{value}</p>
            </button>
          ))}
        </div>
      )}

      {/* 訂單列表 */}
      <div className="card overflow-hidden">
        {/* 批次操作工具列 */}
        {filtered.some(o => o.status === "pending") && (
          <div
            className="flex items-center gap-3 px-5 py-3 text-xs"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
            <input
              type="checkbox"
              checked={allPendingSelected}
              onChange={e => handleSelectAll(e.target.checked)}
              className="accent-sky-400 w-4 h-4 flex-shrink-0"
              aria-label="全選待確認訂單"
            />
            <span style={{ color: "var(--text-muted)" }}>
              {selectedIds.size > 0 ? `已選 ${selectedIds.size} 筆` : "選取待確認訂單"}
            </span>
            {selectedIds.size > 0 && (
              <button
                onClick={handleBatchConfirm}
                disabled={batchConfirming}
                className="ml-auto btn text-xs px-4 py-1.5 disabled:opacity-50"
                style={{ background: "var(--success-dim)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.3)" }}>
                {batchConfirming ? "確認中…" : `批次確認 (${selectedIds.size})`}
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {selectedSchedule ? "此排程尚無訂單" : "請選擇排程"}
          </div>
        ) : (
          <ul>
            {filtered.map(order => (
              <OrderRow
                key={order.id}
                order={order}
                isManager={true}
                onConfirm={handleConfirm}
                onComplete={handleComplete}
                selected={selectedIds.has(order.id)}
                onSelect={handleSelectOrder}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

type PageTab = "my" | "vendor";

export default function MealOrdersPage() {
  const { can } = usePermissions();
  const isManager = can("meal:manage");

  const [tab, setTab] = useState<PageTab>("my");
  const [orders, setOrders] = useState<MealOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    mealApi.listOrders({ my_only: true, limit: 100 })
      .then(setOrders)
      .catch(e => toast.error(apiErrorMessage(e, "載入失敗")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const handleCancel = async (orderId: string) => {
    if (!confirm("確定要取消此訂單？")) return;
    try {
      await mealApi.cancelOrder(orderId);
      toast.success("訂單已取消");
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "取消失敗"));
    }
  };

  const activeOrders = orders.filter(o => o.status !== "cancelled");
  const totalSpent = activeOrders.reduce((s, o) => s + o.total_price, 0);

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* 頁首 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/meal" className="topbar-icon-btn" aria-label="返回學餐訂購">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>訂餐管理</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
              {isManager ? "管理訂單與商家資料" : "查看並管理我的訂餐記錄"}
            </p>
          </div>
        </div>
      </div>

      {/* 分頁（僅 meal:manage 才有「商家管理」tab） */}
      {isManager && (
        <nav className="module-tabs-scroll max-w-full overflow-x-auto" aria-label="訂單分頁">
          <div className="module-tabs-list w-full sm:w-auto">
            {([
            { key: "my",     label: "我的訂單" },
            { key: "vendor", label: "商家管理" },
            ] as { key: PageTab; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`module-tab-link flex-1 cursor-pointer${tab === key ? " is-active" : ""}`}>
              <span>{label}</span>
            </button>
            ))}
          </div>
        </nav>
      )}

      {/* ── 我的訂單 ─────────────────────────────────────────────────────── */}
      {tab === "my" && (
        <div key="my" className="tab-panel-transition space-y-5">
          {/* 統計 */}
          {orders.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "總訂單", value: orders.length },
                { label: "有效訂單", value: activeOrders.length },
                { label: "總金額", value: `NT$${totalSpent.toLocaleString()}` },
              ].map(({ label, value }) => (
                <div key={label} className="card p-4 text-center">
                  <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
                  <p className="text-xl font-bold" style={{ color: "var(--primary)" }}>{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* 訂單列表 */}
          <div className="card overflow-hidden">
            {loading ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中…</div>
            ) : orders.length === 0 ? (
              <div className="py-16 text-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.5" className="mx-auto mb-3 opacity-40" aria-hidden="true">
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                  <rect x="9" y="3" width="6" height="4" rx="1" />
                </svg>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無訂餐記錄</p>
                <Link href="/meal" className="text-sm mt-2 inline-block" style={{ color: "var(--primary)" }}>
                  前往訂餐 →
                </Link>
              </div>
            ) : (
              <ul>
                {orders.map(order => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    isManager={isManager}
                    onCancel={handleCancel}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── 商家管理 ─────────────────────────────────────────────────────── */}
      {tab === "vendor" && isManager && (
        <div key="vendor" className="tab-panel-transition">
          <VendorDashboard />
        </div>
      )}
    </div>
  );
}
