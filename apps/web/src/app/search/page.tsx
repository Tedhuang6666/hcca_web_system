"use client";
import { useState, useEffect, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search as SearchIcon, FileText, Scale, Calendar, Megaphone } from "lucide-react";
import { searchApi, apiErrorMessage } from "@/lib/api";
import type { SearchResultOut } from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";

type Kind = "all" | "document" | "regulation" | "meeting" | "announcement";

const KIND_META: Record<Exclude<Kind, "all">, { label: string; Icon: React.ComponentType<{ size: number; "aria-hidden"?: boolean }>; color: string }> = {
  document:     { label: "公文", Icon: FileText,  color: "var(--primary)" },
  regulation:   { label: "法規", Icon: Scale,     color: "var(--warning)" },
  meeting:      { label: "會議", Icon: Calendar,  color: "var(--success)" },
  announcement: { label: "公告", Icon: Megaphone, color: "var(--info, var(--primary))" },
};

const TABS: { key: Kind; label: string }[] = [
  { key: "all",          label: "全部" },
  { key: "document",     label: "公文" },
  { key: "regulation",   label: "法規" },
  { key: "meeting",      label: "會議" },
  { key: "announcement", label: "公告" },
];

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initialQ = params.get("q") ?? "";
  const initialTab = (params.get("kind") as Kind) ?? "all";

  const [q, setQ] = useState(initialQ);
  const [activeQ, setActiveQ] = useState(initialQ);
  const [tab, setTab] = useState<Kind>(initialTab);
  const [results, setResults] = useState<SearchResultOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!activeQ.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    searchApi
      .global(activeQ.trim(), 30)
      .then(setResults)
      .catch((e) => toast.error(apiErrorMessage(e, "搜尋失敗")))
      .finally(() => setLoading(false));
  }, [activeQ]);

  // 同步 URL 以便分享 / 重新整理
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeQ) next.set("q", activeQ);
    if (tab !== "all") next.set("kind", tab);
    const qs = next.toString();
    router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
  }, [activeQ, tab, router]);

  const filtered = useMemo(
    () => (tab === "all" ? results : results.filter((r) => r.kind === tab)),
    [results, tab],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: results.length };
    for (const r of results) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [results]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          全域搜尋
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          一次搜尋公文、法規、會議與公告
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setActiveQ(q);
        }}
        className="card p-3 flex gap-2 items-center"
      >
        <SearchIcon size={16} aria-hidden style={{ color: "var(--text-muted)" }} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="輸入關鍵字…例如「會議紀錄」「人事 2026」"
          className="input flex-1"
          aria-label="全域搜尋"
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={!q.trim() || loading}>
          {loading ? "搜尋中…" : "搜尋"}
        </button>
      </form>

      {searched && (
        <nav className="module-tabs-scroll max-w-full overflow-x-auto" aria-label="搜尋分類">
          <div className="module-tabs-list" role="tablist">
            {TABS.map(({ key, label }) => {
              const active = tab === key;
              const count = counts[key] ?? 0;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(key)}
                  className={`module-tab-link cursor-pointer${active ? " is-active" : ""}`}
                >
                  <span>{label}</span>
                  {count > 0 && <span className="text-xs opacity-70">({count})</span>}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <div key={tab} className="tab-panel-transition">
        {loading ? (
          <ListPageSkeleton rows={5} showHeader={false} showFilters={false} />
        ) : !searched ? (
          <div className="py-16 text-center" style={{ color: "var(--text-muted)" }}>
            <SearchIcon size={36} aria-hidden style={{ color: "var(--text-disabled)" }} className="mx-auto mb-3" />
            <p className="text-sm">輸入關鍵字開始搜尋</p>
          </div>
        ) : filtered.length === 0 ? (
          <SmartEmptyState
            reason="filtered"
            subject="結果"
            message={`找不到符合「${activeQ}」的${tab === "all" ? "" : KIND_META[tab as Exclude<Kind, "all">].label}結果，試試其他關鍵字`}
            onClearFilters={() => setTab("all")}
          />
        ) : (
          <ul className="space-y-2 list-none p-0 m-0">
            {filtered.map((r) => {
              const meta = KIND_META[r.kind as Exclude<Kind, "all">];
              const Icon = meta?.Icon ?? FileText;
              const color = meta?.color ?? "var(--text-muted)";
              return (
                <li key={`${r.kind}-${r.id}`}>
                  <Link
                    href={r.href}
                    className="card card-hover flex items-start gap-3 p-4"
                    style={{ textDecoration: "none" }}
                  >
                    <span
                      className="flex-shrink-0 rounded-lg p-2"
                      style={{ background: "var(--bg-elevated)", color }}
                    >
                      <Icon size={16} aria-hidden />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                          {r.title}
                        </h3>
                        {meta && (
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ color, background: `${color}15`, border: `1px solid ${color}33` }}
                          >
                            {meta.label}
                          </span>
                        )}
                      </div>
                      {r.summary && (
                        <p
                          className="text-xs mt-1 line-clamp-2"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {r.summary}
                        </p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<ListPageSkeleton rows={5} />}>
      <SearchInner />
    </Suspense>
  );
}
