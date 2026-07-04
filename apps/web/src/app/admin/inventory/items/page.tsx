"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, AlertTriangle, Package, ArrowUpDown, X } from "lucide-react";
import { inventoryApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import MobileBackToList from "@/components/ui/MobileBackToList";
import type {
  InventoryItemOut,
  InventoryCategoryOut,
  InventoryItemType,
  InventoryTxnType,
  InventoryTransactionOut,
} from "@/lib/types";

// ── 常數 ──────────────────────────────────────────────────────────────────────

const ITEM_TYPE_LABEL: Record<InventoryItemType, string> = {
  consumable: "消耗品",
  equipment: "設備",
  loanable: "可借用",
};

const ITEM_TYPE_COLOR: Record<InventoryItemType, string> = {
  consumable: "var(--primary)",
  equipment: "var(--text-muted)",
  loanable: "var(--success)",
};

const TXN_TYPE_OPTIONS: { value: InventoryTxnType; label: string }[] = [
  { value: "in", label: "入庫（補充）" },
  { value: "out", label: "出庫（耗用）" },
  { value: "adjustment", label: "盤點調整" },
  { value: "damaged", label: "損耗" },
  { value: "lost", label: "遺失" },
];

const TXN_LABEL: Record<string, string> = {
  initial: "期初",
  in: "入庫",
  out: "出庫",
  adjustment: "盤點",
  damaged: "損耗",
  lost: "遺失",
};

const TXN_COLOR: Record<string, string> = {
  initial: "var(--text-muted)",
  in: "var(--success)",
  out: "var(--primary)",
  adjustment: "var(--warning)",
  damaged: "var(--danger)",
  lost: "var(--danger)",
};

// ── 庫存進度條 ────────────────────────────────────────────────────────────────

function StockBar({ quantity, threshold }: { quantity: number; threshold: number }) {
  const isLow = threshold > 0 && quantity <= threshold;
  const color = quantity === 0 ? "var(--danger)" : isLow ? "var(--warning)" : "var(--success)";
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 rounded-full h-1.5"
        style={{ background: "var(--bg-elevated)" }}
      >
        <div
          className="h-1.5 rounded-full transition-all"
          style={{
            width: threshold > 0 ? `${Math.min(100, Math.round((quantity / (threshold * 3 || 10)) * 100))}%` : "100%",
            background: color,
          }}
        />
      </div>
      <span
        className="text-xs tabular-nums font-medium"
        style={{ color: isLow ? color : "var(--text-muted)" }}
      >
        {quantity}
      </span>
    </div>
  );
}

// ── 右側詳情面板 ──────────────────────────────────────────────────────────────

function ItemDetailPanel({
  item,
  categories,
  canManage,
  canStock,
  onUpdated,
}: {
  item: InventoryItemOut;
  categories: InventoryCategoryOut[];
  canManage: boolean;
  canStock: boolean;
  onUpdated: (updated: InventoryItemOut) => void;
}) {
  const [editName, setEditName] = useState(item.name);
  const [editDesc, setEditDesc] = useState(item.description ?? "");
  const [editUnit, setEditUnit] = useState(item.unit);
  const [editType, setEditType] = useState<InventoryItemType>(item.item_type);
  const [editThreshold, setEditThreshold] = useState(item.low_stock_threshold);
  const [editLocation, setEditLocation] = useState(item.location ?? "");
  const [editCategoryId, setEditCategoryId] = useState(item.category_id ?? "");
  const [saving, setSaving] = useState(false);

  const [adjType, setAdjType] = useState<InventoryTxnType>("in");
  const [adjQty, setAdjQty] = useState(1);
  const [adjNotes, setAdjNotes] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  const [txns, setTxns] = useState<InventoryTransactionOut[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);

  const loadTxns = useCallback(async () => {
    try {
      setLoadingTxns(true);
      const data = await inventoryApi.listItemTransactions(item.id, 20);
      setTxns(data);
    } catch {
      /* silent */
    } finally {
      setLoadingTxns(false);
    }
  }, [item.id]);

  useEffect(() => {
    setEditName(item.name);
    setEditDesc(item.description ?? "");
    setEditUnit(item.unit);
    setEditType(item.item_type);
    setEditThreshold(item.low_stock_threshold);
    setEditLocation(item.location ?? "");
    setEditCategoryId(item.category_id ?? "");
    loadTxns();
  }, [item.id, item.name, item.description, item.unit, item.item_type, item.low_stock_threshold, item.location, item.category_id, loadTxns]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await inventoryApi.updateItem(item.id, {
        name: editName,
        description: editDesc || undefined,
        unit: editUnit,
        item_type: editType,
        low_stock_threshold: editThreshold,
        location: editLocation || undefined,
        category_id: editCategoryId || undefined,
      });
      onUpdated(updated);
      toast.success("已儲存");
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
    } finally {
      setSaving(false);
    }
  };

  const handleAdjust = async () => {
    if (adjQty <= 0) return;
    setAdjusting(true);
    try {
      await inventoryApi.adjustStock(item.id, {
        txn_type: adjType,
        quantity: adjQty,
        notes: adjNotes || undefined,
      });
      const updated = await inventoryApi.getItem(item.id);
      onUpdated(updated);
      setAdjQty(1);
      setAdjNotes("");
      toast.success("已記錄庫存異動");
      await loadTxns();
    } catch (e) {
      toast.error(apiErrorMessage(e, "操作失敗"));
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 庫存狀態卡 */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">{item.name}</h2>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {item.category_name ?? "未分類"} · {ITEM_TYPE_LABEL[item.item_type]}
              {item.location && ` · ${item.location}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tabular-nums">{item.quantity}</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{item.unit}</p>
          </div>
        </div>
        {item.is_low_stock && (
          <div
            className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
            style={{
              background: "color-mix(in srgb, var(--danger) 10%, transparent)",
              color: "var(--danger)",
            }}
          >
            <AlertTriangle size={14} />
            庫存低於警戒值（{item.low_stock_threshold} {item.unit}）
          </div>
        )}
      </div>

      {/* 庫存調整 */}
      {canStock && (
        <section className="card p-5 space-y-4">
          <h3 className="font-semibold text-sm">庫存異動</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="block col-span-2 sm:col-span-1">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>異動類型</span>
              <select
                className="input mt-1 w-full"
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as InventoryTxnType)}
              >
                {TXN_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>數量</span>
              <input
                type="number"
                className="input mt-1 w-full"
                min={1}
                value={adjQty}
                onChange={(e) => setAdjQty(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>備註</span>
            <input
              className="input mt-1 w-full"
              placeholder="可選"
              value={adjNotes}
              onChange={(e) => setAdjNotes(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleAdjust}
            disabled={adjusting || adjQty <= 0}
          >
            {adjusting ? "處理中…" : "確認異動"}
          </button>
        </section>
      )}

      {/* 基本資料編輯 */}
      {canManage && (
        <section className="card p-5 space-y-4">
          <h3 className="font-semibold text-sm">品項設定</h3>
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
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>單位</span>
              <input
                className="input mt-1 w-full"
                value={editUnit}
                onChange={(e) => setEditUnit(e.target.value)}
                placeholder="個"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>類型</span>
              <select
                className="input mt-1 w-full"
                value={editType}
                onChange={(e) => setEditType(e.target.value as InventoryItemType)}
              >
                {Object.entries(ITEM_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>低庫存警戒值</span>
              <input
                type="number"
                className="input mt-1 w-full"
                min={0}
                value={editThreshold}
                onChange={(e) => setEditThreshold(Number(e.target.value))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>存放位置</span>
              <input
                className="input mt-1 w-full"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                placeholder="如：辦公室左側櫃"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>類別</span>
            <select
              className="input mt-1 w-full"
              value={editCategoryId}
              onChange={(e) => setEditCategoryId(e.target.value)}
            >
              <option value="">未分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
        </section>
      )}

      {/* 近期異動 */}
      <section className="card p-5 space-y-3">
        <h3 className="font-semibold text-sm">近期異動（最近 20 筆）</h3>
        {loadingTxns ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
        ) : txns.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無異動紀錄</p>
        ) : (
          <div className="space-y-1">
            {txns.map((txn) => (
              <div
                key={txn.id}
                className="flex items-center gap-3 text-sm rounded px-2 py-1.5"
                style={{ background: "var(--bg-elevated)" }}
              >
                <span
                  className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0"
                  style={{
                    color: TXN_COLOR[txn.txn_type],
                    background: `color-mix(in srgb, ${TXN_COLOR[txn.txn_type]} 12%, transparent)`,
                  }}
                >
                  {TXN_LABEL[txn.txn_type]}
                </span>
                <span
                  className="font-medium tabular-nums"
                  style={{ color: txn.quantity > 0 ? "var(--success)" : "var(--danger)" }}
                >
                  {txn.quantity > 0 ? "+" : ""}{txn.quantity}
                </span>
                <span style={{ color: "var(--text-muted)" }}>→ {txn.quantity_after}</span>
                {txn.notes && <span className="truncate flex-1 text-xs" style={{ color: "var(--text-muted)" }}>{txn.notes}</span>}
                <span className="ml-auto text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  {new Date(txn.created_at).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function InventoryItemsPage() {
  const { can } = usePermissions();
  const canManage = can("inventory:manage");
  const canStock = can("inventory:stock") || canManage;
  const canView = can("inventory:view") || canStock;

  const [items, setItems] = useState<InventoryItemOut[]>([]);
  const [categories, setCategories] = useState<InventoryCategoryOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("個");
  const [newType, setNewType] = useState<InventoryItemType>("consumable");
  const [newQty, setNewQty] = useState(0);
  const [newCategoryId, setNewCategoryId] = useState("");
  const [creating, setCreating] = useState(false);

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  const load = useCallback(async () => {
    try {
      const [itemData, catData] = await Promise.all([
        inventoryApi.listItems(),
        inventoryApi.listCategories(),
      ]);
      setItems(itemData);
      setCategories(catData);
    } catch (e) {
      toast.error(apiErrorMessage(e, "無法載入物資清單"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) load();
    else setLoading(false);
  }, [canView, load]);

  const filteredItems = items.filter((item) => {
    if (keyword && !item.name.toLowerCase().includes(keyword.toLowerCase())) return false;
    if (filterCategory && item.category_id !== filterCategory) return false;
    if (filterType && item.item_type !== filterType) return false;
    return true;
  });

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await inventoryApi.createItem({
        name: newName.trim(),
        unit: newUnit,
        item_type: newType,
        quantity: newQty,
        category_id: newCategoryId || undefined,
      });
      setItems((prev) => [created, ...prev]);
      setNewName("");
      setNewUnit("個");
      setNewType("consumable");
      setNewQty(0);
      setNewCategoryId("");
      setShowCreate(false);
      toast.success("已建立品項");
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立失敗"));
    } finally {
      setCreating(false);
    }
  };

  const handleItemUpdated = (updated: InventoryItemOut) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  };

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
          <h1 className="text-2xl font-bold">品項管理</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            管理物資品項與庫存數量
          </p>
        </div>
        {canManage && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(!showCreate)}
          >
            <Plus size={16} />
            新增品項
          </button>
        )}
      </header>

      {/* 新增表單 */}
      {showCreate && canManage && (
        <div className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm">新增品項</h3>
          <div className="flex flex-wrap gap-2">
            <input
              className="input flex-1 min-w-40"
              placeholder="品項名稱"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <input
              className="input w-20"
              placeholder="單位"
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
            />
            <select
              className="input"
              value={newType}
              onChange={(e) => setNewType(e.target.value as InventoryItemType)}
            >
              {Object.entries(ITEM_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <input
              type="number"
              className="input w-24"
              placeholder="期初數量"
              min={0}
              value={newQty}
              onChange={(e) => setNewQty(Number(e.target.value))}
            />
            <select
              className="input"
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
            >
              <option value="">未分類</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
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

      {/* 搜尋篩選 */}
      <div className="flex flex-wrap gap-2">
        <input
          className="input flex-1 min-w-40"
          placeholder="搜尋品項名稱…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <select
          className="input"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">全部類別</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          className="input"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">全部類型</option>
          {Object.entries(ITEM_TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {(keyword || filterCategory || filterType) && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setKeyword(""); setFilterCategory(""); setFilterType(""); }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Master-detail */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_1fr]">
        {/* 左側清單 */}
        <aside className={`space-y-2 ${mobileDetailOpen ? "hidden xl:block" : ""}`}>
          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
          ) : filteredItems.length === 0 ? (
            <div className="card p-8 text-center">
              <Package size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
              <p style={{ color: "var(--text-muted)" }}>
                {items.length === 0 ? "尚未新增任何品項" : "無符合條件的品項"}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <button
                key={item.id}
                className="card w-full text-left p-4 space-y-2 transition-all"
                style={selectedId === item.id ? { border: "1.5px solid var(--primary)" } : undefined}
                onClick={() => handleSelect(item.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">{item.name}</span>
                      {item.is_low_stock && (
                        <AlertTriangle size={13} style={{ color: "var(--danger)", flexShrink: 0 }} />
                      )}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {item.category_name ?? "未分類"}
                    </p>
                  </div>
                  <span
                    className="inline-flex rounded-full px-1.5 py-0.5 text-xs font-medium flex-shrink-0"
                    style={{
                      color: ITEM_TYPE_COLOR[item.item_type],
                      background: `color-mix(in srgb, ${ITEM_TYPE_COLOR[item.item_type]} 12%, transparent)`,
                    }}
                  >
                    {ITEM_TYPE_LABEL[item.item_type]}
                  </span>
                </div>
                <StockBar quantity={item.quantity} threshold={item.low_stock_threshold} />
                {item.location && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>📍 {item.location}</p>
                )}
              </button>
            ))
          )}
        </aside>

        {/* 右側詳情 */}
        <main className={mobileDetailOpen ? "" : "hidden xl:block"}>
          <div className="xl:hidden mb-4">
            <MobileBackToList onBack={() => setMobileDetailOpen(false)} label="返回品項清單" />
          </div>
          {selectedItem ? (
            <ItemDetailPanel
              item={selectedItem}
              categories={categories}
              canManage={canManage}
              canStock={canStock}
              onUpdated={handleItemUpdated}
            />
          ) : (
            <div
              className="hidden xl:flex card items-center justify-center h-48"
              style={{ color: "var(--text-muted)" }}
            >
              <div className="text-center">
                <ArrowUpDown size={32} className="mx-auto mb-2 opacity-30" />
                <p>← 點選左側品項查看詳情與調整庫存</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
