"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { surveysApi, apiErrorMessage } from "@/lib/api";
import type { SurveyListItem, SurveyStatus } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { usePersistedState } from "@/hooks/usePersistedState";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import ActivitySelect from "@/components/activities/ActivitySelect";
import type { Activity } from "@/lib/types";

const STATUS_CFG: Record<SurveyStatus, { label: string; color: string; bg: string }> = {
  draft:    { label: "草稿",    color: "var(--text-muted)", bg: "var(--bg-elevated)" },
  open:     { label: "開放中",  color: "var(--success)",    bg: "var(--success-dim)" },
  closed:   { label: "已截止",  color: "var(--warning)",    bg: "var(--warning-dim)" },
  archived: { label: "封存",    color: "var(--text-muted)", bg: "var(--bg-elevated)" },
};

const SURVEY_SORT = [
  { key: "newest", label: "最新建立" },
  { key: "oldest", label: "最早建立" },
  { key: "responses", label: "回應數多→少" },
  { key: "closing", label: "截止最近" },
];

export default function SurveysPage() {
  const [surveys, setSurveys] = useState<SurveyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = usePersistedState<"open" | "all">("hcca:pref:surveys:tab:v1", "open");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = usePersistedState<string>("hcca:pref:surveys:sort:v1", "newest");
  const [activityId, setActivityId] = usePersistedState<string>("hcca:pref:surveys:activity:v1", "");
  const [activities, setActivities] = useState<Activity[]>([]);
  const { can } = usePermissions();
  const canManage = can("survey:manage") || activities.length > 0;

  useEffect(() => {
    setLoading(true);
    const params = {
      ...(tab === "open" ? { status: "open" } : {}),
      ...(activityId ? { activity_id: activityId } : {}),
    };
    // 未登入者改用公開問卷列表（僅 is_public 且開放/已截止的問卷）
    const isLoggedIn = typeof window !== "undefined" && !!localStorage.getItem("user_id");
    const req = isLoggedIn
      ? surveysApi.list(params)
      : surveysApi.listPublic(tab === "open" ? { status: "open" } : undefined);
    req
      .then(setSurveys)
      .catch(e => toast.error(apiErrorMessage(e, "載入失敗")))
      .finally(() => setLoading(false));
  }, [activityId, tab]);

  const activityNameById = new Map(activities.map((activity) => [activity.id, activity.name]));

  const displayed = surveys
    .filter(s => !search.trim() || s.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortKey === "oldest")    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortKey === "responses") return b.response_count - a.response_count;
      if (sortKey === "closing")   return (a.closes_at ?? "9999").localeCompare(b.closes_at ?? "9999");
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); // newest
    });

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* 頁首 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>問卷系統</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>填答問卷，表達您的意見</p>
        </div>
        {canManage && (
          <Link href="/surveys/new" className="btn btn-primary self-start sm:self-auto">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新增問卷
          </Link>
        )}
      </div>

      {/* 搜尋 + 排序 + 分頁 */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
        <div className="min-w-52">
          <ActivitySelect
            value={activityId}
            onChange={setActivityId}
            label="活動"
            noneLabel="全部問卷"
            scope="all"
            onActivitiesLoaded={setActivities}
          />
        </div>
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" style={{ color: "var(--text-muted)" }} aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋問卷標題…"
            className="input w-full"
            style={{ paddingLeft: "2.25rem" }}
            aria-label="搜尋問卷" />
        </div>
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value)}
          className="input w-36 flex-shrink-0"
          aria-label="排序方式"
          style={{ cursor: "pointer" }}>
          {SURVEY_SORT.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <div className="flex gap-1 p-1 rounded-xl flex-shrink-0" style={{ background: "var(--bg-elevated)" }}>
          {(["open", "all"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
              style={tab === t
                ? { background: "var(--bg-surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-sm)" }
                : { color: "var(--text-muted)" }}>
              {t === "open" ? "開放中" : "全部"}
            </button>
          ))}
        </div>
      </div>

      {/* 問卷列表 */}
      {loading ? (
        <ListPageSkeleton rows={5} showHeader={false} showFilters={false} />
      ) : displayed.length === 0 ? (
        <SmartEmptyState
          reason={search ? "filtered" : (canManage ? "new" : "none")}
          subject="問卷"
          createHref="/surveys/new"
          createPerm={can("survey:manage") ? "survey:manage" : undefined}
          onClearFilters={() => setSearch("")}
          message={!search && tab === "open" ? "目前沒有開放填答的問卷" : undefined}
        />
      ) : (
        <div className="space-y-3">
          {displayed.map(survey => {
            const cfg = STATUS_CFG[survey.status];
            const isOpen = survey.status === "open";
            return (
              <Link
                key={survey.id}
                href={`/surveys/${encodeURIComponent(survey.title)}`}
                className="card card-hover flex items-center gap-4 px-5 py-4"
                style={{ textDecoration: "none" }}>

                {/* 狀態圓點 */}
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: cfg.color, opacity: isOpen ? 1 : 0.4 }}
                  aria-hidden="true" />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {survey.title}
                    </h3>
                    {survey.is_anonymous && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ background: "var(--info-dim)", color: "var(--info)" }}>
                        匿名
                      </span>
                    )}
                    {survey.activity_id && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                        {activityNameById.get(survey.activity_id) ?? "活動問卷"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {survey.response_count} 份回應
                    {survey.closes_at && ` · 截止 ${new Date(survey.closes_at).toLocaleDateString("zh-TW")}`}
                  </p>
                </div>

                <span
                  className="badge flex-shrink-0"
                  style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.color }}>
                  {cfg.label}
                </span>

                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 opacity-30" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
