"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, ShoppingCart, Check, X, Truck, ChevronRight } from "lucide-react";
import { inventoryApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import MobileBackToList from "@/components/ui/MobileBackToList";
import type {
  InventoryProcurementOut,
  InventoryProcurementStatus,
  InventoryProcurementItemIn,
  InventoryItemOut,
} from "@/lib/types";

// ── 常數 ──────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<InventoryProcurementStatus, string> = {
  draft: "草稿",
  submitted: "待審核",
  approved: "已核准",
  rejected: "已駁回",
  received: "已收貨",
};

const STATUS_COLOR: Record<InventoryProcurementStatus, string> = {
  draft: "var(--text-muted)",
  submitted: "var(--warning)",
  approved: "var(--success)",
  rejected: "var(--danger)",
  received: "var(--primary)",
};

const TABS: { value: InventoryProcurementStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "submitted", label: "待審核" },
  { value: "approved", label: "已核准" },
  { value: "rejected", label: "已駁回" },
  { value: "received", label: "已收貨" },
];

// ── 採購明細行編輯 ─────────────────────────────────────────────────────────────

function LineItemRow({
  line,
  items,
  onChange,
  onRemove,
}: {
  line: InventoryProcurementItemIn;
  items: InventoryItemOut[];
  onChange: (updated: InventoryProcurementItemIn) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-start">
      <select
        className="input w-36"
        value={line.item_id ?? ""}
        onChange={(e) => {
          const found = items.find((i) => i.id === e.target.value);
          onChange({
            ...line,
            item_id: e.target.value || undefined,
            item_name: found?.name ?? line.item_name,
            item_unit: found?.unit ?? line.item_unit,
          });
        }}
      >
        <option value="">（新品）</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>{i.name}</option>
        ))}
      </select>
      <input
        className="input flex-1 min-w-28"
        placeholder="品項名稱"
        value={line.item_name}
        onChange={(e) => onChange({ ...line, item_name: e.target.value })}
      />
      <input
        type="number"
        className="input w-20"
        placeholder="數量"
        min={1}
        value={line.quantity_requested}
        onChange={(e) => onChange({ ...line, quantity_requested: Number(e.target.value) })}
      />
      <input
        className="input w-16"
        placeholder="單位"
        value={line.item_unit ?? ""}
        onChange={(e) => onChange({ ...line, item_unit: e.target.value })}
      />
      <input
        type="number"
        className="input w-24"
        placeholder="單價（選填）"
        min={0}
        value={line.estimated_unit_price ?? ""}
        onChange={(e) => onChange({ ...line, estimated_unit_price: e.target.value ? Number(e.target.value) : undefined })}
      />
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
        <X size={14} />
      </button>
    </div>
  );
}

// ── 詳情面板 ──────────────────────────────────────────────────────────────────

function ProcurementDetail({
  proc,
  items,
  canManage,
  canStock,
  onUpdated,
}: {
  proc: InventoryProcurementOut;
  items: InventoryItemOut[];
  canManage: boolean;
  canStock: boolean;
  onUpdated: (updated: InventoryProcurementOut) => void;
}) {
  const isDraft = proc.status === "draft";
  const isSubmitted = proc.status === "submitted";
  const isApproved = proc.status === "approved";

  const [editTitle, setEditTitle] = useState(proc.title);
  const [editNotes, setEditNotes] = useState(proc.requester_notes ?? "");
  const [editAmount, setEditAmount] = useState(proc.estimated_amount ?? 0);
  const [lineItems, setLineItems] = useState<InventoryProcurementItemIn[]>(
    proc.line_items.map((li) => ({
      item_id: li.item_id ?? undefined,
      item_name: li.item_name,
      item_unit: li.item_unit,
      quantity_requested: li.quantity_requested,
      estimated_unit_price: li.estimated_unit_price ?? undefined,
    }))
  );
  const [saving, setSaving] = useState(false);

  const [rejectNotes, setRejectNotes] = useState("");
  const [acting, setActing] = useState(false);

  // 收貨數量 map
  const [receivedQty, setReceivedQty] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    proc.line_items.forEach((li) => { m[li.id] = li.quantity_requested; });
    return m;
  });
  const [receiveNotes, setReceiveNotes] = useState("");

  useEffect(() => {
    setEditTitle(proc.title);
    setEditNotes(proc.requester_notes ?? "");
    setEditAmount(proc.estimated_amount ?? 0);
    setLineItems(
      proc.line_items.map((li) => ({
        item_id: li.item_id ?? undefined,
        item_name: li.item_name,
        item_unit: li.item_unit,
        quantity_requested: li.quantity_requested,
        estimated_unit_price: li.estimated_unit_price ?? undefined,
      }))
    );
    const m: Record<string, number> = {};
    proc.line_items.forEach((li) => { m[li.id] = li.quantity_received || li.quantity_requested; });
    setReceivedQty(m);
  }, [proc.id, proc.title, proc.requester_notes, proc.estimated_amount, proc.line_items]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await inventoryApi.updateProcurement(proc.id, {
        title: editTitle,
        requester_notes: editNotes || undefined,
        estimated_amount: editAmount || undefined,
        line_items: lineItems,
      });
      onUpdated(updated);
      toast.success("已儲存");
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    setActing(true);
    try {
      const updated = await inventoryApi.submitProcurement(proc.id);
      onUpdated(updated);
      toast.success("已提交審核");
    } catch (e) {
      toast.error(apiErrorMessage(e, "提交失敗"));
    } finally {
      setActing(false);
    }
  };

  const handleApprove = async () => {
    setActing(true);
    try {
      const updated = await inventoryApi.approveProcurement(proc.id);
      onUpdated(updated);
      toast.success("已核准");
    } catch (e) {
      toast.error(apiErrorMessage(e, "操作失敗"));
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    setActing(true);
    try {
      const updated = await inventoryApi.rejectProcurement(proc.id, rejectNotes || undefined);
      onUpdated(updated);
      setRejectNotes("");
      toast.success("已駁回");
    } catch (e) {
      toast.error(apiErrorMessage(e, "操作失敗"));
    } finally {
      setActing(false);
    }
  };

  const handleReceive = async () => {
    setActing(true);
    try {
      const updated = await inventoryApi.receiveProcurement(proc.id, receivedQty, receiveNotes || undefined);
      onUpdated(updated);
      toast.success("已標記收貨，庫存已更新");
    } catch (e) {
      toast.error(apiErrorMessage(e, "操作失敗"));
    } finally {
      setActing(false);
    }
  };

  const addLine = () => {
    setLineItems((prev) => [
      ...prev,
      { item_name: "", quantity_requested: 1, item_unit: "個" },
    ]);
  };

  return (
    <div className="space-y-5">
      {/* 標頭卡 */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">{proc.title}</h2>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
              申請人：{proc.requester_name}
              {proc.reviewer_name && ` · 審核：${proc.reviewer_name}`}
            </p>
          </div>
          <span
            className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold flex-shrink-0"
            style={{
              color: STATUS_COLOR[proc.status],
              background: `color-mix(in srgb, ${STATUS_COLOR[proc.status]} 12%, transparent)`,
            }}
          >
            {STATUS_LABEL[proc.status]}
          </span>
        </div>
        {proc.requester_notes && (
          <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>{proc.requester_notes}</p>
        )}
        {proc.reviewer_notes && (
          <div
            className="mt-3 rounded-lg px-3 py-2 text-sm"
            style={{
              background: `color-mix(in srgb, ${STATUS_COLOR[proc.status]} 8%, transparent)`,
              color: STATUS_COLOR[proc.status],
            }}
          >
            審核備註：{proc.reviewer_notes}
          </div>
        )}
      </div>

      {/* 明細（唯讀或可編輯） */}
      <section className="card p-5 space-y-3">
        <h3 className="font-semibold text-sm">採購明細</h3>
        {isDraft ? (
          <>
            <div className="space-y-2">
              {lineItems.map((li, idx) => (
                <LineItemRow
                  key={idx}
                  line={li}
                  items={items}
                  onChange={(updated) => setLineItems((prev) => prev.map((x, i) => i === idx ? updated : x))}
                  onRemove={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={addLine}>
              <Plus size={14} />
              新增行
            </button>
          </>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["品項", "數量", "單位", "單價", "收到數量"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {proc.line_items.map((li) => (
                <tr key={li.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td className="px-3 py-2 font-medium">{li.item_name}</td>
                  <td className="px-3 py-2 tabular-nums">{li.quantity_requested}</td>
                  <td className="px-3 py-2">{li.item_unit}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {li.estimated_unit_price != null ? `$${li.estimated_unit_price}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {isApproved ? (
                      <input
                        type="number"
                        className="input w-20"
                        min={0}
                        value={receivedQty[li.id] ?? li.quantity_requested}
                        onChange={(e) => setReceivedQty((prev) => ({ ...prev, [li.id]: Number(e.target.value) }))}
                      />
                    ) : (
                      <span className="tabular-nums">{li.quantity_received || "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 基本資料（草稿可編輯） */}
      {isDraft && (
        <section className="card p-5 space-y-3">
          <h3 className="font-semibold text-sm">基本設定</h3>
          <label className="block">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>標題</span>
            <input className="input mt-1 w-full" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>申請說明</span>
            <textarea
              className="input mt-1 w-full"
              rows={2}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="可選"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>預估金額</span>
            <input
              type="number"
              className="input mt-1 w-40"
              min={0}
              value={editAmount}
              onChange={(e) => setEditAmount(Number(e.target.value))}
            />
          </label>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? "儲存中…" : "儲存草稿"}
            </button>
            {canStock && (
              <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={acting}>
                <ChevronRight size={14} />
                提交審核
              </button>
            )}
          </div>
        </section>
      )}

      {/* 審核操作（submitted + manage） */}
      {isSubmitted && canManage && (
        <section className="card p-5 space-y-3">
          <h3 className="font-semibold text-sm">審核</h3>
          <label className="block">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>審核備註（駁回時說明原因）</span>
            <input
              className="input mt-1 w-full"
              placeholder="可選"
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" onClick={handleApprove} disabled={acting}>
              <Check size={14} />
              核准
            </button>
            <button
              className="btn btn-sm"
              style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }}
              onClick={handleReject}
              disabled={acting}
            >
              <X size={14} />
              駁回
            </button>
          </div>
        </section>
      )}

      {/* 收貨確認（approved + stock/manage） */}
      {isApproved && (canStock || canManage) && (
        <section className="card p-5 space-y-3">
          <h3 className="font-semibold text-sm">確認收貨</h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            請在上方明細欄確認各品項實際收到數量，再按「確認收貨」，系統將自動補入庫。
          </p>
          <label className="block">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>備註</span>
            <input
              className="input mt-1 w-full"
              placeholder="可選"
              value={receiveNotes}
              onChange={(e) => setReceiveNotes(e.target.value)}
            />
          </label>
          <button className="btn btn-primary btn-sm" onClick={handleReceive} disabled={acting}>
            <Truck size={14} />
            {acting ? "處理中…" : "確認收貨並入庫"}
          </button>
        </section>
      )}
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function InventoryProcurementPage() {
  const { can } = usePermissions();
  const canManage = can("inventory:manage");
  const canStock = can("inventory:stock") || canManage;
  const canView = can("inventory:view") || canStock;

  const [procs, setProcs] = useState<InventoryProcurementOut[]>([]);
  const [items, setItems] = useState<InventoryItemOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<InventoryProcurementStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const selectedProc = procs.find((p) => p.id === selectedId) ?? null;

  const load = useCallback(async () => {
    try {
      const [procData, itemData] = await Promise.all([
        inventoryApi.listProcurements(),
        inventoryApi.listItems(),
      ]);
      setProcs(procData);
      setItems(itemData);
    } catch (e) {
      toast.error(apiErrorMessage(e, "無法載入採購申請"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) load();
    else setLoading(false);
  }, [canView, load]);

  const filteredProcs = activeTab === "all"
    ? procs
    : procs.filter((p) => p.status === activeTab);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const created = await inventoryApi.createProcurement({ title: newTitle.trim() });
      setProcs((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setMobileDetailOpen(true);
      setNewTitle("");
      setShowCreate(false);
      toast.success("草稿已建立，請填寫明細後提交");
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立失敗"));
    } finally {
      setCreating(false);
    }
  };

  const handleProcUpdated = (updated: InventoryProcurementOut) => {
    setProcs((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const tabCounts = TABS.map((t) => ({
    ...t,
    count: t.value === "all" ? procs.length : procs.filter((p) => p.status === t.value).length,
  }));

  if (!canView) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <p style={{ color: "var(--text-muted)" }}>您沒有物資管理的存取權限。</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">採購申請</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            管理物資採購申請與審核流程
          </p>
        </div>
        {canStock && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(!showCreate)}
          >
            <Plus size={16} />
            新增申請
          </button>
        )}
      </header>

      {/* 新增表單 */}
      {showCreate && canStock && (
        <div className="card p-4 flex gap-2">
          <input
            className="input flex-1"
            placeholder="採購申請標題"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating || !newTitle.trim()}>
            {creating ? "建立中…" : "建立草稿"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>取消</button>
        </div>
      )}

      {/* 狀態 Tab */}
      <div className="flex gap-1 overflow-x-auto">
        {tabCounts.map((tab) => (
          <button
            key={tab.value}
            className="flex-shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            style={
              activeTab === tab.value
                ? { background: "var(--primary)", color: "white" }
                : { color: "var(--text-muted)" }
            }
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className="ml-1.5 rounded-full px-1.5 text-xs"
                style={{
                  background: activeTab === tab.value ? "rgba(255,255,255,0.25)" : "var(--bg-elevated)",
                  color: activeTab === tab.value ? "white" : "var(--text-muted)",
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Master-detail */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_1fr]">
        {/* 左側清單 */}
        <aside className={`space-y-2 ${mobileDetailOpen ? "hidden xl:block" : ""}`}>
          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
          ) : filteredProcs.length === 0 ? (
            <div className="card p-8 text-center">
              <ShoppingCart size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
              <p style={{ color: "var(--text-muted)" }}>
                {procs.length === 0 ? "尚無採購申請" : "此分類無資料"}
              </p>
            </div>
          ) : (
            filteredProcs.map((proc) => (
              <button
                key={proc.id}
                className="card w-full text-left p-4 space-y-1.5 transition-all"
                style={selectedId === proc.id ? { border: "1.5px solid var(--primary)" } : undefined}
                onClick={() => handleSelect(proc.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm line-clamp-2 flex-1">{proc.title}</p>
                  <span
                    className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0"
                    style={{
                      color: STATUS_COLOR[proc.status],
                      background: `color-mix(in srgb, ${STATUS_COLOR[proc.status]} 12%, transparent)`,
                    }}
                  >
                    {STATUS_LABEL[proc.status]}
                  </span>
                </div>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {proc.requester_name}
                  {proc.estimated_amount ? ` · $${proc.estimated_amount.toLocaleString()}` : ""}
                  {" · "}{proc.line_items.length} 項
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {new Date(proc.created_at).toLocaleDateString("zh-TW", {
                    year: "numeric", month: "numeric", day: "numeric",
                  })}
                </p>
              </button>
            ))
          )}
        </aside>

        {/* 右側詳情 */}
        <main className={mobileDetailOpen ? "" : "hidden xl:block"}>
          <div className="xl:hidden mb-4">
            <MobileBackToList onBack={() => setMobileDetailOpen(false)} label="返回申請清單" />
          </div>
          {selectedProc ? (
            <ProcurementDetail
              proc={selectedProc}
              items={items}
              canManage={canManage}
              canStock={canStock}
              onUpdated={handleProcUpdated}
            />
          ) : (
            <div
              className="hidden xl:flex card items-center justify-center h-48"
              style={{ color: "var(--text-muted)" }}
            >
              <div className="text-center">
                <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                <p>← 點選左側申請查看詳情</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
