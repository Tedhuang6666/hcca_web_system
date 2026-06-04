"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { receivablesApi } from "@/lib/api";
import type { ReceivableOut, ReceivableSummaryOut } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  unpaid: "未收",
  partial: "部分收款",
  paid: "已收",
  refunding: "退款中",
  refunded: "已退款",
  canceled: "已取消",
};

export default function ReceivablesPage() {
  const search = useSearchParams();
  const activityId = search.get("activity_id") || undefined;
  const [rows, setRows] = useState<ReceivableOut[]>([]);
  const [summary, setSummary] = useState<ReceivableSummaryOut | null>(null);
  const [status, setStatus] = useState("");

  const reload = async () => {
    try {
      const [items, sum] = await Promise.all([
        receivablesApi.list({ activity_id: activityId, status: status || undefined, limit: 300 }),
        receivablesApi.summary({ activity_id: activityId }),
      ]);
      setRows(items);
      setSummary(sum);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "載入收款資料失敗");
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, status]);

  const markPaid = async (id: string) => {
    try {
      await receivablesApi.markPaid(id);
      toast.success("已標記收款");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "標記收款失敗");
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>收款對帳中心</p>
          <h1 className="text-2xl font-semibold">應收款與付款狀態</h1>
        </div>
        <a className="btn btn-ghost" href={receivablesApi.exportUrl({ activity_id: activityId })}>
          匯出 CSV
        </a>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="總筆數" value={summary?.total_count ?? 0} />
        <Metric label="總金額" value={`NT$${(summary?.total_amount ?? 0).toLocaleString()}`} />
        <Metric label="已收" value={`NT$${(summary?.paid_amount ?? 0).toLocaleString()}`} />
        <Metric label="未收" value={`NT$${(summary?.unpaid_amount ?? 0).toLocaleString()}`} />
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <select className="input max-w-xs" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(STATUS_LABEL).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </section>

      <section className="overflow-x-auto rounded border" style={{ borderColor: "var(--border)" }}>
        <table className="w-full min-w-[820px] text-sm">
          <thead style={{ background: "var(--bg-elevated)" }}>
            <tr>
              <th className="px-3 py-2 text-left">項目</th>
              <th className="px-3 py-2 text-left">來源</th>
              <th className="px-3 py-2 text-right">金額</th>
              <th className="px-3 py-2 text-right">已收</th>
              <th className="px-3 py-2 text-left">狀態</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="px-3 py-2">{item.title}</td>
                <td className="px-3 py-2">{item.source_type}</td>
                <td className="px-3 py-2 text-right">NT${item.amount.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">NT${item.paid_amount.toLocaleString()}</td>
                <td className="px-3 py-2">{STATUS_LABEL[item.status] ?? item.status}</td>
                <td className="px-3 py-2 text-right">
                  {item.status !== "paid" && item.status !== "canceled" && (
                    <button className="btn btn-primary text-xs" onClick={() => void markPaid(item.id)}>
                      標記已收
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border p-4" style={{ borderColor: "var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
