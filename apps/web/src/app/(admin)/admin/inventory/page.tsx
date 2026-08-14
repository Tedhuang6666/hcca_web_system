"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Package, ShoppingCart, ArrowUpDown, TrendingUp } from "lucide-react";
import { inventoryApi, apiErrorMessage } from "@/lib/api";
import type { InventoryDashboard, InventoryItemOut, InventoryTransactionOut } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";

const TXN_TYPE_LABEL: Record<string, string> = {
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

function StatCard({
  icon,
  label,
  value,
  warn,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  warn?: boolean;
  href: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <div
        className="card p-4 flex flex-col gap-1 transition-colors hover:bg-[var(--bg-hover)]"
        style={{ cursor: "pointer" }}
      >
        <div
          className="flex items-center gap-1.5 text-xs"
          style={{ color: warn && value ? "var(--danger)" : "var(--text-muted)" }}
        >
          {icon}
          <span>{label}</span>
        </div>
        <p
          className="text-2xl font-semibold"
          style={{ color: warn && value ? "var(--danger)" : "var(--text-primary)" }}
        >
          {value === null ? "—" : value}
        </p>
      </div>
    </Link>
  );
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "剛剛";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export default function InventoryDashboardPage() {
  const { can } = usePermissions();
  const canView = can("inventory:view") || can("inventory:stock") || can("inventory:manage");

  const [stats, setStats] = useState<InventoryDashboard | null>(null);
  const [lowStockItems, setLowStockItems] = useState<InventoryItemOut[]>([]);
  const [recentTxns, setRecentTxns] = useState<InventoryTransactionOut[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [dashboard, items, txns] = await Promise.all([
        inventoryApi.dashboard(),
        inventoryApi.listItems({ low_stock_only: true }),
        inventoryApi.listTransactions({ limit: 10 }),
      ]);
      setStats(dashboard);
      setLowStockItems(items);
      setRecentTxns(txns);
    } catch (e) {
      toast.error(apiErrorMessage(e, "無法載入物資儀表板"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canView) load();
    else setLoading(false);
  }, [canView, load]);

  if (!canView) {
    return (
      <div className="max-w-xl mx-auto py-20 text-center">
        <p style={{ color: "var(--text-muted)" }}>您沒有物資管理系統的存取權限。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">物資管理</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            班聯會物資庫存總覽
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/inventory/items" className="btn btn-primary btn-sm">
            品項管理
          </Link>
          <Link href="/admin/inventory/procurement" className="btn btn-secondary btn-sm">
            採購申請
          </Link>
          <Link href="/admin/inventory/transactions" className="btn btn-ghost btn-sm">
            異動日誌
          </Link>
        </div>
      </header>

      {/* 統計卡 */}
      {loading ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-4 h-20 animate-pulse" style={{ background: "var(--bg-elevated)" }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            icon={<Package size={14} />}
            label="物資品項"
            value={stats?.total_items ?? null}
            href="/admin/inventory/items"
          />
          <StatCard
            icon={<AlertTriangle size={14} />}
            label="低庫存警示"
            value={stats?.low_stock_count ?? null}
            warn
            href="/admin/inventory/items?low_stock_only=true"
          />
          <StatCard
            icon={<ShoppingCart size={14} />}
            label="待審採購"
            value={stats?.pending_procurement_count ?? null}
            warn
            href="/admin/inventory/procurement?status=submitted"
          />
          <StatCard
            icon={<TrendingUp size={14} />}
            label="本月異動"
            value={stats?.monthly_transaction_count ?? null}
            href="/admin/inventory/transactions"
          />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 低庫存物資 */}
        <section className="card p-5 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <AlertTriangle size={14} style={{ color: "var(--danger)" }} />
            低庫存警示
          </h2>
          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
          ) : lowStockItems.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>所有物資庫存充足</p>
          ) : (
            <div className="space-y-2">
              {lowStockItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/inventory/items?selected=${item.id}`}
                  className="flex items-center justify-between rounded-lg px-3 py-2 gap-3 transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{item.name}</p>
                    {item.category_name && (
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{item.category_name}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span
                      className="text-sm font-bold"
                      style={{ color: item.quantity === 0 ? "var(--danger)" : "var(--warning)" }}
                    >
                      {item.quantity} {item.unit}
                    </span>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      警戒：{item.low_stock_threshold}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 最近異動 */}
        <section className="card p-5 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <ArrowUpDown size={14} />
            最近異動
          </h2>
          {loading ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
          ) : recentTxns.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無異動紀錄</p>
          ) : (
            <div className="space-y-2">
              {recentTxns.map((txn) => (
                <div
                  key={txn.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0"
                    style={{
                      color: TXN_COLOR[txn.txn_type],
                      background: `color-mix(in srgb, ${TXN_COLOR[txn.txn_type]} 12%, transparent)`,
                    }}
                  >
                    {TXN_TYPE_LABEL[txn.txn_type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{txn.item_name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span
                      className="text-sm font-medium tabular-nums"
                      style={{
                        color: txn.quantity > 0 ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      {txn.quantity > 0 ? "+" : ""}{txn.quantity}
                    </span>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {timeAgo(txn.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {recentTxns.length > 0 && (
            <Link
              href="/admin/inventory/transactions"
              className="block text-center text-xs pt-1"
              style={{ color: "var(--primary)" }}
            >
              查看全部異動 →
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}
