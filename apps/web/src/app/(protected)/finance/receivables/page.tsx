"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Search,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import { receivablesApi } from "@/lib/api";
import { cacheGet, cacheHas, cachePurge, cacheSet } from "@/lib/api-cache";
import type { ReceivableOut, ReceivableSummaryOut } from "@/lib/types";

const STATUS_META: Record<string, { label: string; tone: string }> = {
  unpaid: { label: "未收款", tone: "waiting" },
  partial: { label: "部分收款", tone: "partial" },
  paid: { label: "已收款", tone: "paid" },
  refunding: { label: "退款中", tone: "refunding" },
  refunded: { label: "已退款", tone: "refunded" },
  canceled: { label: "已取消", tone: "canceled" },
};

const SOURCE_LABEL: Record<string, string> = {
  shop_order: "校商訂單",
  meal_order: "學餐訂單",
  activity_fee: "活動費用",
  class_fee: "班級費用",
  manual: "手動建立",
};

function formatDate(value?: string | null): string {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(new Date(value));
}

export default function ReceivablesPage() {
  const search = useSearchParams();
  const activityId = search.get("activity_id") || undefined;
  const cacheKey = `finance/receivables/${activityId ?? "all"}`;
  const summaryKey = `finance/receivables-summary/${activityId ?? "all"}`;
  const [rows, setRows] = useState<ReceivableOut[]>(() => cacheGet<ReceivableOut[]>(cacheKey) ?? []);
  const [summary, setSummary] = useState<ReceivableSummaryOut | null>(
    () => cacheGet<ReceivableSummaryOut>(summaryKey) ?? null,
  );
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(!cacheHas(cacheKey));
  const [processingId, setProcessingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setIsLoading(true);
      const [items, sum] = await Promise.all([
        receivablesApi.list({ activity_id: activityId, status: status || undefined, limit: 300 }),
        receivablesApi.summary({ activity_id: activityId }),
      ]);
      setRows(items);
      setSummary(sum);
      if (!status) {
        cacheSet(cacheKey, items);
        cacheSet(summaryKey, sum);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "載入收款資料失敗");
    } finally {
      setIsLoading(false);
    }
  }, [activityId, status, cacheKey, summaryKey]);

  useEffect(() => {
    if (!cacheHas(cacheKey) || status) void reload();
  }, [reload, cacheKey, status]);

  const markPaid = async (id: string) => {
    try {
      setProcessingId(id);
      await receivablesApi.markPaid(id);
      toast.success("已標記收款");
      cachePurge("finance/receivables");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "標記收款失敗");
    } finally {
      setProcessingId(null);
    }
  };

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-TW");
    if (!needle) return rows;
    return rows.filter((item) => (
      item.title.toLocaleLowerCase("zh-TW").includes(needle)
      || (SOURCE_LABEL[item.source_type] || item.source_type)
        .toLocaleLowerCase("zh-TW")
        .includes(needle)
    ));
  }, [query, rows]);
  const totalAmount = summary?.total_amount ?? 0;
  const paidAmount = summary?.paid_amount ?? 0;
  const collectionRate = totalAmount > 0
    ? Math.min(100, Math.round((paidAmount / totalAmount) * 100))
    : 0;

  return (
    <main className="receivables-page">
      <Link href="/finance" className="receivables-page__back">
        <ArrowLeft size={15} aria-hidden="true" />返回財務作業桌
      </Link>
      <header className="receivables-header">
        <div>
          <h1>班級與校商收款</h1>
          <p>集中追蹤班級訂購、校商交易與活動費用；這裡處理應收狀態，不會改動複式財務總帳。</p>
        </div>
        <AnimatedDownloadButton
          className="btn btn-secondary"
          href={receivablesApi.exportUrl({ activity_id: activityId })}
          filename="receivables.csv"
          label="匯出收款明細"
        />
      </header>

      <section className="receivables-overview" aria-label="收款概況">
        <div className="receivables-overview__lead">
          <span>收款進度</span><strong>{collectionRate}%</strong>
          <div aria-hidden="true"><i style={{ width: `${collectionRate}%` }} /></div>
          <p>已收 NT${paidAmount.toLocaleString()}，尚有 NT${(summary?.unpaid_amount ?? 0).toLocaleString()} 待收。</p>
        </div>
        <ReceivableMetric icon={WalletCards} label="應收總額" value={`NT$${totalAmount.toLocaleString()}`} />
        <ReceivableMetric icon={CheckCircle2} label="已收金額" value={`NT$${paidAmount.toLocaleString()}`} tone="success" />
        <ReceivableMetric icon={Clock3} label="未收金額" value={`NT$${(summary?.unpaid_amount ?? 0).toLocaleString()}`} tone="warning" />
      </section>

      <section className="receivables-worklist" aria-labelledby="receivables-list-heading">
        <header>
          <div><h2 id="receivables-list-heading">收款工作清單</h2><p>{filteredRows.length} 筆符合目前條件</p></div>
          <div className="receivables-filters">
            <label className="receivables-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋項目或來源" aria-label="搜尋收款項目" /></label>
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="依收款狀態篩選"><option value="">全部狀態</option>{Object.entries(STATUS_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select>
          </div>
        </header>

        {isLoading && rows.length === 0 ? (
          <div className="receivables-loading" role="status">正在同步收款資料…</div>
        ) : filteredRows.length === 0 ? (
          <div className="receivables-empty"><CircleDollarSign size={24} aria-hidden="true" /><div><h3>{query || status ? "沒有符合條件的收款項目" : "目前沒有待追蹤的應收款"}</h3><p>{query || status ? "調整搜尋文字或狀態篩選後再試一次。" : "班級訂購、校商交易或活動費用建立後會出現在這裡。"}</p></div></div>
        ) : (
          <>
            <div className="receivables-table">
              <table>
                <thead><tr><th>項目</th><th>來源</th><th>應收</th><th>收款進度</th><th>到期日</th><th>狀態</th><th>操作</th></tr></thead>
                <tbody>{filteredRows.map((item) => {
                  const meta = STATUS_META[item.status] ?? { label: item.status, tone: "canceled" };
                  const progress = item.amount > 0
                    ? Math.min(100, Math.round((item.paid_amount / item.amount) * 100))
                    : 0;
                  return <tr key={item.id}><td><strong>{item.title}</strong>{item.note && <small>{item.note}</small>}</td><td>{SOURCE_LABEL[item.source_type] || item.source_type}</td><td>NT${item.amount.toLocaleString()}</td><td><span className="receivables-progress"><span><i style={{ width: `${progress}%` }} /></span><b>{progress}%</b></span></td><td>{formatDate(item.due_at)}</td><td><span className={`receivables-status is-${meta.tone}`}>{meta.label}</span></td><td>{item.status !== "paid" && item.status !== "canceled" ? <button className="btn btn-primary" disabled={processingId === item.id} onClick={() => void markPaid(item.id)}>{processingId === item.id ? "處理中…" : "標記已收"}</button> : <span className="receivables-complete"><Check size={14} aria-hidden="true" />已完成</span>}</td></tr>;
                })}</tbody>
              </table>
            </div>
            <div className="receivables-cards">{filteredRows.map((item) => {
              const meta = STATUS_META[item.status] ?? { label: item.status, tone: "canceled" };
              const progress = item.amount > 0
                ? Math.min(100, Math.round((item.paid_amount / item.amount) * 100))
                : 0;
              return <article key={item.id}><header><div><span>{SOURCE_LABEL[item.source_type] || item.source_type}</span><h3>{item.title}</h3></div><span className={`receivables-status is-${meta.tone}`}>{meta.label}</span></header><div className="receivables-card__amount"><span>應收 <b>NT${item.amount.toLocaleString()}</b></span><span>已收 <b>NT${item.paid_amount.toLocaleString()}</b></span></div><div className="receivables-progress"><span><i style={{ width: `${progress}%` }} /></span><b>{progress}%</b></div><footer><small>到期日：{formatDate(item.due_at)}</small>{item.status !== "paid" && item.status !== "canceled" ? <button className="btn btn-primary" disabled={processingId === item.id} onClick={() => void markPaid(item.id)}>{processingId === item.id ? "處理中…" : "標記已收"}</button> : <span className="receivables-complete"><Check size={14} aria-hidden="true" />已完成</span>}</footer></article>;
            })}</div>
          </>
        )}
      </section>
    </main>
  );
}

function ReceivableMetric({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof WalletCards;
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <div className={`receivables-metric is-${tone}`}>
      <Icon size={17} aria-hidden="true" /><span>{label}</span><strong>{value}</strong>
    </div>
  );
}
