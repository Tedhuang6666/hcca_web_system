"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { ArrowUpDown, X } from "lucide-react";
import { inventoryApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import type { InventoryTransactionOut, InventoryItemOut, InventoryTxnType } from "@/lib/types";

const TXN_TYPE_OPTIONS: { value: InventoryTxnType; label: string }[] = [
  { value: "initial", label: "期初" },
  { value: "in", label: "入庫" },
  { value: "out", label: "出庫" },
  { value: "adjustment", label: "盤點調整" },
  { value: "damaged", label: "損耗" },
  { value: "lost", label: "遺失" },
];

const TXN_COLOR: Record<string, string> = {
  initial: "var(--text-muted)",
  in: "var(--success)",
  out: "var(--primary)",
  adjustment: "var(--warning)",
  damaged: "var(--danger)",
  lost: "var(--danger)",
};

export default function InventoryTransactionsPage() {
  const { can } = usePermissions();
  const canView = can("inventory:view") || can("inventory:stock") || can("inventory:manage");

  const [txns, setTxns] = useState<InventoryTransactionOut[]>([]);
  const [items, setItems] = useState<InventoryItemOut[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterItem, setFilterItem] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterLimit, setFilterLimit] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [txnData, itemData] = await Promise.all([
        inventoryApi.listTransactions({
          item_id: filterItem || undefined,
          txn_type: (filterType as InventoryTxnType) || undefined,
          limit: filterLimit,
        }),
        inventoryApi.listItems(),
      ]);
      setTxns(txnData);
      setItems(itemData);
    } catch (e) {
      toast.error(apiErrorMessage(e, "無法載入異動日誌"));
    } finally {
      setLoading(false);
    }
  }, [filterItem, filterType, filterLimit]);

  useEffect(() => {
    if (canView) load();
    else setLoading(false);
  }, [canView, load]);

  const hasFilter = filterItem || filterType || filterLimit !== 50;

  if (!canView) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <p style={{ color: "var(--text-muted)" }}>您沒有物資管理的存取權限。</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">庫存異動日誌</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
          追蹤所有庫存異動的完整紀錄
        </p>
      </header>

      {/* 篩選列 */}
      <div className="flex flex-wrap gap-2">
        <select
          className="input"
          value={filterItem}
          onChange={(e) => setFilterItem(e.target.value)}
        >
          <option value="">全部品項</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
        <select
          className="input"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">全部類型</option>
          {TXN_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          className="input"
          value={filterLimit}
          onChange={(e) => setFilterLimit(Number(e.target.value))}
        >
          <option value={20}>最近 20 筆</option>
          <option value={50}>最近 50 筆</option>
          <option value={100}>最近 100 筆</option>
          <option value={500}>最近 500 筆</option>
        </select>
        {hasFilter && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setFilterItem(""); setFilterType(""); setFilterLimit(50); }}
          >
            <X size={14} />
            清除篩選
          </button>
        )}
      </div>

      {/* 表格 */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center" style={{ color: "var(--text-muted)" }}>載入中…</div>
        ) : txns.length === 0 ? (
          <div className="p-8 text-center">
            <ArrowUpDown size={32} className="mx-auto mb-3 opacity-30" />
            <p style={{ color: "var(--text-muted)" }}>尚無異動紀錄</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["品項", "類型", "異動量", "異動後庫存", "備註", "操作人", "時間"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-xs font-medium"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txns.map((txn, idx) => (
                  <tr
                    key={txn.id}
                    style={{
                      background: idx % 2 === 0 ? "transparent" : "var(--bg-elevated)",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <td className="px-4 py-2.5 font-medium">{txn.item_name}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          color: TXN_COLOR[txn.txn_type],
                          background: `color-mix(in srgb, ${TXN_COLOR[txn.txn_type]} 12%, transparent)`,
                        }}
                      >
                        {TXN_TYPE_OPTIONS.find((o) => o.value === txn.txn_type)?.label ?? txn.txn_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums font-medium">
                      <span style={{ color: txn.quantity > 0 ? "var(--success)" : "var(--danger)" }}>
                        {txn.quantity > 0 ? "+" : ""}{txn.quantity}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {txn.quantity_after}
                    </td>
                    <td
                      className="px-4 py-2.5 max-w-xs truncate"
                      style={{ color: "var(--text-muted)" }}
                      title={txn.notes ?? ""}
                    >
                      {txn.notes ?? "—"}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-secondary)" }}>
                      {txn.created_by_name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      {new Date(txn.created_at).toLocaleString("zh-TW", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && txns.length > 0 && (
        <p className="text-xs text-right" style={{ color: "var(--text-muted)" }}>
          顯示 {txns.length} 筆，如需更多請放大筆數限制
        </p>
      )}
    </div>
  );
}
