"use client";
import { useState, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { regulationsApi, regulationHref } from "@/lib/api";
import { useFetch } from "@/hooks/useFetch";
import type {
  RegulationArticleOut,
  RegulationCategory,
  RegulationListItem,
  RegulationSearchResult,
  RegulationWorkflowStatus,
} from "@/lib/types";
import { RegulationCategoryBadge } from "@/components/ui/StatusBadge";
import Toggle from "@/components/ui/Toggle";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import { usePermissions } from "@/hooks/usePermissions";
import { usePersistedState } from "@/hooks/usePersistedState";

const CATEGORIES: { key: RegulationCategory | "all"; label: string }[] = [
  { key: "all",                label: "全部" },
  { key: "constitution",       label: "憲章" },
  { key: "ordinance",          label: "條例" },
  { key: "procedure",          label: "辦法" },
];

const WORKFLOW_FILTERS: { key: RegulationWorkflowStatus | "all"; label: string }[] = [
  { key: "all", label: "全部狀態" },
  { key: "under_review", label: "送審中" },
  { key: "scheduled", label: "排入議程" },
  { key: "council_approved", label: "待公布" },
  { key: "draft", label: "草稿" },
  { key: "published", label: "現行" },
];

const WORKFLOW_LABEL: Record<RegulationWorkflowStatus, { label: string; color: string; bg: string }> = {
  draft:            { label: "草稿",     color: "var(--text-muted)",     bg: "var(--bg-elevated)" },
  under_review:     { label: "送審中",   color: "#0284c7",               bg: "rgba(2,132,199,0.1)" },
  scheduled:        { label: "排入議程", color: "#7c3aed",               bg: "rgba(124,58,237,0.1)" },
  council_approved: { label: "議會核定", color: "var(--warning)",        bg: "var(--warning-dim)" },
  published:        { label: "現行有效", color: "var(--success)",        bg: "var(--success-dim)" },
  rejected:         { label: "已退回",   color: "var(--danger)",         bg: "rgba(220,38,38,0.1)" },
  archived:         { label: "已廢止",   color: "var(--text-muted)",     bg: "var(--bg-elevated)" },
};

function WorkflowBadge({ status }: { status: RegulationWorkflowStatus }) {
  const s = WORKFLOW_LABEL[status] ?? WORKFLOW_LABEL.draft;
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.color}22` }}>
      {s.label}
    </span>
  );
}

// ── 搜尋命中片段高亮 ──────────────────────────────────────────────────────────

function HighlightedSnippet({
  text, keyword, max = 96,
}: {
  text: string;
  keyword: string;
  max?: number;
}) {
  if (!text) return null;
  const kw = keyword.trim().toLowerCase();
  let display = text;
  const hit = kw ? text.toLowerCase().indexOf(kw) : -1;
  if (text.length > max) {
    if (hit > 40) {
      const start = hit - 30;
      display = `…${text.slice(start, start + max)}${start + max < text.length ? "…" : ""}`;
    } else {
      display = `${text.slice(0, max)}…`;
    }
  }
  if (!kw) return <>{display}</>;
  const parts: ReactNode[] = [];
  const lower = display.toLowerCase();
  let cursor = 0;
  let markKey = 0;
  for (;;) {
    const found = lower.indexOf(kw, cursor);
    if (found < 0) {
      parts.push(display.slice(cursor));
      break;
    }
    if (found > cursor) parts.push(display.slice(cursor, found));
    parts.push(
      <mark
        key={markKey++}
        style={{ background: "var(--primary-dim)", color: "var(--primary)", borderRadius: 3, padding: "0 2px" }}
      >
        {display.slice(found, found + kw.length)}
      </mark>,
    );
    cursor = found + kw.length;
  }
  return <>{parts}</>;
}

function articleLabel(article: RegulationArticleOut): string {
  const ln = (article.legal_number ?? "").trim();
  if (ln) return `第 ${ln} 條`;
  return article.title?.trim() || article.subtitle?.trim() || "條文";
}

export default function RegulationsPage() {
  const [category, setCategory] = usePersistedState<RegulationCategory | "all">("hcca:pref:regulations:category:v1", "all");
  const [workflow, setWorkflow] = usePersistedState<RegulationWorkflowStatus | "all">("hcca:pref:regulations:workflow:v1", "all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { can } = usePermissions();

  const canManage = can("regulation:create") || can("regulation:admin");

  const [allRegs, loading] = useFetch(
    () => {
      const params: Record<string, string> = {};
      if (category !== "all") params.category = category;
      if (canManage && workflow !== "all") params.workflow_status = workflow;
      if (!showAll || !canManage) params.active_only = "true";
      return search.trim()
        ? regulationsApi.search(search.trim(), params)
        : regulationsApi.list(params);
    },
    [category, search, showAll, canManage, workflow],
    "載入失敗",
    [] as Array<RegulationListItem | RegulationSearchResult>,
  );

  const sorted = useMemo(
    () => [...allRegs].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")),
    [allRegs],
  );

  return (
    <div className="space-y-5 max-w-6xl mx-auto">

      {/* 頁首 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>法規查詢</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            瀏覽憲章、條例與辦法
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Toggle
              checked={showAll}
              onChange={setShowAll}
              label="顯示草稿"
            />
          )}
          {(can("regulation:schedule") || can("regulation:council_approve") || can("regulation:president_publish") || can("regulation:admin")) && (
            <Link href="/regulations/pending" className="btn btn-ghost">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
              </svg>
              待審案件
            </Link>
          )}
          <Link href="/regulations/archived" className="btn btn-ghost" title="查看歷史已廢止法規">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="5" rx="1" />
              <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
            廢止法規
          </Link>
          {can("regulation:create") && (
            <Link href="/regulations/new" className="btn btn-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新增法規
            </Link>
          )}
        </div>
      </div>

      {/* 搜尋 + 分類 */}
      <div className="card p-4 flex flex-col gap-3">
        <div className="relative w-full">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            style={{ color: "var(--text-muted)" }} aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋法規名稱…" className="input w-full min-w-0"
            style={{ paddingLeft: "2.75rem" }} aria-label="搜尋法規" />
        </div>
        <div className="flex w-full flex-wrap gap-1.5" role="group" aria-label="法規分類篩選">
          {CATEGORIES.map(({ key, label }) => {
            const active = category === key;
            return (
              <button key={key} aria-pressed={active}
                onClick={() => setCategory(key)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap cursor-pointer hover:opacity-80"
                style={active
                  ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                  : { color: "var(--text-muted)", border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                {label}
              </button>
            );
          })}
        </div>
        {canManage && (
          <div className="flex w-full flex-wrap gap-1.5" role="group" aria-label="法規流程狀態篩選">
            {WORKFLOW_FILTERS.map(({ key, label }) => {
              const active = workflow === key;
              return (
                <button
                  key={key}
                  aria-pressed={active}
                  onClick={() => setWorkflow(key)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap cursor-pointer hover:opacity-80"
                  style={active
                    ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                    : { color: "var(--text-muted)", border: "1px solid var(--border)", background: "var(--bg-surface)" }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 統計列 */}
      {!loading && sorted.length > 0 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          共 {sorted.length} 筆法規
        </p>
      )}

      {/* 結果 */}
      {loading ? (
        <ListPageSkeleton rows={6} showHeader={false} showFilters={false} />
      ) : sorted.length === 0 ? (
        <SmartEmptyState
          reason={search.trim() || category !== "all" || workflow !== "all" ? "filtered" : "new"}
          subject="法規"
          createHref="/regulations/new"
          createPerm="regulation:create"
          onClearFilters={() => {
            setSearch("");
            setCategory("all");
            setWorkflow("all");
          }}
        />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))" }}>
          {sorted.map((reg) => (
            <RegCard key={reg.id} reg={reg} keyword={search.trim()} />
          ))}
        </div>
      )}
    </div>
  );
}

function RegCard({
  reg, keyword,
}: {
  reg: RegulationListItem | RegulationSearchResult;
  keyword: string;
}) {
  const isArchived = !reg.is_active || reg.workflow_status === "archived";
  const matched = "matched_articles" in reg ? reg.matched_articles : [];

  return (
    <div className="card p-5 flex flex-col gap-3 reg-card-link" style={{ opacity: isArchived ? 0.6 : 1 }}>
    <Link href={regulationHref(reg)}
      className="flex flex-col gap-3 flex-1"
      style={{
        textDecoration: "none",
        transition: "box-shadow var(--transition), border-color var(--transition)",
      }}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-sm leading-snug flex-1 reg-card-title"
          style={{
            color: "var(--text-primary)",
            transition: "color var(--transition)",
            textDecoration: isArchived ? "line-through" : "none",
          }}>
          {reg.title}
        </h3>
        <RegulationCategoryBadge category={reg.category} />
      </div>
      <div className="flex items-center justify-between">
        <WorkflowBadge status={reg.workflow_status} />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>v{reg.version}</span>
      </div>
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
        {reg.published_at
          ? <span>發布 {new Date(reg.published_at).toLocaleDateString("zh-TW")}</span>
          : <span>更新 {new Date(reg.updated_at).toLocaleDateString("zh-TW")}</span>
        }
        {!isArchived ? (
          <span className="flex items-center gap-1 reg-card-cta" style={{ color: "var(--primary)" }}>
            閱讀全文
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        ) : (
          <span className="text-xs px-1.5 py-0.5 rounded"
            style={{ color: "var(--text-disabled)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            已廢止
          </span>
        )}
      </div>
    </Link>
    {/* 搜尋命中的條文 */}
    {matched.length > 0 && (
      <div
        className="space-y-1 rounded-lg p-2.5"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          命中 {matched.length} 條相關條文
        </p>
        {matched.slice(0, 4).map((article) => (
          <Link
            key={article.id}
            href={`${regulationHref(reg)}#a-${article.id}`}
            className="block rounded px-1.5 py-1 leading-snug hover:opacity-80"
          >
            <span className="text-[11px] font-medium" style={{ color: "var(--primary)" }}>
              {articleLabel(article)}
            </span>
            <span className="ml-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
              <HighlightedSnippet
                text={article.content || article.title || article.subtitle || ""}
                keyword={keyword}
              />
            </span>
          </Link>
        ))}
        {matched.length > 4 && (
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            還有 {matched.length - 4} 條…
          </p>
        )}
      </div>
    )}
    {/* 底部工具列 */}
    <div className="flex items-center justify-end gap-2 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
      <button
        onClick={async (e) => {
          e.preventDefault();
          const url = `${window.location.origin}${regulationHref(reg)}`;
          try {
            await navigator.clipboard.writeText(url);
            toast.success("連結已複製");
          } catch {
            toast.error("複製失敗");
          }
        }}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
        style={{ color: "var(--text-muted)" }}
        title="複製連結">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        複製連結
      </button>
    </div>
    </div>
  );
}
