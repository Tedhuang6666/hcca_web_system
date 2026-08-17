"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Gauge, LoaderCircle, RefreshCw } from "lucide-react";
import { post, request } from "@/lib/api/core";

type HealthItem = { name: string; healthy: boolean; detail?: Record<string, unknown> };
type AuditItem = { id: string; title: string; score: number | null; numeric_value: number | null; display_value: string | null };
type ModeScore = {
  score: number | null;
  status: "ok" | "error";
  error: string | null;
  tested_at: string;
  metrics: { lcp_ms: number | null; inp_ms: number | null; tbt_ms: number | null; cls: number | null; ttfb_ms: number | null };
  audits: AuditItem[];
};
type PageStatus = "pass" | "needs_attention" | "error" | "pending";
type PageScore = { url: string; path: string; source?: "psi" | "configured" | "rum"; status: PageStatus; authenticated_status?: PageStatus; mobile: ModeScore | null; desktop: ModeScore | null; authenticated_mobile: ModeScore | null; authenticated_desktop: ModeScore | null };
type RecentError = { category?: string; exc_type?: string; message?: string; path?: string; status_code?: number; occurrences?: number; last_seen?: number };
type SlowQuery = { template: string; max_ms: number; occurrences: number; paths: { path: string; occurrences: number }[] };
type Providers = { sentry?: { configured?: boolean; error?: string }; posthog?: { configured?: boolean } };
type Overview = {
  system_health: HealthItem[];
  reliability: { error_rate: number | null; affected_users: number | null; new_issues: number; regressions: number };
  coverage: { discovered: number; monitored: number; passing: number; needs_attention: number; errors: number; pending: number; threshold: number };
  authenticated_coverage: { monitored: number; passing: number; needs_attention: number; errors: number; pending: number; threshold: number };
  synthetic: { mobile_performance: number | null; desktop_performance: number | null; mobile_lcp_ms: number | null; mobile_tbt_ms: number | null; tested_since: string | null };
  field: Record<string, number | null>;
  pages: PageScore[];
  latest_release: { commit_sha: string | null; deployed_at: string | null };
  recent_errors: RecentError[];
  slow_queries: SlowQuery[];
  providers?: Providers;
};
type ErrorsData = { new_issues: number; regressions: number | null; top_exceptions: RecentError[]; slow_transactions: SlowQuery[]; sentry?: { configured?: boolean; error?: string; stats?: unknown }; slow_query_source?: string };
type BudgetStatus = "good" | "needs_improvement" | "poor" | "pending";
type ApiLatencyBudget = { p95_ms: number | null; budget_ms: number; status: BudgetStatus };
type InteractionTelemetry = { name: string; feedback_p75_ms: number | null; completion_p75_ms: number | null; samples: number; feedback_status: BudgetStatus; completion_status: BudgetStatus };
type RouteTelemetry = { path: string; pageviews: number; api_errors: number; client_errors?: number; samples: Record<string, number>; web_vitals: Record<string, number | null>; api_latency_p95_ms: number | null; api_latency_p95_ms_by_kind?: Record<string, ApiLatencyBudget>; interaction_feedback_p75_ms?: number | null; interaction_completion_p75_ms?: number | null; interaction_samples?: { feedback: number; completion: number }; resource_timing_p75_ms?: number | null; longtask_p75_ms?: number | null; longtask_samples?: number; navigation_ttfb_p75_ms?: number | null; navigation_total_p75_ms?: number | null; custom_metrics?: Record<string, { p75_ms: number | null; samples: number }>; interactions?: InteractionTelemetry[] };
type RealUsersData = { configured: boolean; data_available: boolean; dau: number | null; sessions: number | null; pageviews: number | null; top_routes: RouteTelemetry[]; web_vitals: Record<string, number | null>; client_errors: number | null; source: string; message: string };
type PerformanceData = { url: string; psi: PageScore[]; crux: { collection_periods?: { firstDate: string; lastDate: string }[]; lcp_p75?: number[]; inp_p75?: number[]; cls_p75?: number[]; ttfb_p75?: number[]; error?: string }; lighthouse_regressions: PageScore[] };
type Release = { release: string; commit_sha: string; environment: string; deployed_at: string };
type CollectionResult = { queued?: boolean; task_id?: string; message?: string; created?: number; failed?: number; urls?: number; strategies?: number; skipped?: string };
type CollectionNotice = { tone: "success" | "warning" | "error"; message: string };
type Tab = "overview" | "errors" | "real-users" | "performance" | "releases";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "總覽" },
  { id: "errors", label: "錯誤與慢查詢" },
  { id: "real-users", label: "真實使用者" },
  { id: "performance", label: "頁面效能" },
  { id: "releases", label: "部署版本" },
];

function formatNumber(value: number | null | undefined, suffix = "") {
  if (value == null || Number.isNaN(value)) return "—";
  return `${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeOverview(value: Overview | null | undefined): Overview {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Overview>;
  const coverage = (raw.coverage ?? {}) as Partial<Overview["coverage"]>;
  const reliability = (raw.reliability ?? {}) as Partial<Overview["reliability"]>;
  const synthetic = (raw.synthetic ?? {}) as Partial<Overview["synthetic"]>;
  const authenticatedCoverage = (raw.authenticated_coverage ?? {}) as Partial<Overview["authenticated_coverage"]>;
  const latestRelease = (raw.latest_release ?? {}) as Partial<Overview["latest_release"]>;
  return {
    ...value,
    system_health: asArray<HealthItem>(raw.system_health),
    reliability: {
      error_rate: reliability.error_rate ?? null,
      affected_users: reliability.affected_users ?? null,
      new_issues: reliability.new_issues ?? 0,
      regressions: reliability.regressions ?? 0,
    },
    coverage: {
      discovered: coverage.discovered ?? 0,
      monitored: coverage.monitored ?? 0,
      passing: coverage.passing ?? 0,
      needs_attention: coverage.needs_attention ?? 0,
      errors: coverage.errors ?? 0,
      pending: coverage.pending ?? 0,
      threshold: coverage.threshold ?? 95,
    },
    authenticated_coverage: {
      monitored: authenticatedCoverage.monitored ?? 0,
      passing: authenticatedCoverage.passing ?? 0,
      needs_attention: authenticatedCoverage.needs_attention ?? 0,
      errors: authenticatedCoverage.errors ?? 0,
      pending: authenticatedCoverage.pending ?? 0,
      threshold: authenticatedCoverage.threshold ?? coverage.threshold ?? 95,
    },
    synthetic: {
      mobile_performance: synthetic.mobile_performance ?? null,
      desktop_performance: synthetic.desktop_performance ?? null,
      mobile_lcp_ms: synthetic.mobile_lcp_ms ?? null,
      mobile_tbt_ms: synthetic.mobile_tbt_ms ?? null,
      tested_since: synthetic.tested_since ?? null,
    },
    field: raw.field ?? {},
    pages: asArray<PageScore>(raw.pages),
    latest_release: {
      commit_sha: latestRelease.commit_sha ?? null,
      deployed_at: latestRelease.deployed_at ?? null,
    },
    recent_errors: asArray<RecentError>(raw.recent_errors),
    slow_queries: asArray<SlowQuery>(raw.slow_queries),
  };
}

function normalizeTabData(tab: Tab, value: ErrorsData | RealUsersData | PerformanceData | Release[]) {
  if (tab === "releases") return asArray<Release>(value);
  if (tab === "errors") {
    const raw = (value ?? {}) as Partial<ErrorsData>;
    return {
      ...raw,
      top_exceptions: asArray<RecentError>(raw.top_exceptions),
      slow_transactions: asArray<SlowQuery>(raw.slow_transactions),
    } as ErrorsData;
  }
  if (tab === "real-users") {
    const raw = (value ?? {}) as Partial<RealUsersData>;
    return { ...raw, top_routes: asArray<RouteTelemetry>(raw.top_routes) } as RealUsersData;
  }
  const raw = (value ?? {}) as Partial<PerformanceData>;
  return {
    ...raw,
    psi: asArray<PageScore>(raw.psi),
    lighthouse_regressions: asArray<PageScore>(raw.lighthouse_regressions),
    crux: raw.crux ?? {},
  } as PerformanceData;
}

function formatDate(value: string | number | null | undefined) {
  if (value == null) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function scoreColor(score: number | null | undefined) {
  if (score == null) return "var(--text-muted)";
  if (score >= 95) return "var(--success)";
  if (score >= 80) return "var(--warning)";
  return "var(--error)";
}

function statusLabel(status: PageStatus, source?: PageScore["source"]) {
  if (status === "pending" && source === "rum") return "RUM 已發現／待 PSI";
  return { pass: "達標", needs_attention: "需處理", error: "採集失敗", pending: "待測試" }[status];
}

function StatusPill({ status, source }: { status: PageStatus; source?: PageScore["source"] }) {
  const color = status === "pass" ? "var(--success)" : status === "pending" ? "var(--text-muted)" : "var(--error)";
  return <span className="inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold" style={{ borderColor: color, color }}>{statusLabel(status, source)}</span>;
}

function Score({ value }: { value: number | null | undefined }) {
  return <strong style={{ color: scoreColor(value) }}>{value == null ? "—" : Math.round(value)}</strong>;
}

export default function ObservabilityPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectionNotice, setCollectionNotice] = useState<CollectionNotice | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [tabData, setTabData] = useState<ErrorsData | RealUsersData | PerformanceData | Release[] | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    request<Overview>("/admin/system/observability/overview")
      .then((value) => { if (active) { setOverview(normalizeOverview(value)); setOverviewError(null); } })
      .catch((error: Error) => { if (active) setOverviewError(error.message || "無法讀取觀測資料"); })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    if (tab === "overview") return;
    let active = true;
    setTabLoading(true);
    setTabError(null);
    setTabData(null);
    const encodedUrl = selectedUrl ? `?url=${encodeURIComponent(selectedUrl)}` : "";
    const endpoint = tab === "errors"
      ? "/admin/system/observability/errors"
      : tab === "real-users"
        ? "/admin/system/observability/real-users"
        : tab === "performance"
          ? `/admin/system/observability/performance${encodedUrl}`
          : "/admin/system/observability/releases";
    request<ErrorsData | RealUsersData | PerformanceData | Release[]>(endpoint)
      .then((value) => active && setTabData(normalizeTabData(tab, value)))
      .catch((error: Error) => active && setTabError(error.message || "無法讀取資料"))
      .finally(() => active && setTabLoading(false));
    return () => { active = false; };
  }, [tab, selectedUrl, refreshKey]);

  const pages = overview?.pages;
  const selectedPage = useMemo(() => {
    const availablePages = pages ?? [];
    return availablePages.find((page) => page.url === selectedUrl) ?? availablePages[0] ?? null;
  }, [pages, selectedUrl]);

  async function collectPsi() {
    setCollectionNotice(null);
    setCollecting(true);
    try {
      const result = await post<CollectionResult>("/admin/system/observability/collect/psi");
      if (result.skipped) {
        setCollectionNotice({ tone: "warning", message: `尚未採集：${result.skipped}` });
      } else if (result.queued) {
        setCollectionNotice({ tone: "success", message: result.message ?? "PSI 採集已排入背景工作，完成後重新整理即可查看結果。" });
        setRefreshKey((value) => value + 1);
      } else {
        setCollectionNotice({
          tone: result.failed ? "warning" : "success",
          message: `PSI 採集完成：${result.created ?? 0} 筆成功${result.failed ? `，${result.failed} 筆失敗` : ""}。`,
        });
        setRefreshKey((value) => value + 1);
      }
    } catch (error) {
      setCollectionNotice({ tone: "error", message: error instanceof Error ? error.message : "PSI 採集失敗" });
    } finally {
      setCollecting(false);
    }
  }

  return <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: "var(--border)" }}>
      <div><p className="text-sm" style={{ color: "var(--text-muted)" }}>Production observability</p><h1 className="mt-1 text-2xl font-semibold sm:text-3xl">系統可觀測性</h1><p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>追蹤 sitemap 全部公開頁面、登入後真實使用者體驗，以及部署端的錯誤與慢查詢。</p></div>
      <div className="flex flex-col items-stretch gap-2 sm:items-end">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-wait disabled:opacity-60" style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)" }} onClick={() => { setRefreshing(true); setRefreshKey((value) => value + 1); }} disabled={loading || refreshing}><RefreshCw size={16} aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />{loading || refreshing ? "讀取中…" : "重新整理"}</button>
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-60" style={{ background: "var(--primary)", color: "var(--primary-text)" }} onClick={collectPsi} disabled={collecting} aria-busy={collecting}>{collecting ? <LoaderCircle size={16} aria-hidden="true" className="animate-spin" /> : <Gauge size={16} aria-hidden="true" />}{collecting ? "PSI 採集中…" : "立即採集 PSI"}</button>
        </div>
        {collectionNotice && <p role="status" className="text-right text-xs" style={{ color: collectionNotice.tone === "success" ? "var(--success)" : collectionNotice.tone === "warning" ? "var(--warning)" : "var(--error)" }}>{collectionNotice.message}</p>}
      </div>
    </header>
    <nav className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }} aria-label="觀測分頁">
      {tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined} className="min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors" style={{ borderColor: tab === item.id ? "var(--primary)" : "transparent", color: tab === item.id ? "var(--text-primary)" : "var(--text-muted)" }}>{item.label}</button>)}
    </nav>
    {overviewError && <InlineError message={overviewError} />}
    {tab === "overview" && <OverviewPanel data={overview} loading={loading} onInspect={(url) => { setSelectedUrl(url); setTab("performance"); }} />}
    {tab !== "overview" && tabLoading && <LoadingState />}
    {tab !== "overview" && tabError && <InlineError message={tabError} />}
    {tab === "errors" && tabData && <ErrorsPanel data={tabData as ErrorsData} />}
    {tab === "real-users" && tabData && <RealUsersPanel data={tabData as RealUsersData} />}
    {tab === "performance" && tabData && <PerformancePanel data={tabData as PerformanceData} page={selectedPage} />}
    {tab === "releases" && tabData && <ReleasesPanel data={tabData as Release[]} />}
  </main>;
}

function OverviewPanel({ data, loading, onInspect }: { data: Overview | null; loading: boolean; onInspect: (url: string) => void }) {
  if (loading && !data) return <LoadingState />;
  if (!data) return <EmptyState title="尚無觀測資料" detail="確認超級管理員權限與 API 服務狀態後再重新整理。" />;
  return <div className="space-y-6">
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="監控摘要">
      <SummaryMetric label="已發現頁面" value={data.coverage.discovered} detail={`目前列出 ${data.coverage.monitored} 頁`} />
      <SummaryMetric label="達標頁面" value={data.coverage.passing} detail={`門檻 PSI ${data.coverage.threshold}`} tone="var(--success)" />
      <SummaryMetric label="低於門檻" value={data.coverage.needs_attention} detail={`採集失敗 ${data.coverage.errors}／待測 ${data.coverage.pending}`} tone={data.coverage.needs_attention ? "var(--error)" : "var(--success)"} />
      <SummaryMetric label="最近 mobile 平均" value={formatNumber(data.synthetic.mobile_performance)} detail={`LCP ${formatNumber(data.synthetic.mobile_lcp_ms, " ms")}`} tone={scoreColor(data.synthetic.mobile_performance)} />
      <SummaryMetric label="登入後達標" value={data.authenticated_coverage.passing} detail={`已測 ${data.authenticated_coverage.monitored}／失敗 ${data.authenticated_coverage.errors}／待測 ${data.authenticated_coverage.pending}`} tone={data.authenticated_coverage.errors || data.authenticated_coverage.needs_attention ? "var(--warning)" : "var(--success)"} />
    </section>
    <section><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-base font-semibold">服務狀態</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>這些狀態來自本次 API 請求的即時探測。</p></div><span className="text-xs" style={{ color: "var(--text-muted)" }}>版本 {data.latest_release.commit_sha?.slice(0, 8) ?? "—"}</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data.system_health.map((item) => <div key={item.name} className="rounded-md border p-4" style={{ borderColor: "var(--border)" }}><div className="flex items-center gap-2 text-sm"><span aria-hidden="true" style={{ color: item.healthy ? "var(--success)" : "var(--error)" }}>●</span>{item.name}</div><strong className="mt-2 block">{item.healthy ? "正常" : "異常"}</strong></div>)}</div></section>
    <PageTable pages={data.pages} threshold={data.coverage.threshold} onInspect={onInspect} />
  </div>;
}

function PageTable({ pages, threshold, onInspect }: { pages: PageScore[]; threshold: number; onInspect: (url: string) => void }) {
  return <section className="space-y-3"><div><h2 className="text-base font-semibold">全部已發現頁面</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>來源包含 sitemap、關鍵路由與真實使用者 RUM；公開與登入後合成測試都必須同時達到 mobile 與 desktop {threshold} 分。登入後結果由獨立短效 session 探針產生。</p></div>{pages.length === 0 ? <EmptyState title="尚未發現頁面" detail="請確認 sitemap.xml 或第一方 RUM 可由部署端讀取。" /> : <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}><table className="w-full min-w-[1120px] text-left text-sm"><thead style={{ background: "var(--bg-surface)" }}><tr className="border-b" style={{ borderColor: "var(--border)" }}><th className="px-4 py-3 font-medium">頁面</th><th className="px-4 py-3 font-medium">來源</th><th className="px-4 py-3 font-medium">公開 M / D</th><th className="px-4 py-3 font-medium">登入後 M / D</th><th className="px-4 py-3 font-medium">公開 LCP / TBT</th><th className="px-4 py-3 font-medium">狀態</th><th className="px-4 py-3"><span className="sr-only">操作</span></th></tr></thead><tbody>{pages.map((page) => <tr key={page.url} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}><td className="max-w-[22rem] px-4 py-3"><div className="truncate font-medium" title={page.url}>{page.path}</div><div className="mt-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>{page.url}</div></td><td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{page.source === "rum" ? "RUM／使用者" : page.source === "psi" ? "PSI" : "關鍵路由"}</td><td className="px-4 py-3"><Score value={page.mobile?.score} /> <span style={{ color: "var(--text-muted)" }}>/</span> <Score value={page.desktop?.score} /></td><td className="px-4 py-3"><Score value={page.authenticated_mobile?.score} /> <span style={{ color: "var(--text-muted)" }}>/</span> <Score value={page.authenticated_desktop?.score} /></td><td className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{page.mobile ? `${formatNumber(page.mobile.metrics.lcp_ms, " ms")} / ${formatNumber(page.mobile.metrics.tbt_ms, " ms")}` : "—"}</td><td className="space-y-1 px-4 py-3"><StatusPill status={page.status} source={page.source} />{page.authenticated_status && <div><span className="text-xs" style={{ color: "var(--text-muted)" }}>登入後：</span><StatusPill status={page.authenticated_status} /></div>}</td><td className="px-4 py-3 text-right"><button type="button" className="min-h-11 rounded-md px-2 text-xs font-semibold hover:bg-[var(--bg-hover)]" style={{ color: "var(--primary)" }} onClick={() => onInspect(page.url)}>查看詳情</button></td></tr>)}</tbody></table></div>}</section>;
}

function budgetColor(status: BudgetStatus | undefined) {
  return status === "good" ? "var(--success)" : status === "pending" ? "var(--text-muted)" : "var(--error)";
}

function budgetStatus(value: number | null | undefined, good: number, needs: number): BudgetStatus {
  if (value == null) return "pending";
  return value <= good ? "good" : value <= needs ? "needs_improvement" : "poor";
}

function ErrorsPanel({ data }: { data: ErrorsData }) {
  return <div className="space-y-6"><section className="grid gap-3 sm:grid-cols-3"><SummaryMetric label="最近錯誤" value={data.new_issues} detail="來自跨 worker 錯誤緩衝" tone={data.new_issues ? "var(--error)" : "var(--success)"} /><SummaryMetric label="Sentry" value={data.sentry?.configured ? "已連線" : "未設定"} detail={data.sentry?.error ?? "錯誤資料仍可由本機緩衝查看"} /><SummaryMetric label="慢查詢來源" value="即時" detail={data.slow_query_source ?? "query audit"} /></section><DataList title="近期錯誤" empty="目前沒有被保留的錯誤" items={data.top_exceptions} render={(item) => <div><div className="font-medium">{item.exc_type || item.category || "未分類錯誤"}</div><div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{item.path || "—"} · {item.occurrences ?? 1} 次 · HTTP {item.status_code ?? "—"}</div><div className="mt-1 truncate text-sm" style={{ color: "var(--text-secondary)" }}>{item.message || "—"}</div></div>} /><DataList title="慢查詢" empty="目前沒有超過門檻的慢查詢" items={data.slow_transactions} render={(item) => <div><div className="font-mono text-xs">{item.template}</div><div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>最高 {formatNumber(item.max_ms, " ms")} · {item.occurrences} 次 · {item.paths?.[0]?.path || "—"}</div></div>} /></div>;
}

function RealUsersPanel({ data }: { data: RealUsersData }) {
  const routes = Array.isArray(data.top_routes) ? data.top_routes : [];
  const routeInteractions = routes.flatMap((route) =>
    (route.interactions ?? []).map((interaction) => ({ route: route.path, interaction })),
  );
  return (
    <div className="space-y-6">
      <section className="rounded-md border p-5" style={{ borderColor: data.data_available ? "var(--success)" : "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">真實使用者監測</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{data.message}</p>
          </div>
          <StatusPill status={data.data_available ? "pass" : "pending"} />
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          互動回饋 ≤100 ms／INP p75 ≤200 ms；API p95：簡單 GET ≤300 ms、CRUD ≤500 ms、重型操作 ≤2 s。
        </p>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric label="DAU" value={data.dau == null ? "—" : data.dau} detail="需 PostHog 查詢權限" />
        <SummaryMetric label="Sessions" value={data.sessions == null ? "—" : data.sessions} detail="需 PostHog 查詢權限" />
        <SummaryMetric label="Pageviews" value={data.pageviews == null ? "—" : data.pageviews} detail="第一方 RUM，近 24 小時" />
        <SummaryMetric label="RUM 狀態" value={data.data_available ? "運作中" : "待連線"} detail={data.source} />
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">所有已造訪路由</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>公開、登入與未來新增頁面會在首次造訪後自動出現；不收集訪客身份。</p>
        </div>
        {routes.length === 0 ? <EmptyState title="尚無第一方 RUM 樣本" detail="開啟任一頁面後，等待約一秒讓批次 telemetry 送出。" /> : (
          <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full min-w-[1220px] text-left text-sm">
              <thead><tr className="border-b" style={{ borderColor: "var(--border)" }}>
                <th className="px-4 py-3">路由</th><th className="px-4 py-3">瀏覽</th><th className="px-4 py-3">LCP / INP / CLS p75</th>
                <th className="px-4 py-3">互動回饋 / 完成 p75</th><th className="px-4 py-3">API p95（GET／CRUD／重型）</th><th className="px-4 py-3">瀏覽器執行效能</th><th className="px-4 py-3">錯誤</th>
              </tr></thead>
              <tbody>{routes.map((route) => {
                const feedbackStatus = budgetStatus(route.interaction_feedback_p75_ms, 100, 200);
                const completionStatus = budgetStatus(route.interaction_completion_p75_ms, 500, 2_000);
                const api = route.api_latency_p95_ms_by_kind ?? {};
                const webVitals = route.web_vitals ?? {};
                return <tr key={route.path} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-3 font-medium">{route.path}</td>
                  <td className="px-4 py-3">{route.pageviews}</td>
                  <td className="px-4 py-3 text-xs">{formatNumber(webVitals.lcp_p75, " ms")} / {formatNumber(webVitals.inp_p75, " ms")} / {formatNumber(webVitals.cls_p75)}</td>
                  <td className="px-4 py-3 text-xs"><div style={{ color: budgetColor(feedbackStatus) }}>{formatNumber(route.interaction_feedback_p75_ms, " ms")} <span className="text-[10px]">回饋</span></div><div style={{ color: budgetColor(completionStatus) }}>{formatNumber(route.interaction_completion_p75_ms, " ms")} <span className="text-[10px]">完成</span></div></td>
                  <td className="px-4 py-3 text-xs"><div>GET {formatNumber(api.simple_get?.p95_ms, " ms")}</div><div>CRUD {formatNumber(api.crud?.p95_ms, " ms")}</div><div>重型 {formatNumber(api.heavy?.p95_ms, " ms")}</div></td>
                  <td className="px-4 py-3 text-xs"><div>TTFB {formatNumber(route.navigation_ttfb_p75_ms, " ms")}</div><div>長任務 {formatNumber(route.longtask_p75_ms, " ms")}</div><div>資源 {formatNumber(route.resource_timing_p75_ms, " ms")}</div></td>
                  <td className="px-4 py-3 text-xs" style={{ color: route.api_errors || route.client_errors ? "var(--error)" : "var(--success)" }}><div>API {route.api_errors}</div><div>瀏覽器 {route.client_errors ?? 0}</div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      {routeInteractions.length > 0 && <section className="space-y-3"><div><h2 className="text-base font-semibold">具名操作</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>按鈕、表單與導覽操作會量測按下後首次視覺回饋，以及對應 API 完成時間。</p></div><div className="grid gap-3 md:grid-cols-2">{routeInteractions.slice(0, 40).map(({ route, interaction }) => <div key={`${route}:${interaction.name}`} className="rounded-md border p-4" style={{ borderColor: "var(--border)" }}><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{interaction.name}</span><span className="text-xs" style={{ color: "var(--text-muted)" }}>{route}</span></div><div className="mt-2 grid grid-cols-2 gap-3 text-xs"><div style={{ color: budgetColor(interaction.feedback_status) }}>回饋 {formatNumber(interaction.feedback_p75_ms, " ms")}</div><div style={{ color: budgetColor(interaction.completion_status) }}>完成 {formatNumber(interaction.completion_p75_ms, " ms")}</div></div></div>)}</div></section>}
    </div>
  );
}

function PerformancePanel({ data, page }: { data: PerformanceData; page: PageScore | null }) {
  // 舊版 API 或部分失敗回應可能沒有 crux；效能詳情不可因此整頁崩潰。
  if (!data.crux) data.crux = {};
  const selected = page ?? data.psi[0] ?? null;
  const modes = selected ? [
    ["公開 Mobile", selected.mobile],
    ["公開 Desktop", selected.desktop],
    ["登入後 Mobile", selected.authenticated_mobile],
    ["登入後 Desktop", selected.authenticated_desktop],
  ].filter((entry): entry is [string, ModeScore] => Boolean(entry[1])) : [];
  return <div className="space-y-6"><section className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: "var(--border)" }}><div><h2 className="text-base font-semibold">頁面效能詳情</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{data.url || page?.url || "—"}</p></div><span className="text-xs" style={{ color: "var(--text-muted)" }}>公開 PSI、登入後 Lighthouse 與 CrUX 分開呈現</span></section><div className="grid gap-3 sm:grid-cols-2">{modes.map(([label, mode]) => <div key={`${label}-${mode.tested_at}`} className="rounded-md border p-4" style={{ borderColor: "var(--border)" }}><div className="flex items-center justify-between"><span className="text-sm font-medium">{label}</span><Score value={mode.score} /></div><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs"><Metric label="LCP" value={formatNumber(mode.metrics.lcp_ms, " ms")} /><Metric label="INP" value={formatNumber(mode.metrics.inp_ms, " ms")} /><Metric label="TBT" value={formatNumber(mode.metrics.tbt_ms, " ms")} /><Metric label="CLS" value={formatNumber(mode.metrics.cls)} /></dl><p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>測試於 {formatDate(mode.tested_at)}</p></div>)}</div>{modes.length === 0 && <EmptyState title="尚無效能結果" detail="先執行公開 PSI 或等待 authenticated performance workflow 回報。" />}<section className="rounded-md border p-5" style={{ borderColor: "var(--border)" }}><h2 className="font-semibold">CrUX 近 28 天</h2>{data.crux.error ? <p className="mt-3 text-sm" style={{ color: "var(--error)" }}>資料讀取失敗：{data.crux.error}</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="LCP p75" value={formatNumber(data.crux.lcp_p75?.at(-1), " ms")} /><Metric label="INP p75" value={formatNumber(data.crux.inp_p75?.at(-1), " ms")} /><Metric label="CLS p75" value={formatNumber(data.crux.cls_p75?.at(-1))} /><Metric label="TTFB p75" value={formatNumber(data.crux.ttfb_p75?.at(-1), " ms")} /></div>}</section></div>;
}

function ReleasesPanel({ data }: { data: Release[] }) {
  return <section className="space-y-3"><div><h2 className="text-base font-semibold">部署版本</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>每次採集會關聯部署 commit，方便定位分數回退。</p></div>{data.length === 0 ? <EmptyState title="尚無部署紀錄" detail="完成一次部署或建立 release 後會顯示於此。" /> : <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b" style={{ borderColor: "var(--border)" }}><th className="px-4 py-3">版本</th><th className="px-4 py-3">環境</th><th className="px-4 py-3">部署時間</th></tr></thead><tbody>{data.map((item) => <tr key={`${item.release}-${item.deployed_at}`} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}><td className="px-4 py-3"><div className="font-medium">{item.release}</div><div className="mt-1 font-mono text-xs" style={{ color: "var(--text-muted)" }}>{item.commit_sha}</div></td><td className="px-4 py-3">{item.environment}</td><td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{formatDate(item.deployed_at)}</td></tr>)}</tbody></table></div>}</section>;
}

function SummaryMetric({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone?: string }) {
  return <div className="rounded-md border p-4" style={{ borderColor: "var(--border)" }}><div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div><div className="mt-2 text-2xl font-semibold" style={{ color: tone ?? "var(--text-primary)" }}>{value}</div><div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{detail}</div></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt style={{ color: "var(--text-muted)" }}>{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>;
}

function DataList<T>({ title, empty, items, render }: { title: string; empty: string; items: T[]; render: (item: T) => ReactNode }) {
  return <section className="space-y-3"><h2 className="text-base font-semibold">{title}</h2>{items.length === 0 ? <EmptyState title={empty} detail="服務目前沒有回報可顯示的項目。" /> : <div className="divide-y rounded-md border" style={{ borderColor: "var(--border)" }}>{items.map((item, index) => <div key={index} className="p-4">{render(item)}</div>)}</div>}</section>;
}

function LoadingState() {
  return <div className="space-y-4" aria-label="載入中"><div className="h-24 animate-pulse rounded-md" style={{ background: "var(--bg-surface)" }} /><div className="h-48 animate-pulse rounded-md" style={{ background: "var(--bg-surface)" }} /></div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-md border p-8 text-center" style={{ borderColor: "var(--border)" }}><h2 className="font-medium">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: "var(--text-muted)" }}>{detail}</p></div>;
}

function InlineError({ message }: { message: string }) {
  return <div role="alert" className="rounded-md border p-4 text-sm" style={{ borderColor: "var(--danger-border)", background: "var(--danger-dim)", color: "var(--error)" }}>{message}</div>;
}
