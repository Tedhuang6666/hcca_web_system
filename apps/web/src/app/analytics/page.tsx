"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { analyticsApi } from "@/lib/api";
import { safeInternalHref } from "@/lib/config";
import type {
  AnalyticsInsightItem,
  AnnouncementParticipationItem,
  DeptRankingItem,
  DocumentEfficiencyOut,
  PendingAlertItem,
  SurveyParticipationItem,
} from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function fmtHours(value: number | null) {
  if (value === null) return "尚無資料";
  if (value < 1) return `${Math.round(value * 60)} 分鐘`;
  return `${value.toFixed(1)} 小時`;
}

function fmtDate(value: string | null) {
  if (!value) return "尚未發布";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

const SURVEY_STATUS_LABEL: Record<string, string> = {
  open: "開放中",
  closed: "已關閉",
  archived: "已封存",
};

const ANALYTICS_KEY = "analytics/data";

export default function AnalyticsPage() {
  const { can } = usePermissions();
  const canView = can("analytics:view") || can("admin:all");
  const canViewPending = can("document:admin") || can("admin:all");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(!cacheHas(ANALYTICS_KEY));
  const [efficiency, setEfficiency] = useState<DocumentEfficiencyOut | null>(() => cacheGet<DocumentEfficiencyOut>(ANALYTICS_KEY + "/efficiency") ?? null);
  const [ranking, setRanking] = useState<DeptRankingItem[]>(() => cacheGet<DeptRankingItem[]>(ANALYTICS_KEY + "/ranking") ?? []);
  const [pending, setPending] = useState<PendingAlertItem[]>(() => cacheGet<PendingAlertItem[]>(ANALYTICS_KEY + "/pending") ?? []);
  const [insights, setInsights] = useState<AnalyticsInsightItem[]>(() => cacheGet<AnalyticsInsightItem[]>(ANALYTICS_KEY + "/insights") ?? []);
  const [announcements, setAnnouncements] = useState<AnnouncementParticipationItem[]>(() => cacheGet<AnnouncementParticipationItem[]>(ANALYTICS_KEY + "/announcements") ?? []);
  const [surveys, setSurveys] = useState<SurveyParticipationItem[]>(() => cacheGet<SurveyParticipationItem[]>(ANALYTICS_KEY + "/surveys") ?? []);

  const filterParams = useMemo(() => ({
    date_from: dateFrom ? `${dateFrom}T00:00:00` : undefined,
    date_to: dateTo ? `${dateTo}T23:59:59` : undefined,
  }), [dateFrom, dateTo]);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    // 有 filter 條件時強制 loading；無條件且有快取時靜默更新
    const hasCached = cacheHas(ANALYTICS_KEY) && !dateFrom && !dateTo;
    if (!hasCached) setLoading(true);
    const results = await Promise.allSettled([
      analyticsApi.documentEfficiency(filterParams),
      analyticsApi.deptRanking(filterParams),
      analyticsApi.insights(12).then((res) => res.items),
      analyticsApi.announcementParticipation({ ...filterParams, limit: 8 }),
      analyticsApi.surveyParticipation({ ...filterParams, limit: 8 }),
      canViewPending
        ? analyticsApi.pendingAlerts(48)
        : Promise.resolve([]),
    ] as const);
    const [effResult, ranksResult, insightsResult, annResult, surveyResult, alertsResult] =
      results;
    const eff = settledValue(effResult, null);
    const ranks = settledValue(ranksResult, []);
    const insightRows = settledValue(insightsResult, []);
    const ann = settledValue(annResult, []);
    const survey = settledValue(surveyResult, []);
    const alerts = settledValue(alertsResult, []);
    setEfficiency(eff);
    setRanking(ranks);
    setInsights(insightRows);
    setAnnouncements(ann);
    setSurveys(survey);
    setPending(alerts);
    if (!dateFrom && !dateTo) {
      // 只在無篩選條件時快取（有條件的結果不適合快取為預設值）
      cacheSet(ANALYTICS_KEY, true);
      cacheSet(ANALYTICS_KEY + "/efficiency", eff);
      cacheSet(ANALYTICS_KEY + "/ranking", ranks);
      cacheSet(ANALYTICS_KEY + "/insights", insightRows);
      cacheSet(ANALYTICS_KEY + "/announcements", ann);
      cacheSet(ANALYTICS_KEY + "/surveys", survey);
      cacheSet(ANALYTICS_KEY + "/pending", alerts);
    }
    if (results.some((result) => result.status === "rejected")) {
      toast.warning("部分分析資料暫時無法載入，其餘資料已更新");
    }
    setLoading(false);
  }, [canView, canViewPending, filterParams, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="card flex min-h-[260px] flex-col items-center justify-center gap-3 p-8 text-center">
          <h1 className="text-lg font-semibold">無法查看數據分析</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            需要 analytics:view 權限才能查看統計儀表板。
          </p>
        </div>
      </div>
    );
  }

  const overdueRate = efficiency ? `${Math.round(efficiency.overdue_rate * 100)}%` : "0%";

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            ANALYTICS
          </p>
          <h1 className="mt-1 text-xl font-semibold">績效統計儀表板</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            公文效率、公告閱讀與問卷回應概覽
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? "載入中" : "重新整理"}
        </button>
      </header>

      <section className="card p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>起始日期</span>
            <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>結束日期</span>
            <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <div className="flex items-end">
            <button
              className="btn btn-ghost w-full"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              disabled={!dateFrom && !dateTo}>
              清除範圍
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="公文效率摘要">
        {[
          ["平均處理時間", fmtHours(efficiency?.avg_processing_hours ?? null), "已完成公文送審到結案的平均時間"],
          ["公文總量", String(efficiency?.total_documents ?? 0), "符合目前篩選條件的公文數"],
          ["已結案", String(efficiency?.completed_documents ?? 0), "已有 completed_at 的公文"],
          ["逾期率", overdueRate, `${efficiency?.overdue_count ?? 0} 件目前逾期未完成`],
        ].map(([label, value, desc]) => (
          <div key={label} className="card p-5">
            <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</p>
            <p className="mt-2 text-3xl font-bold leading-none" style={{ color: "var(--text-primary)" }}>
              {loading ? "..." : value}
            </p>
            <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{desc}</p>
          </div>
        ))}
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 className="text-sm font-semibold">需要注意</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              依卡關、低參與與負載集中規則自動排序
            </p>
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{insights.length} 項</span>
        </div>
        {insights.length === 0 ? (
          <p className="px-5 py-8 text-sm" style={{ color: "var(--text-muted)" }}>
            目前沒有偵測到需要立即處理的異常。
          </p>
        ) : (
          <ul>
            {insights.slice(0, 6).map((item) => (
              <li key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <Link
                  href={safeInternalHref(item.href, "/analytics")}
                  className="block px-5 py-3 transition-colors"
                  style={{ textDecoration: "none" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        {item.description}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {item.recommended_action}
                      </p>
                    </div>
                    <InsightBadge item={item} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="table-container">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold">部門處理時效</h2>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{ranking.length} 個部門</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="table-header">
                <tr>
                  <th>部門</th>
                  <th>平均時間</th>
                  <th>件數</th>
                </tr>
              </thead>
              <tbody>
                {ranking.length === 0 ? (
                  <tr className="table-row"><td colSpan={3}>目前沒有資料</td></tr>
                ) : ranking.slice(0, 8).map((item) => (
                  <tr key={item.org_id} className="table-row">
                    <td>{item.org_name}</td>
                    <td>{fmtHours(item.avg_processing_hours)}</td>
                    <td>{item.total_docs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold">超時待簽核</h2>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>48 小時以上</span>
          </div>
          {!canViewPending ? (
            <p className="px-5 py-8 text-sm" style={{ color: "var(--text-muted)" }}>
              需要 document:admin 權限才能查看待簽核警告。
            </p>
          ) : pending.length === 0 ? (
            <p className="px-5 py-8 text-sm" style={{ color: "var(--text-muted)" }}>
              目前沒有超時待簽核項目。
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {pending.slice(0, 6).map((item) => (
                <li key={item.approval_id} className="px-5 py-3">
                  <Link href={`/documents/${item.document_id}`} className="block" style={{ textDecoration: "none" }}>
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {item.document_title}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      第 {item.step_order} 關，已等待 {fmtHours(item.waiting_hours)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold">公告閱讀參與</h2>
          </div>
          <ul>
            {announcements.length === 0 ? (
              <li className="px-5 py-8 text-sm" style={{ color: "var(--text-muted)" }}>目前沒有資料</li>
            ) : announcements.map((item) => (
              <li key={item.announcement_id} className="flex items-center justify-between gap-3 px-5 py-3"
                style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{fmtDate(item.published_at)}</p>
                </div>
                <span className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                  {item.reader_count} 次閱讀
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card overflow-hidden">
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold">問卷回應參與</h2>
          </div>
          <ul>
            {surveys.length === 0 ? (
              <li className="px-5 py-8 text-sm" style={{ color: "var(--text-muted)" }}>目前沒有資料</li>
            ) : surveys.map((item) => (
              <li key={item.survey_id} className="flex items-center justify-between gap-3 px-5 py-3"
                style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {SURVEY_STATUS_LABEL[item.status] ?? item.status} · {fmtDate(item.created_at)}
                  </p>
                </div>
                <span className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ background: "var(--info-dim)", color: "var(--info)" }}>
                  {item.response_count} 份回應
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function InsightBadge({ item }: { item: AnalyticsInsightItem }) {
  const colors = {
    critical: { color: "var(--danger)", bg: "var(--danger-dim)", border: "var(--danger-border)", label: "緊急" },
    warning: { color: "var(--warning)", bg: "var(--warning-dim)", border: "var(--warning-border)", label: "提醒" },
    info: { color: "var(--primary)", bg: "var(--primary-dim)", border: "var(--info-border)", label: "觀察" },
  }[item.severity];
  return (
    <span
      className="flex-shrink-0 rounded px-2 py-1 text-xs font-semibold"
      style={{ color: colors.color, background: colors.bg, border: `1px solid ${colors.border}` }}>
      {colors.label} {item.score}
    </span>
  );
}
