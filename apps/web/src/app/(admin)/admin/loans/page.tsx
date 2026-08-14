"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Package, AlertTriangle, Wrench, Archive, X } from "lucide-react";
import Link from "next/link";
import { loansApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import MobileBackToList from "@/components/ui/MobileBackToList";
import type { LoanItemOut, LoanUnitOut, LoanUnitStatus } from "@/lib/types";

// ── 小元件 ─────────────────────────────────────────────────────────────────────

const UNIT_STATUS_LABEL: Record<LoanUnitStatus, string> = {
  available: "可借",
  borrowed: "借出中",
  lost: "遺失",
  damaged: "損壞",
  retired: "退役",
};

const UNIT_STATUS_COLOR: Record<LoanUnitStatus, string> = {
  available: "var(--success)",
  borrowed: "var(--primary)",
  lost: "var(--danger)",
  damaged: "var(--warning)",
  retired: "var(--text-muted)",
};

function UnitBadge({ status }: { status: LoanUnitStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: UNIT_STATUS_COLOR[status],
        background: `color-mix(in srgb, ${UNIT_STATUS_COLOR[status]} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${UNIT_STATUS_COLOR[status]} 30%, transparent)`,
      }}
    >
      {UNIT_STATUS_LABEL[status]}
    </span>
  );
}

function AvailabilityBar({ available, total }: { available: number; total: number }) {
  const pct = total > 0 ? Math.round((available / total) * 100) : 0;
  const color = pct === 0 ? "var(--danger)" : pct < 30 ? "var(--warning)" : "var(--success)";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full h-1.5" style={{ background: "var(--bg-elevated)" }}>
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
        {available}/{total}
      </span>
    </div>
  );
}

// ── 右側詳情面板 ──────────────────────────────────────────────────────────────

function ItemDetailPanel({
  item,
  onUpdated,
}: {
  item: LoanItemOut;
  onUpdated: (updated: LoanItemOut) => void;
}) {
  const [units, setUnits] = useState<LoanUnitOut[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [newCodes, setNewCodes] = useState("");
  const [addingUnits, setAddingUnits] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const [editDesc, setEditDesc] = useState(item.description ?? "");
  const [editDueDays, setEditDueDays] = useState(item.default_due_days);
  const [savingItem, setSavingItem] = useState(false);

  const loadUnits = useCallback(async () => {
    try {
      setLoadingUnits(true);
      const data = await loansApi.listUnits(item.id);
      setUnits(data);
    } catch (e) {
      toast.error(apiErrorMessage(e, "無法載入個體"));
    } finally {
      setLoadingUnits(false);
    }
  }, [item.id]);

  useEffect(() => {
    setEditName(item.name);
    setEditDesc(item.description ?? "");
    setEditDueDays(item.default_due_days);
    loadUnits();
  }, [item.id, item.name, item.description, item.default_due_days, loadUnits]);

  const handleSaveItem = async () => {
    setSavingItem(true);
    try {
      const updated = await loansApi.updateItem(item.id, {
        name: editName,
        description: editDesc || undefined,
        default_due_days: editDueDays,
      });
      onUpdated(updated);
      toast.success("已儲存");
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
    } finally {
      setSavingItem(false);
    }
  };

  const handleAddUnits = async () => {
    const codes = newCodes
      .split(/[\n,，、]/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (!codes.length) return;
    setAddingUnits(true);
    try {
      const added = await loansApi.addUnits(item.id, codes);
      setUnits((prev) => [...prev, ...added]);
      setNewCodes("");
      toast.success(`新增 ${added.length} 個個體`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "新增失敗"));
    } finally {
      setAddingUnits(false);
    }
  };

  const handleUnitStatus = async (unitId: string, status: LoanUnitStatus, notes?: string) => {
    try {
      const updated = await loansApi.updateUnit(unitId, { status, notes });
      setUnits((prev) => prev.map((u) => (u.id === unitId ? updated : u)));
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
    }
  };

  return (
    <div className="space-y-6">
      {/* 基本資料編輯 */}
      <section className="card p-5 space-y-4">
        <h3 className="font-semibold">物品設定</h3>
        <label className="block">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>名稱</span>
          <input
            className="input mt-1 w-full"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>說明</span>
          <input
            className="input mt-1 w-full"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder="可選"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>預設歸還天數</span>
          <input
            type="number"
            className="input mt-1 w-24"
            min={1}
            max={365}
            value={editDueDays}
            onChange={(e) => setEditDueDays(Number(e.target.value))}
          />
        </label>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSaveItem}
          disabled={savingItem}
        >
          {savingItem ? "儲存中…" : "儲存"}
        </button>
      </section>

      {/* 新增個體 */}
      <section className="card p-5 space-y-3">
        <h3 className="font-semibold">新增個體</h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          一行或逗號分隔輸入多個編號，例如：傘-01, 傘-02
        </p>
        <textarea
          className="input w-full h-20 resize-none font-mono text-sm"
          placeholder={"傘-01\n傘-02\n傘-03"}
          value={newCodes}
          onChange={(e) => setNewCodes(e.target.value)}
        />
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleAddUnits}
          disabled={addingUnits || !newCodes.trim()}
        >
          {addingUnits ? "新增中…" : "批次新增"}
        </button>
      </section>

      {/* 個體清單 */}
      <section className="card p-5 space-y-3">
        <h3 className="font-semibold">個體清單（共 {units.length} 個）</h3>
        {loadingUnits ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
        ) : units.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚未新增個體</p>
        ) : (
          <div className="space-y-2">
            {units.map((unit) => (
              <div
                key={unit.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 gap-2"
                style={{ background: "var(--bg-elevated)" }}
              >
                <span className="font-mono text-sm font-medium">{unit.unit_code}</span>
                <UnitBadge status={unit.status} />
                <div className="flex items-center gap-1 ml-auto">
                  {unit.status !== "lost" && (
                    <button
                      className="btn btn-ghost btn-xs"
                      title="標記遺失"
                      onClick={() =>
                        handleUnitStatus(unit.id, "lost", "已標記遺失")
                      }
                    >
                      <AlertTriangle size={13} />
                    </button>
                  )}
                  {unit.status !== "damaged" && unit.status !== "borrowed" && (
                    <button
                      className="btn btn-ghost btn-xs"
                      title="標記損壞"
                      onClick={() =>
                        handleUnitStatus(unit.id, "damaged", "已標記損壞")
                      }
                    >
                      <Wrench size={13} />
                    </button>
                  )}
                  {unit.status !== "retired" && unit.status !== "borrowed" && (
                    <button
                      className="btn btn-ghost btn-xs"
                      title="退役"
                      onClick={() => handleUnitStatus(unit.id, "retired")}
                    >
                      <Archive size={13} />
                    </button>
                  )}
                  {(unit.status === "lost" || unit.status === "damaged" || unit.status === "retired") && (
                    <button
                      className="btn btn-ghost btn-xs"
                      title="恢復可用"
                      onClick={() => handleUnitStatus(unit.id, "available", "")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function LoansAdminPage() {
  const { can } = usePermissions();
  const canManage = can("loan:manage");
  const canCheckout = can("loan:checkout") || canManage;

  const [items, setItems] = useState<LoanItemOut[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDueDays, setNewDueDays] = useState(7);
  const [creating, setCreating] = useState(false);

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  const loadItems = useCallback(async () => {
    try {
      const data = await loansApi.listItems();
      setItems(data);
    } catch (e) {
      toast.error(apiErrorMessage(e, "無法載入物品清單"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      // org_id 暫時空，實際使用需從 context 取或提供輸入
      // 這邊先用 placeholder — 使用者權限通常只屬於一個 org
      const created = await loansApi.createItem({
        name: newName.trim(),
        default_due_days: newDueDays,
      });
      setItems((prev) => [created, ...prev]);
      setNewName("");
      setNewDueDays(7);
      setShowCreate(false);
      toast.success("已建立物品類型");
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立失敗"));
    } finally {
      setCreating(false);
    }
  };

  const handleItemUpdated = (updated: LoanItemOut) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  };

  if (!canCheckout) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <p style={{ color: "var(--text-muted)" }}>您沒有借用系統的存取權限。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">物品借用管理</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            管理可借用物品庫存與個體編號
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCheckout && (
            <Link href="/admin/loans/checkout" className="btn btn-primary btn-sm">
              借還操作台
            </Link>
          )}
          {canCheckout && (
            <Link href="/admin/loans/records" className="btn btn-secondary btn-sm">
              借用紀錄
            </Link>
          )}
          {canManage && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowCreate(!showCreate)}
            >
              <Plus size={16} />
              新增物品
            </button>
          )}
        </div>
      </header>

      {/* 新增物品表單 */}
      {showCreate && canManage && (
        <div className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm">新增物品類型</h3>
          <div className="flex gap-2 flex-wrap">
            <input
              className="input flex-1 min-w-40"
              placeholder="物品名稱，如「雨傘」"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <input
              type="number"
              className="input w-24"
              placeholder="歸還天數"
              min={1}
              value={newDueDays}
              onChange={(e) => setNewDueDays(Number(e.target.value))}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? "建立中…" : "建立"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* 主內容：master-detail */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_1fr]">
        {/* 左側物品清單 */}
        <aside className={`space-y-3 ${mobileDetailOpen ? "hidden xl:block" : ""}`}>
          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
          ) : items.length === 0 ? (
            <div className="card p-8 text-center">
              <Package size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
              <p style={{ color: "var(--text-muted)" }}>尚未新增任何物品</p>
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                className="card w-full text-left p-4 space-y-2 transition-all"
                style={
                  selectedId === item.id
                    ? { border: "1.5px solid var(--primary)" }
                    : undefined
                }
                onClick={() => handleSelect(item.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{item.name}</span>
                  {item.available_count === 0 && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        color: "var(--danger)",
                        background: "color-mix(in srgb, var(--danger) 10%, transparent)",
                      }}
                    >
                      全部借出
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {item.description}
                  </p>
                )}
                <AvailabilityBar available={item.available_count} total={item.total_count} />
              </button>
            ))
          )}
        </aside>

        {/* 右側詳情 */}
        <main className={mobileDetailOpen ? "" : "hidden xl:block"}>
          <div className="xl:hidden mb-4">
            <MobileBackToList onBack={() => setMobileDetailOpen(false)} label="返回物品清單" />
          </div>
          {selectedItem && canManage ? (
            <ItemDetailPanel item={selectedItem} onUpdated={handleItemUpdated} />
          ) : selectedItem ? (
            <div className="card p-6 text-center">
              <p style={{ color: "var(--text-muted)" }}>您沒有編輯物品的權限</p>
            </div>
          ) : (
            <div
              className="hidden xl:flex card items-center justify-center h-48"
              style={{ color: "var(--text-muted)" }}
            >
              ← 點選左側物品查看詳情
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
