"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  EMPTY_SCH,
  ItemsPanel,
  PickupTab,
  fmtDT,
  orderStatusColor,
  orderStatusLabel,
  today,
  type ScheduleForm,
  type Tab,
} from "@/components/meal/VendorPageParts";
import Modal from "@/components/ui/Modal";
import { mealApi, orgsApi } from "@/lib/api";
import type { OrgRead } from "@/lib/api";
import type {
  MealOrderListItem,
  MealOrderStatus,
  MealVendorOut,
  MenuScheduleListItem,
  MenuScheduleOut,
  VendorManagerOut,
} from "@/lib/types";

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function VendorPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");

  // ── 資料狀態 ─────────────────────────────────────────────────────────────
  const [vendors, setVendors] = useState<MealVendorOut[]>([]);
  const [schedules, setSchedules] = useState<MenuScheduleListItem[]>([]);
  const [scheduleDetails, setScheduleDetails] = useState<Record<string, MenuScheduleOut>>({});
  const [orders, setOrders] = useState<MealOrderListItem[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 篩選狀態 ─────────────────────────────────────────────────────────────
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [selectedSchedule, setSelectedSchedule] = useState<string>("");
  const [expandedSchedule, setExpandedSchedule] = useState<string | null>(null);

  // ── 排程新增表單 ─────────────────────────────────────────────────────────
  const [showSchForm, setShowSchForm] = useState(false);
  const [schForm, setSchForm] = useState<ScheduleForm>(EMPTY_SCH);
  const [schSaving, setSchSaving] = useState(false);

  // ── 商家新增表單 ─────────────────────────────────────────────────────────
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [vendorForm, setVendorForm] = useState({ name: "", description: "", contact_phone: "", contact_email: "", org_id: "" });
  const [vendorSaving, setVendorSaving] = useState(false);

  // ── 負責人指派 ───────────────────────────────────────────────────────────
  const [managerEmail, setManagerEmail] = useState("");
  const [managerSaving, setManagerSaving] = useState(false);
  const [managerResult, setManagerResult] = useState<VendorManagerOut | null>(null);

  // ── 備餐統計（P1: item-stats per schedule for prep tab）────────────────────
  const [prepStats, setPrepStats] = useState<Record<string, Record<string, number>>>({});

  // ── F1: 權限檢查 — 依賴後端 403 而非 localStorage ──────────────────────
  useEffect(() => {
    // 呼叫需要 meal:manage 的端點；若 403 則 redirect
    mealApi.listVendors({ active_only: false }).catch((e: unknown) => {
      if (e instanceof Error && e.message && (e as { status?: number }).status === 403) {
        router.replace("/meal");
      }
    });
  }, [router]);

  // ── 資料載入 ─────────────────────────────────────────────────────────────
  const loadVendors = useCallback(async () => {
    const data = await mealApi.listVendors({ active_only: false });
    setVendors(data);
    if (data.length > 0 && !selectedVendor) {
      setSelectedVendor(data[0].id);
    }
  }, [selectedVendor]);

  const loadSchedules = useCallback(async () => {
    if (!selectedVendor) return;
    const data = await mealApi.listSchedules({ vendor_id: selectedVendor });
    setSchedules(data);
  }, [selectedVendor]);

  const loadOrders = useCallback(async () => {
    const params: Parameters<typeof mealApi.listOrders>[0] = { my_only: false, limit: 100 };
    if (selectedVendor) params.vendor_id = selectedVendor;
    if (selectedSchedule) params.schedule_id = selectedSchedule;
    const data = await mealApi.listOrders(params);
    setOrders(data);
  }, [selectedVendor, selectedSchedule]);

  const loadScheduleDetail = useCallback(async (id: string) => {
    if (scheduleDetails[id]) return;
    const detail = await mealApi.getSchedule(id);
    setScheduleDetails(prev => ({ ...prev, [id]: detail }));
  }, [scheduleDetails]);

  const refreshScheduleDetail = useCallback(async (id: string) => {
    const detail = await mealApi.getSchedule(id);
    setScheduleDetails(prev => ({ ...prev, [id]: detail }));
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const orgItems = await orgsApi.list({ active_only: true }).catch(() => []);
        if (mounted) {
          setOrgs(orgItems);
          const storedOrgId = localStorage.getItem("org_id") ?? "";
          const usableStoredOrgId = orgItems.some((org) => org.id === storedOrgId) ? storedOrgId : "";
          if (usableStoredOrgId || orgItems.length === 1) {
            setVendorForm(prev => ({
              ...prev,
              org_id: prev.org_id || usableStoredOrgId || orgItems[0]?.id || "",
            }));
          }
        }
        await loadVendors();
      } finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedVendor) {
      // P3: 並行載入排程與訂單，減少 waterfall
      const tasks: Promise<unknown>[] = [loadSchedules()];
      if (tab === "orders" || tab === "overview") tasks.push(loadOrders());
      Promise.all(tasks).catch(() => {});
    }
  }, [selectedVendor, loadSchedules, loadOrders, tab]);

  useEffect(() => {
    if (tab === "orders") loadOrders();
  }, [tab, loadOrders]);

  // P1: 切換到備餐 tab 時，載入選定排程的 item-stats
  useEffect(() => {
    if (tab === "prep" && selectedSchedule && !prepStats[selectedSchedule]) {
      mealApi.getScheduleItemStats(selectedSchedule).then(stats => {
        const map: Record<string, number> = {};
        for (const s of stats) map[s.item_id] = s.total_ordered;
        setPrepStats(prev => ({ ...prev, [selectedSchedule]: map }));
      }).catch(() => {});
    }
  }, [tab, selectedSchedule, prepStats]);

  // ── 今日排程（用於 overview） ───────────────────────────────────────────
  const todaySchedules = useMemo(() =>
    schedules.filter(s => s.date === today()),
  [schedules]);

  const todayOrders = useMemo(() => {
    const todayIds = new Set(todaySchedules.map(s => s.id));
    return orders.filter(o => o.schedule_id !== null && todayIds.has(o.schedule_id));
  }, [orders, todaySchedules]);

  // ── 新增排程 ─────────────────────────────────────────────────────────────
  async function handleCreateSchedule() {
    if (!schForm.vendor_id || !schForm.date || !schForm.order_deadline) {
      toast.error("請填寫商家、日期與結單時間"); return;
    }
    setSchSaving(true);
    try {
      await mealApi.createSchedule({
        vendor_id: schForm.vendor_id,
        date: schForm.date,
        order_open_time: schForm.order_open_time || null,
        order_deadline: schForm.order_deadline,
        note: schForm.note || undefined,
      });
      toast.success("排程已建立");
      setShowSchForm(false);
      setSchForm(EMPTY_SCH);
      await loadSchedules();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "建立失敗");
    } finally { setSchSaving(false); }
  }

  // ── 複製菜單 ─────────────────────────────────────────────────────────────
  async function handleCopyMenu(targetScheduleId: string, sourceScheduleId: string) {
    const src = scheduleDetails[sourceScheduleId];
    if (!src) { toast.error("來源排程資料未載入"); return; }
    const target = scheduleDetails[targetScheduleId];
    if (!target) { toast.error("目標排程資料未載入"); return; }
    if (src.items.length === 0) { toast.info("來源排程沒有品項"); return; }
    try {
      for (const item of src.items) {
        await mealApi.addMenuItem(targetScheduleId, {
          name: item.name,
          description: item.description ?? undefined,
          price: item.price,
          max_quantity: item.max_quantity ?? undefined,
        });
      }
      await refreshScheduleDetail(targetScheduleId);
      toast.success(`已複製 ${src.items.length} 個品項`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "複製失敗");
    }
  }

  // ── 手動結單 ─────────────────────────────────────────────────────────────
  async function handleClose(scheduleId: string) {
    if (!confirm("確定手動結單？結單後無法繼續訂餐。")) return;
    try {
      await mealApi.closeSchedule(scheduleId);
      await loadSchedules();
      await refreshScheduleDetail(scheduleId);
      toast.success("已結單");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "結單失敗");
    }
  }

  // ── 確認訂單 ─────────────────────────────────────────────────────────────
  async function handleConfirm(orderId: string) {
    try {
      await mealApi.confirmOrder(orderId);
      await loadOrders();
      toast.success("訂單已確認");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "確認失敗");
    }
  }

  async function handleComplete(orderId: string) {
    try {
      await mealApi.completeOrder(orderId);
      await loadOrders();
      toast.success("訂單已完成");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "操作失敗");
    }
  }

  async function handleBatchConfirm() {
    const pending = orders.filter(o => o.status === "pending");
    if (pending.length === 0) { toast.info("沒有待確認的訂單"); return; }
    if (!confirm(`確定批次確認 ${pending.length} 筆待確認訂單？`)) return;
    let ok = 0;
    for (const o of pending) {
      try { await mealApi.confirmOrder(o.id); ok++; } catch { /* skip */ }
    }
    await loadOrders();
    toast.success(`已確認 ${ok} 筆訂單`);
  }

  // ── 新增商家 ─────────────────────────────────────────────────────────────
  async function handleCreateVendor() {
    if (!vendorForm.name.trim() || !vendorForm.org_id) {
      toast.error("請填寫商家名稱與組織 ID"); return;
    }
    setVendorSaving(true);
    try {
      const v = await mealApi.createVendor({
        name: vendorForm.name.trim(),
        org_id: vendorForm.org_id,
        description: vendorForm.description || undefined,
        contact_phone: vendorForm.contact_phone || undefined,
        contact_email: vendorForm.contact_email || undefined,
      });
      toast.success("商家已新增");
      setShowVendorForm(false);
      setVendorForm(f => ({ ...f, name: "", description: "", contact_phone: "", contact_email: "" }));
      await loadVendors();
      setSelectedVendor(v.id);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "新增失敗");
    } finally { setVendorSaving(false); }
  }

  // ── 指派負責人 ───────────────────────────────────────────────────────────
  async function handleAssignManager() {
    if (!selectedVendor) { toast.error("請先選擇商家"); return; }
    if (!managerEmail.trim()) { toast.error("請輸入 Email"); return; }
    setManagerSaving(true);
    try {
      const result = await mealApi.assignVendorManager(selectedVendor, managerEmail.trim());
      setManagerResult(result);
      setManagerEmail("");
      toast.success(`已將 ${result.display_name} 設為學餐管理員`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "指派失敗");
    } finally { setManagerSaving(false); }
  }

  // ── F2/P1: 備餐清單 — 使用 item-stats 取得實際訂購量 ──────────────────────
  const prepList = useMemo(() => {
    if (!selectedSchedule) return [];
    const detail = scheduleDetails[selectedSchedule];
    if (!detail) return [];
    const stats = prepStats[selectedSchedule] ?? {};
    return detail.items
      .map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        total: stats[item.id] ?? 0,
      }))
      .filter(item => item.total > 0) // 只顯示有訂購的品項
      .sort((a, b) => b.total - a.total); // 數量多的排前面
  }, [selectedSchedule, scheduleDetails, prepStats]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64" style={{ color: "var(--text-muted)" }}>載入中…</div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* ── 標題列 ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>商家管理</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            學餐系統 · 商家後台
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 選擇商家 */}
          <select className="input-sm" value={selectedVendor}
            onChange={e => setSelectedVendor(e.target.value)}
            style={{ minWidth: 120 }}>
            <option value="">全部商家</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}{!v.is_active ? "（停用）" : ""}</option>)}
          </select>
          <button className="btn-sm btn-primary" onClick={() => setShowVendorForm(true)}>+ 新增商家</button>
        </div>
      </div>

      {/* ── Tab 列 ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: "var(--card-bg-2, rgba(255,255,255,0.04))" }}>
        {([ ["overview","今日總覽"], ["schedules","排程管理"], ["orders","訂單看板"], ["prep","備餐清單"], ["pickup","核銷管理"] ] as [Tab, string][])
          .map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors"
              style={tab === t
                ? { background: "var(--primary)", color: "var(--primary-fg)" }
                : { color: "var(--text-muted)" }}>
              {label}
            </button>
          ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          Tab 1：今日總覽
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "overview" && (
        <div className="space-y-4">
          {/* 統計卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "今日排程", value: todaySchedules.length, color: "var(--primary)" },
              { label: "今日訂單", value: todayOrders.length, color: "#a78bfa" },
              { label: "待確認", value: todayOrders.filter(o => o.status === "pending").length, color: "#fbbf24" },
              { label: "已完成", value: todayOrders.filter(o => o.status === "completed").length, color: "#34d399" },
            ].map(card => (
              <div key={card.label} className="rounded-xl p-4"
                style={{ background: "var(--card-bg)", border: "1px solid var(--border)" }}>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{card.label}</p>
                <p className="text-3xl font-bold mt-1" style={{ color: card.color }}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* 今日排程列表 */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <div className="px-4 py-3" style={{ background: "var(--card-bg)", borderBottom: "1px solid var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                今日排程（{today()}）
              </p>
            </div>
            {todaySchedules.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                今日無排程
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {todaySchedules.map(sch => {
                  const schOrders = todayOrders.filter(o => o.schedule_id === sch.id);
                  const revenue = schOrders.reduce((s, o) => s + o.total_price, 0);
                  return (
                    <div key={sch.id} className="px-4 py-4 flex items-center gap-4 flex-wrap"
                      style={{ background: "var(--card-bg)" }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                            {vendors.find(v => v.id === sch.vendor_id)?.name ?? "未知商家"}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full"
                            style={sch.is_closed
                              ? { background: "rgba(239,68,68,0.08)", color: "#f87171" }
                              : { background: "rgba(52,211,153,0.12)", color: "#34d399" }}>
                            {sch.is_closed ? "已結單" : "開放中"}
                          </span>
                        </div>
                        <div className="text-xs mt-1 space-x-3" style={{ color: "var(--text-muted)" }}>
                          {sch.order_open_time && <span>開放：{fmtDT(sch.order_open_time)}</span>}
                          <span>結單：{fmtDT(sch.order_deadline)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {schOrders.length} 筆訂單
                        </p>
                        <p className="text-sm font-semibold" style={{ color: "var(--primary)" }}>NT${revenue}</p>
                      </div>
                      {!sch.is_closed && (
                        <button className="btn-sm"
                          style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
                          onClick={() => handleClose(sch.id)}>
                          手動結單
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 負責人設定 */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <div className="px-4 py-3" style={{ background: "var(--card-bg)", borderBottom: "1px solid var(--border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>指派學餐管理員</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                指定後，該使用者將自動取得 meal:manage 權限（限目前選取商家所屬組織）
              </p>
            </div>
            <div className="px-4 py-4 space-y-3" style={{ background: "var(--card-bg-2, rgba(255,255,255,0.02))" }}>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl px-3 py-2 text-sm"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  type="email"
                  placeholder="使用者 Email"
                  value={managerEmail}
                  onChange={e => setManagerEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAssignManager()}
                />
                <button
                  className="px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{ background: "var(--primary)", color: "var(--primary-fg)" }}
                  disabled={managerSaving || !selectedVendor || !managerEmail.trim()}
                  onClick={handleAssignManager}>
                  {managerSaving ? "…" : "指派"}
                </button>
              </div>
              {!selectedVendor && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>請先在右上角選擇商家</p>
              )}
              {managerResult && (
                <div className="rounded-lg px-3 py-2 flex items-center gap-2"
                  style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <p className="text-xs" style={{ color: "#34d399" }}>
                    {managerResult.display_name}（{managerResult.email}）已設為管理員
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 今日訂單快覽 */}
          {todayOrders.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <div className="px-4 py-3 flex items-center justify-between"
                style={{ background: "var(--card-bg)", borderBottom: "1px solid var(--border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>今日訂單</p>
                {todayOrders.some(o => o.status === "pending") && (
                  <button className="btn-sm btn-primary text-xs" onClick={handleBatchConfirm}>全部確認</button>
                )}
              </div>
              {/* U6: 桌面顯示 Table，行動端顯示 Card 堆疊 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: "var(--card-bg-2, rgba(255,255,255,0.03))", color: "var(--text-muted)" }}>
                      <th className="px-4 py-2 text-left">單號</th>
                      <th className="px-4 py-2 text-left">金額</th>
                      <th className="px-4 py-2 text-left">狀態</th>
                      <th className="px-4 py-2 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayOrders.slice(0, 20).map(o => {
                      const sc = orderStatusColor(o.status);
                      return (
                        <tr key={o.id} style={{ borderTop: "1px solid var(--border)", background: "var(--card-bg)" }}>
                          <td className="px-4 py-2 font-mono" style={{ color: "var(--text-primary)" }}>
                            {o.serial_number}
                          </td>
                          <td className="px-4 py-2" style={{ color: "var(--primary)" }}>NT${o.total_price}</td>
                          <td className="px-4 py-2">
                            <span className="px-1.5 py-0.5 rounded-full text-[10px]"
                              style={{ background: sc.bg, color: sc.color }}>
                              {orderStatusLabel(o.status)}
                            </span>
                          </td>
                          <td className="px-4 py-2 flex gap-1">
                            {o.status === "pending" && (
                              <button className="btn-icon text-xs px-2"
                                style={{ color: "var(--primary)" }} onClick={() => handleConfirm(o.id)}>確認</button>
                            )}
                            {o.status === "confirmed" && (
                              <button className="btn-icon text-xs px-2"
                                style={{ color: "#34d399" }} onClick={() => handleComplete(o.id)}>完成</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* 行動端 Card 堆疊 */}
              <div className="md:hidden divide-y" style={{ borderColor: "var(--border)" }}>
                {todayOrders.slice(0, 20).map(o => {
                  const sc = orderStatusColor(o.status);
                  return (
                    <div key={o.id} className="px-4 py-3 flex items-center justify-between gap-3"
                      style={{ background: "var(--card-bg)" }}>
                      <div className="min-w-0">
                        <p className="text-sm font-mono font-semibold" style={{ color: "var(--text-primary)" }}>
                          {o.serial_number}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--primary)" }}>NT${o.total_price}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="px-2 py-0.5 rounded-full text-xs"
                          style={{ background: sc.bg, color: sc.color }}>
                          {orderStatusLabel(o.status)}
                        </span>
                        {o.status === "pending" && (
                          <button className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}
                            onClick={() => handleConfirm(o.id)}>確認</button>
                        )}
                        {o.status === "confirmed" && (
                          <button className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                            style={{ background: "rgba(52,211,153,0.1)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}
                            onClick={() => handleComplete(o.id)}>完成</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Tab 2：排程管理
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "schedules" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              共 {schedules.length} 筆排程
            </p>
            <button className="btn-sm btn-primary" onClick={() => {
              setSchForm(f => ({ ...f, vendor_id: selectedVendor }));
              setShowSchForm(true);
            }}>
              + 新增排程
            </button>
          </div>

          {schedules.length === 0 && (
            <div className="text-center py-12 rounded-xl" style={{ border: "1px dashed var(--border)" }}>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無排程，點擊「新增排程」開始</p>
            </div>
          )}

          {schedules.map(sch => {
            const isExpanded = expandedSchedule === sch.id;
            const detail = scheduleDetails[sch.id];

            // 找前一個有品項的排程（用於複製）
            const prevSchedule = schedules
              .filter(s => s.date < sch.date && scheduleDetails[s.id]?.items.length)
              .sort((a, b) => b.date.localeCompare(a.date))[0];

            return (
              <div key={sch.id} className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--border)" }}>
                {/* 排程標題列 */}
                <div className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                  style={{ background: "var(--card-bg)" }}
                  onClick={async () => {
                    if (!isExpanded) {
                      setExpandedSchedule(sch.id);
                      await loadScheduleDetail(sch.id);
                    } else {
                      setExpandedSchedule(null);
                    }
                  }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{sch.date}</span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {vendors.find(v => v.id === sch.vendor_id)?.name}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={sch.is_closed
                          ? { background: "rgba(239,68,68,0.08)", color: "#f87171" }
                          : { background: "rgba(52,211,153,0.12)", color: "#34d399" }}>
                        {sch.is_closed ? "已結單" : "開放中"}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5 space-x-2" style={{ color: "var(--text-muted)" }}>
                      {sch.order_open_time && <span>開放：{fmtDT(sch.order_open_time)}</span>}
                      <span>結單：{fmtDT(sch.order_deadline)}</span>
                      {sch.note && <span>備註：{sch.note}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!sch.is_closed && (
                      <button className="btn-sm"
                        style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
                        onClick={e => { e.stopPropagation(); handleClose(sch.id); }}>
                        結單
                      </button>
                    )}
                    {prevSchedule && isExpanded && detail && !sch.is_closed && (
                      <button className="btn-sm"
                        style={{ color: "#a78bfa" }}
                        onClick={e => {
                          e.stopPropagation();
                          handleCopyMenu(sch.id, prevSchedule.id);
                        }}>
                        複製 {prevSchedule.date} 菜單
                      </button>
                    )}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" style={{ color: "var(--text-muted)", transform: isExpanded ? "rotate(180deg)" : "none" }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* 展開：品項管理 */}
                {isExpanded && (
                  <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border)", background: "var(--card-bg-2, rgba(255,255,255,0.02))" }}>
                    {!detail ? (
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>載入中…</p>
                    ) : (
                      <ItemsPanel
                        schedule={detail}
                        onChanged={() => refreshScheduleDetail(sch.id)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Tab 3：訂單看板
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "orders" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <select className="input-sm" value={selectedSchedule}
              onChange={async e => {
                setSelectedSchedule(e.target.value);
              }}
              style={{ minWidth: 140 }}>
              <option value="">全部排程</option>
              {schedules.map(s => (
                <option key={s.id} value={s.id}>{s.date}</option>
              ))}
            </select>
            <button className="btn-sm" onClick={loadOrders}
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              重新整理
            </button>
            {orders.some(o => o.status === "pending") && (
              <button className="btn-sm btn-primary" onClick={handleBatchConfirm}>
                全部確認（{orders.filter(o => o.status === "pending").length}）
              </button>
            )}
            <button className="btn-sm ml-auto"
              style={{ color: "var(--primary)", border: "1px solid var(--border-strong)" }}
              onClick={() => mealApi.downloadReport("xlsx", { vendor_id: selectedVendor || undefined, schedule_id: selectedSchedule || undefined })
                .then(r => r.blob()).then(b => {
                  const a = document.createElement("a"); a.href = URL.createObjectURL(b);
                  a.download = "meal_orders.xlsx"; a.click();
                }).catch(() => toast.error("匯出失敗"))}>
              匯出 Excel
            </button>
          </div>

          {/* Kanban */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(["pending", "confirmed", "completed"] as MealOrderStatus[]).map(status => {
              const col = orders.filter(o => o.status === status);
              const sc = orderStatusColor(status);
              return (
                <div key={status} className="rounded-xl overflow-hidden"
                  style={{ border: `1px solid var(--border)` }}>
                  <div className="px-3 py-2 flex items-center justify-between"
                    style={{ background: sc.bg, borderBottom: "1px solid var(--border)" }}>
                    <span className="text-xs font-semibold" style={{ color: sc.color }}>
                      {orderStatusLabel(status)}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                      style={{ background: sc.bg, color: sc.color }}>
                      {col.length}
                    </span>
                  </div>
                  <div className="p-2 space-y-2 min-h-32" style={{ background: "var(--card-bg)" }}>
                    {col.length === 0 && (
                      <p className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>無</p>
                    )}
                    {col.map(o => (
                      <div key={o.id} className="rounded-lg p-3"
                        style={{ background: "var(--card-bg-2, rgba(255,255,255,0.03))", border: "1px solid var(--border)" }}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>
                              {o.serial_number}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                              {schedules.find(s => s.id === o.schedule_id)?.date ?? ""}
                            </p>
                          </div>
                          <span className="text-sm font-semibold" style={{ color: "var(--primary)" }}>NT${o.total_price}</span>
                        </div>
                        <div className="flex gap-1 mt-2">
                          {o.status === "pending" && (
                            <button className="btn-icon text-xs px-2 py-0.5 rounded"
                              style={{ background: "var(--primary-dim)", color: "var(--primary)" }}
                              onClick={() => handleConfirm(o.id)}>
                              確認
                            </button>
                          )}
                          {o.status === "confirmed" && (
                            <button className="btn-icon text-xs px-2 py-0.5 rounded"
                              style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}
                              onClick={() => handleComplete(o.id)}>
                              已取餐
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Tab 4：備餐清單
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "prep" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <select className="input-sm" value={selectedSchedule}
              onChange={async e => {
                const id = e.target.value;
                setSelectedSchedule(id);
                if (id) {
                  await loadScheduleDetail(id);
                  // P1: 同時載入 item-stats 取得實際訂購量
                  if (!prepStats[id]) {
                    mealApi.getScheduleItemStats(id).then(stats => {
                      const map: Record<string, number> = {};
                      for (const s of stats) map[s.item_id] = s.total_ordered;
                      setPrepStats(prev => ({ ...prev, [id]: map }));
                    }).catch(() => {});
                  }
                }
              }}
              style={{ minWidth: 160 }}>
              <option value="">選擇排程…</option>
              {schedules.map(s => (
                <option key={s.id} value={s.id}>
                  {s.date} — {vendors.find(v => v.id === s.vendor_id)?.name}
                </option>
              ))}
            </select>
            <button className="btn-sm ml-auto"
              style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
              onClick={() => window.print()}>
              列印
            </button>
          </div>

          {!selectedSchedule ? (
            <div className="text-center py-16 rounded-xl" style={{ border: "1px dashed var(--border)" }}>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>請先選擇排程</p>
            </div>
          ) : !scheduleDetails[selectedSchedule] ? (
            <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>載入中…</div>
          ) : (
            <div className="rounded-xl overflow-hidden print:border-0"
              style={{ border: "1px solid var(--border)" }}>
              <div className="px-4 py-3" style={{ background: "var(--card-bg)", borderBottom: "1px solid var(--border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  備餐清單 — {schedules.find(s => s.id === selectedSchedule)?.date}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  已確認訂單：{orders.filter(o => o.schedule_id === selectedSchedule && (o.status === "confirmed" || o.status === "completed")).length} 筆
                </p>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {prepList.length === 0 ? (
                  prepStats[selectedSchedule] !== undefined ? (
                    <p className="px-4 py-6 text-sm" style={{ color: "var(--text-muted)" }}>此排程目前無有效訂單品項</p>
                  ) : (
                    <div className="px-4 py-6 text-center space-y-2">
                      <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin mx-auto"
                        style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }} />
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入訂購統計中…</p>
                    </div>
                  )
                ) : (
                  prepList.map((item, idx) => (
                    <div key={item.id}
                      className="px-4 py-3 flex items-center justify-between"
                      style={{ background: idx % 2 === 0 ? "var(--card-bg)" : "var(--card-bg-2, rgba(255,255,255,0.02))" }}>
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.name}</p>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>NT${item.price} / 份</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black" style={{ color: "var(--primary)" }}>
                          {item.total}
                        </p>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>份</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Tab 5：核銷管理
      ════════════════════════════════════════════════════════════════════ */}
      {tab === "pickup" && (
        <PickupTab
          vendors={vendors}
          schedules={schedules}
          onCompleteOrder={async (orderId) => {
            await mealApi.completeOrder(orderId);
            await loadOrders();
            toast.success("已標記領餐");
          }}
          onConfirmOrder={async (orderId) => {
            await mealApi.confirmOrder(orderId);
            await loadOrders();
            toast.success("訂單已確認");
          }}
        />
      )}

      {/* Modal：新增排程 */}
      {showSchForm && (
        <Modal title="新增菜單排程" onClose={() => setShowSchForm(false)} maxWidthClassName="max-w-md">
          <div className="space-y-3">
            <div>
              <label className="label-sm">商家</label>
              <select className="input-field w-full" value={schForm.vendor_id}
                onChange={e => setSchForm(f => ({ ...f, vendor_id: e.target.value }))}>
                <option value="">選擇商家…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label-sm">服務日期 *</label>
              <input className="input-field w-full" type="date" value={schForm.date}
                onChange={e => setSchForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className="label-sm">訂餐開放時間（留空=立即開放）</label>
              <input className="input-field w-full" type="datetime-local" value={schForm.order_open_time}
                onChange={e => setSchForm(f => ({ ...f, order_open_time: e.target.value }))} />
            </div>
            <div>
              <label className="label-sm">結單截止時間 *</label>
              <input className="input-field w-full" type="datetime-local" value={schForm.order_deadline}
                onChange={e => setSchForm(f => ({ ...f, order_deadline: e.target.value }))} />
            </div>
            <div>
              <label className="label-sm">備註</label>
              <input className="input-field w-full" placeholder="選填" value={schForm.note}
                onChange={e => setSchForm(f => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 pt-4">
            <button className="flex-1 btn btn-primary" disabled={schSaving} onClick={handleCreateSchedule}>
              {schSaving ? "建立中…" : "建立排程"}
            </button>
            <button className="flex-1 btn" onClick={() => setShowSchForm(false)}>取消</button>
          </div>
        </Modal>
      )}

      {/* Modal：新增商家 */}
      {showVendorForm && (
        <Modal title="新增學餐商家" onClose={() => setShowVendorForm(false)} maxWidthClassName="max-w-md">
          <div className="space-y-3">
            <div>
              <label className="label-sm">商家名稱 *</label>
              <input className="input-field w-full" placeholder="例：阿明便當" value={vendorForm.name}
                onChange={e => setVendorForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label-sm">描述</label>
              <input className="input-field w-full" placeholder="選填" value={vendorForm.description}
                onChange={e => setVendorForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="label-sm">聯絡電話</label>
              <input className="input-field w-full" placeholder="選填" value={vendorForm.contact_phone}
                onChange={e => setVendorForm(f => ({ ...f, contact_phone: e.target.value }))} />
            </div>
            <div>
              <label className="label-sm">聯絡信箱</label>
              <input className="input-field w-full" type="email" placeholder="選填" value={vendorForm.contact_email}
                onChange={e => setVendorForm(f => ({ ...f, contact_email: e.target.value }))} />
            </div>
            <div>
              <label className="label-sm">組織 ID *</label>
              <select className="input-field w-full" value={vendorForm.org_id}
                onChange={e => setVendorForm(f => ({ ...f, org_id: e.target.value }))}>
                <option value="">選擇組織…</option>
                {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-4">
            <button className="flex-1 btn btn-primary" disabled={vendorSaving} onClick={handleCreateVendor}>
              {vendorSaving ? "建立中…" : "建立商家"}
            </button>
            <button className="flex-1 btn" onClick={() => setShowVendorForm(false)}>取消</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
