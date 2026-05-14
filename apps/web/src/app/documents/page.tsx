"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { documentsApi, orgsApi, savedFiltersApi, usersApi, ApiError } from "@/lib/api";
import type { OrgRead, UserSummary } from "@/lib/api";
import type { BatchDocumentOperationOut, DocumentListItem, DocumentStatus, SavedFilterOut } from "@/lib/types";
import { DocumentStatusBadge, UrgencyBadge } from "@/components/ui/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";

const TABS: { key: DocumentStatus | "all"; label: string }[] = [
  { key: "all",      label: "全部" },
  { key: "draft",    label: "草稿" },
  { key: "pending",  label: "待審核" },
  { key: "approved", label: "已核准" },
  { key: "rejected", label: "已退件" },
  { key: "archived", label: "已封存" },
];

const DOC_CATEGORIES: { key: string; label: string }[] = [
  { key: "letter",        label: "函" },
  { key: "decree",        label: "令" },
  { key: "announcement",  label: "公告" },
  { key: "report",        label: "報告" },
  { key: "meeting_notice", label: "開會通知" },
  { key: "other",         label: "其他" },
];

const DOC_CLASSIFICATIONS: { key: string; label: string }[] = [
  { key: "normal", label: "普通" },
  { key: "confidential", label: "密" },
  { key: "secret", label: "機密" },
];

const DOC_VISIBILITIES: { key: string; label: string }[] = [
  { key: "subject_only", label: "僅當事人" },
  { key: "org_only", label: "機關成員" },
  { key: "public", label: "登入可見" },
  { key: "publicly_open", label: "公開" },
];

type SortKey = "created_desc" | "created_asc" | "title_asc" | "due_asc" | "urgency_desc";

const URGENCY_ORDER: Record<string, number> = { express: 2, priority: 1, normal: 0 };

function dueDateUrgency(dateStr: string | null): "overdue" | "soon" | "ok" | null {
  if (!dateStr) return null;
  const diff = (new Date(dateStr).getTime() - Date.now()) / 86400000;
  if (diff < 0)  return "overdue";
  if (diff <= 3) return "soon";
  return "ok";
}

function SortTh({
  label,
  sk,
  sortKey,
  onToggle,
}: {
  label: string;
  sk: SortKey;
  sortKey: SortKey;
  onToggle: (sk: SortKey) => void;
}) {
  const active = sortKey === sk;
  return (
    <th
      className="px-5 py-3.5 text-left text-xs font-semibold cursor-pointer select-none"
      style={{ color: active ? "var(--primary)" : "var(--text-muted)" }}
      scope="col"
      onClick={() => onToggle(sk)}
      aria-sort={active ? "ascending" : "none"}>
      {label} {active ? "↑" : ""}
    </th>
  );
}

export default function DocumentListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status") as DocumentStatus | null;

  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DocumentStatus | "all">(
    initialStatus && TABS.some(t => t.key === initialStatus) ? initialStatus : "all"
  );
  const [search, setSearch] = useState(searchParams.get("keyword") ?? "");
  const [sortKey, setSortKey] = useState<SortKey>("created_desc");
  const [showFilters, setShowFilters] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>(searchParams.get("category") ?? "");
  const [filterClassification, setFilterClassification] = useState<string>(
    searchParams.get("classification") ?? ""
  );
  const [filterVisibility, setFilterVisibility] = useState<string>(searchParams.get("visibility") ?? "");
  const [filterDateFrom, setFilterDateFrom] = useState(searchParams.get("date_from") ?? "");
  const [filterDateTo, setFilterDateTo] = useState(searchParams.get("date_to") ?? "");
  const [filterIssuedFrom, setFilterIssuedFrom] = useState(searchParams.get("issued_from") ?? "");
  const [filterIssuedTo, setFilterIssuedTo] = useState(searchParams.get("issued_to") ?? "");
  const [filterRocYear, setFilterRocYear] = useState(searchParams.get("roc_year") ?? "");
  const [filterSerialPrefix, setFilterSerialPrefix] = useState(searchParams.get("serial_prefix") ?? "");
  const [filterHandlerKeyword, setFilterHandlerKeyword] = useState(searchParams.get("handler_keyword") ?? "");
  const [filterRecipientKeyword, setFilterRecipientKeyword] = useState(searchParams.get("recipient_keyword") ?? "");
  const [filterMyOnly, setFilterMyOnly] = useState(searchParams.get("my_only") === "true");
  const [filterOrgId, setFilterOrgId] = useState(searchParams.get("org_id") ?? "");
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [savedFilters, setSavedFilters] = useState<SavedFilterOut[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [delegateQuery, setDelegateQuery] = useState("");
  const [delegateId, setDelegateId] = useState<string | null>(null);
  const [delegateSuggestions, setDelegateSuggestions] = useState<UserSummary[]>([]);
  const PAGE_SIZE = 20;
  const { can } = usePermissions();

  const hasActiveFilters = Boolean(
    filterCategory || filterClassification || filterVisibility ||
    filterDateFrom || filterDateTo ||
    filterIssuedFrom || filterIssuedTo ||
    filterRocYear || filterSerialPrefix || filterHandlerKeyword || filterRecipientKeyword ||
    filterMyOnly || filterOrgId
  );

  useEffect(() => {
    const userId = typeof window !== "undefined" ? localStorage.getItem("user_id") : null;
    setIsLoggedIn(!!userId);

    const loadInitialData = async () => {
      try {
        const [orgsRes, savedFiltersRes] = await Promise.all([
          orgsApi.list(),
          userId ? savedFiltersApi.list("documents") : Promise.resolve([]),
        ]);
        setOrgs(orgsRes);
        setSavedFilters(savedFiltersRes);
      } catch {
        // API errors handled silently; defaults used
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    const q = new URLSearchParams();
    if (activeTab !== "all") q.set("status", activeTab);
    if (search.trim()) q.set("keyword", search.trim());
    if (filterCategory) q.set("category", filterCategory);
    if (filterClassification) q.set("classification", filterClassification);
    if (filterVisibility) q.set("visibility", filterVisibility);
    if (filterDateFrom) q.set("date_from", filterDateFrom);
    if (filterDateTo) q.set("date_to", filterDateTo);
    if (filterIssuedFrom) q.set("issued_from", filterIssuedFrom);
    if (filterIssuedTo) q.set("issued_to", filterIssuedTo);
    if (filterRocYear) q.set("roc_year", filterRocYear);
    if (filterSerialPrefix) q.set("serial_prefix", filterSerialPrefix);
    if (filterHandlerKeyword) q.set("handler_keyword", filterHandlerKeyword);
    if (filterRecipientKeyword) q.set("recipient_keyword", filterRecipientKeyword);
    if (filterMyOnly) q.set("my_only", "true");
    if (filterOrgId) q.set("org_id", filterOrgId);
    const next = q.toString() ? `/documents?${q}` : "/documents";
    router.replace(next, { scroll: false });
  }, [
    activeTab, search, filterCategory, filterClassification, filterVisibility,
    filterDateFrom, filterDateTo,
    filterIssuedFrom, filterIssuedTo, filterRocYear,
    filterSerialPrefix, filterHandlerKeyword, filterRecipientKeyword,
    filterMyOnly, filterOrgId, router,
  ]);

  useEffect(() => {
    const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: "0" };
    if (activeTab !== "all") params.status = activeTab;
    if (search.trim()) params.keyword = search.trim();
    if (filterCategory) params.category = filterCategory;
    if (filterClassification) params.classification = filterClassification;
    if (filterVisibility) params.visibility = filterVisibility;
    if (filterDateFrom) params.date_from = filterDateFrom;
    if (filterDateTo) params.date_to = filterDateTo;
    if (filterIssuedFrom) params.issued_from = filterIssuedFrom;
    if (filterIssuedTo) params.issued_to = filterIssuedTo;
    if (filterRocYear) params.roc_year = filterRocYear;
    if (filterSerialPrefix) params.serial_prefix = filterSerialPrefix;
    if (filterHandlerKeyword) params.handler_keyword = filterHandlerKeyword;
    if (filterRecipientKeyword) params.recipient_keyword = filterRecipientKeyword;
    if (filterMyOnly) params.my_only = "true";
    if (filterOrgId) params.org_id = filterOrgId;

    setLoading(true);
    setOffset(0);
    documentsApi
      .list(params)
      .then(data => {
        setDocs(data);
        setHasMore(data.length === PAGE_SIZE);
        setSelectedIds(new Set());
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [
    activeTab, search, filterCategory, filterClassification, filterVisibility,
    filterDateFrom, filterDateTo,
    filterIssuedFrom, filterIssuedTo, filterRocYear,
    filterSerialPrefix, filterHandlerKeyword, filterRecipientKeyword,
    filterMyOnly, filterOrgId,
  ]);

  const clearFilters = () => {
    setFilterCategory("");
    setFilterClassification("");
    setFilterVisibility("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterIssuedFrom("");
    setFilterIssuedTo("");
    setFilterRocYear("");
    setFilterSerialPrefix("");
    setFilterHandlerKeyword("");
    setFilterRecipientKeyword("");
    setFilterMyOnly(false);
    setFilterOrgId("");
  };

  const applySavedFilter = (sf: SavedFilterOut) => {
    const p = (sf.params ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
    setActiveTab((s("status") as DocumentStatus) || "all");
    setSearch(s("keyword"));
    setFilterCategory(s("category"));
    setFilterClassification(s("classification"));
    setFilterVisibility(s("visibility"));
    setFilterDateFrom(s("date_from"));
    setFilterDateTo(s("date_to"));
    setFilterIssuedFrom(s("issued_from"));
    setFilterIssuedTo(s("issued_to"));
    setFilterRocYear(s("roc_year"));
    setFilterSerialPrefix(s("serial_prefix"));
    setFilterHandlerKeyword(s("handler_keyword"));
    setFilterRecipientKeyword(s("recipient_keyword"));
    setFilterMyOnly(s("my_only") === "true");
    setFilterOrgId(s("org_id"));
    setShowFilters(true);
  };

  const saveCurrentFilter = async () => {
    const name = prompt("請輸入常用篩選名稱：", "我的公文查詢");
    if (!name?.trim()) return;
    const params: Record<string, unknown> = {};
    if (activeTab !== "all") params.status = activeTab;
    if (search.trim()) params.keyword = search.trim();
    if (filterCategory) params.category = filterCategory;
    if (filterClassification) params.classification = filterClassification;
    if (filterVisibility) params.visibility = filterVisibility;
    if (filterDateFrom) params.date_from = filterDateFrom;
    if (filterDateTo) params.date_to = filterDateTo;
    if (filterIssuedFrom) params.issued_from = filterIssuedFrom;
    if (filterIssuedTo) params.issued_to = filterIssuedTo;
    if (filterRocYear) params.roc_year = filterRocYear;
    if (filterSerialPrefix) params.serial_prefix = filterSerialPrefix;
    if (filterHandlerKeyword) params.handler_keyword = filterHandlerKeyword;
    if (filterRecipientKeyword) params.recipient_keyword = filterRecipientKeyword;
    if (filterMyOnly) params.my_only = "true";
    if (filterOrgId) params.org_id = filterOrgId;
    const share_path = (() => {
      const q = new URLSearchParams(params as Record<string, string>);
      return q.toString() ? `/documents?${q.toString()}` : "/documents";
    })();
    try {
      const created = await savedFiltersApi.create({ scope: "documents", name: name.trim(), params, share_path });
      setSavedFilters(prev => [created, ...prev]);
      toast.success("已儲存常用篩選");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存失敗");
    }
  };

  const deleteSavedFilter = async (id: string) => {
    if (!confirm("刪除此常用篩選？")) return;
    try {
      await savedFiltersApi.delete(id);
      setSavedFilters(prev => prev.filter(x => x.id !== id));
      toast.success("已刪除");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "刪除失敗");
    }
  };

  const loadMore = async () => {
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(nextOffset) };
      if (activeTab !== "all") params.status = activeTab;
      if (search.trim()) params.keyword = search.trim();
      if (filterCategory) params.category = filterCategory;
      if (filterClassification) params.classification = filterClassification;
      if (filterVisibility) params.visibility = filterVisibility;
      if (filterDateFrom) params.date_from = filterDateFrom;
      if (filterDateTo) params.date_to = filterDateTo;
      if (filterIssuedFrom) params.issued_from = filterIssuedFrom;
      if (filterIssuedTo) params.issued_to = filterIssuedTo;
      if (filterRocYear) params.roc_year = filterRocYear;
      if (filterSerialPrefix) params.serial_prefix = filterSerialPrefix;
      if (filterHandlerKeyword) params.handler_keyword = filterHandlerKeyword;
      if (filterRecipientKeyword) params.recipient_keyword = filterRecipientKeyword;
      if (filterMyOnly) params.my_only = "true";
      if (filterOrgId) params.org_id = filterOrgId;
      const more = await documentsApi.list(params);
      setDocs(prev => [...prev, ...more]);
      setOffset(nextOffset);
      setHasMore(more.length === PAGE_SIZE);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入失敗");
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredDocs = docs;

  const sorted = [...filteredDocs].sort((a, b) => {
    switch (sortKey) {
      case "created_asc": return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case "title_asc":   return a.title.localeCompare(b.title, "zh-TW");
      case "due_asc": {
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return da - db;
      }
      case "urgency_desc":
        return (URGENCY_ORDER[b.urgency] ?? 0) - (URGENCY_ORDER[a.urgency] ?? 0);
      default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
  });

  const selectedList = sorted.filter((doc) => selectedIds.has(doc.id));
  const selectedArray = selectedList.map((doc) => doc.id);
  const allVisibleSelected = sorted.length > 0 && sorted.every((doc) => selectedIds.has(doc.id));

  const summarizeBatch = (result: BatchDocumentOperationOut) => {
    const failed = result.results.filter((item) => !item.ok);
    if (result.succeeded > 0) {
      toast.success(`完成 ${result.succeeded} 筆，失敗 ${result.failed} 筆`);
    } else {
      toast.error("批量操作未完成任何公文");
    }
    if (failed.length > 0) {
      console.table(failed.map((item) => ({
        serial: item.serial_number,
        title: item.title,
        reason: item.detail,
      })));
    }
  };

  const reloadCurrent = async () => {
    const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: "0" };
    if (activeTab !== "all") params.status = activeTab;
    if (search.trim()) params.keyword = search.trim();
    if (filterCategory) params.category = filterCategory;
    if (filterClassification) params.classification = filterClassification;
    if (filterVisibility) params.visibility = filterVisibility;
    if (filterDateFrom) params.date_from = filterDateFrom;
    if (filterDateTo) params.date_to = filterDateTo;
    if (filterIssuedFrom) params.issued_from = filterIssuedFrom;
    if (filterIssuedTo) params.issued_to = filterIssuedTo;
    if (filterRocYear) params.roc_year = filterRocYear;
    if (filterSerialPrefix) params.serial_prefix = filterSerialPrefix;
    if (filterHandlerKeyword) params.handler_keyword = filterHandlerKeyword;
    if (filterRecipientKeyword) params.recipient_keyword = filterRecipientKeyword;
    if (filterMyOnly) params.my_only = "true";
    if (filterOrgId) params.org_id = filterOrgId;
    const data = await documentsApi.list(params);
    setDocs(data);
    setOffset(0);
    setHasMore(data.length === PAGE_SIZE);
    setSelectedIds(new Set());
  };

  const runBatch = async (action: "approve" | "reject" | "archive" | "delegate") => {
    if (selectedArray.length === 0) return;
    setBatchBusy(true);
    try {
      let result: BatchDocumentOperationOut;
      if (action === "approve") {
        const comment = prompt("批量核准意見（可留空）：", "") ?? undefined;
        result = await documentsApi.batchApprove(selectedArray, comment);
      } else if (action === "reject") {
        const comment = prompt("請輸入批量退件原因：", "");
        if (!comment?.trim()) return;
        result = await documentsApi.batchReject(selectedArray, comment.trim());
      } else if (action === "archive") {
        if (!confirm(`封存 ${selectedArray.length} 份已核准公文？`)) return;
        result = await documentsApi.batchArchive(selectedArray);
      } else {
        if (!delegateId) {
          toast.error("請先選擇代理人");
          return;
        }
        result = await documentsApi.batchDelegate(selectedArray, delegateId);
      }
      summarizeBatch(result);
      await reloadCurrent();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "批量操作失敗");
    } finally {
      setBatchBusy(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        sorted.forEach((doc) => next.delete(doc.id));
      } else {
        sorted.forEach((doc) => next.add(doc.id));
      }
      return next;
    });
  };

  const searchDelegate = async (q: string) => {
    setDelegateQuery(q);
    setDelegateId(null);
    if (!q.trim()) {
      setDelegateSuggestions([]);
      return;
    }
    try {
      setDelegateSuggestions((await usersApi.listForSearch(q)).slice(0, 5));
    } catch {
      setDelegateSuggestions([]);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto">

      {/* 頁首 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            公文系統
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            管理所有公文的建立、送審與追蹤
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {isLoggedIn && (
            <Link href="/documents/delegations" className="btn btn-ghost">
              簽核代理
            </Link>
          )}
          {can("document:create") && (
            <Link href="/document-templates" className="btn btn-ghost">
              公文範本
            </Link>
          )}
          {can("document:create") && (
            <Link href="/documents/new" className="btn btn-primary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新增公文
            </Link>
          )}
        </div>
      </div>

      {/* 搜尋 + Tab 篩選 */}
      <div className="flex flex-col gap-3">
        {/* 常用篩選 */}
        {savedFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>常用篩選：</span>
            {savedFilters.slice(0, 8).map(sf => (
              <button
                key={sf.id}
                onClick={() => applySavedFilter(sf)}
                className="text-xs px-2.5 py-1 rounded-full hover:opacity-80 inline-flex items-center gap-1.5"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)", background: "var(--bg-surface)" }}
                title={sf.description ?? sf.share_path ?? sf.name}
              >
                {sf.name}
                <span
                  onClick={(e) => { e.stopPropagation(); deleteSavedFilter(sf.id); }}
                  className="px-1 rounded"
                  style={{ color: "var(--danger)" }}
                  aria-label="刪除常用篩選"
                >
                  ×
                </span>
              </button>
            ))}
            <button
              onClick={saveCurrentFilter}
              className="text-xs px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}
            >
              ＋ 儲存目前查詢
            </button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          {/* 搜尋框 */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              style={{ color: "var(--text-muted)" }} aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜尋公文標題或字號…" className="input pl-9 w-64" aria-label="搜尋公文" />
          </div>

          {/* Tab 切換 */}
          <div className="flex gap-0.5 p-1 rounded-xl overflow-x-auto"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
            role="tablist" aria-label="公文狀態篩選">
            {TABS.map(({ key, label }) => {
              const active = activeTab === key;
              return (
                <button key={key} role="tab" aria-selected={active}
                  onClick={() => setActiveTab(key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
                  style={active
                    ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--primary-dim)" }
                    : { color: "var(--text-muted)", border: "1px solid transparent" }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* 進階篩選開關 */}
          <button onClick={() => setShowFilters(f => !f)}
            className="relative px-3 py-1.5 rounded-lg text-xs font-medium transition-all inline-flex items-center gap-1.5 hover:opacity-80"
            style={showFilters || hasActiveFilters
              ? { color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }
              : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            進階篩選
            {hasActiveFilters && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                style={{ background: "var(--primary)" }} />
            )}
          </button>

          {hasActiveFilters && (
            <button onClick={clearFilters}
              className="text-xs px-2.5 py-1.5 rounded-lg hover:opacity-80"
              style={{ color: "var(--danger)", border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.06)" }}>
              清除篩選
            </button>
          )}

          {savedFilters.length === 0 && (
            <button
              onClick={saveCurrentFilter}
              className="text-xs px-3 py-1.5 rounded-lg hover:opacity-80"
              style={{ color: "var(--primary)", background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }}
              title="將目前的 Tab/搜尋/篩選保存為常用篩選"
            >
              ＋ 儲存目前查詢
            </button>
          )}
        </div>

        {/* 進階篩選面板 */}
        {showFilters && (
          <div className="card p-4 space-y-4">
            <div className="flex flex-wrap gap-5">
              {/* 字號前綴 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>字號前綴</p>
                <input
                  value={filterSerialPrefix}
                  onChange={e => setFilterSerialPrefix(e.target.value)}
                  placeholder="例：嶺代生字第"
                  className="text-xs px-2 py-1.5 rounded-lg outline-none w-56"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>

              {/* 類別 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>公文類別</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setFilterCategory("")}
                    className="text-xs px-2.5 py-1 rounded-full transition-all"
                    style={!filterCategory
                      ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                      : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    全部
                  </button>
                  {DOC_CATEGORIES.map(c => (
                    <button key={c.key} onClick={() => setFilterCategory(c.key === filterCategory ? "" : c.key)}
                      className="text-xs px-2.5 py-1 rounded-full transition-all"
                      style={filterCategory === c.key
                        ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                        : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 密等 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>密等</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setFilterClassification("")}
                    className="text-xs px-2.5 py-1 rounded-full transition-all"
                    style={!filterClassification
                      ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                      : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    全部
                  </button>
                  {DOC_CLASSIFICATIONS.map(c => (
                    <button key={c.key} onClick={() => setFilterClassification(c.key === filterClassification ? "" : c.key)}
                      className="text-xs px-2.5 py-1 rounded-full transition-all"
                      style={filterClassification === c.key
                        ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                        : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 可見度 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>可見度</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setFilterVisibility("")}
                    className="text-xs px-2.5 py-1 rounded-full transition-all"
                    style={!filterVisibility
                      ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                      : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    全部
                  </button>
                  {DOC_VISIBILITIES.map(v => (
                    <button key={v.key} onClick={() => setFilterVisibility(v.key === filterVisibility ? "" : v.key)}
                      className="text-xs px-2.5 py-1 rounded-full transition-all"
                      style={filterVisibility === v.key
                        ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                        : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 日期範圍 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>建立日期</p>
                <div className="flex items-center gap-2">
                  <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>至</span>
                  <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                </div>
              </div>

              {/* 發文日期範圍 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>發文日期</p>
                <div className="flex items-center gap-2">
                  <input type="date" value={filterIssuedFrom} onChange={e => setFilterIssuedFrom(e.target.value)}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>至</span>
                  <input type="date" value={filterIssuedTo} onChange={e => setFilterIssuedTo(e.target.value)}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                </div>
              </div>

              {/* 民國年（發文） */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>民國年（發文）</p>
                <input
                  inputMode="numeric"
                  value={filterRocYear}
                  onChange={e => setFilterRocYear(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  placeholder="例：115"
                  className="text-xs px-2 py-1.5 rounded-lg outline-none w-28"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>

              {/* 受文者 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>受文者</p>
                <input
                  value={filterRecipientKeyword}
                  onChange={e => setFilterRecipientKeyword(e.target.value)}
                  placeholder="搜尋受文者名稱"
                  className="text-xs px-2 py-1.5 rounded-lg outline-none w-56"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>

              {/* 承辦人 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>承辦人/單位</p>
                <input
                  value={filterHandlerKeyword}
                  onChange={e => setFilterHandlerKeyword(e.target.value)}
                  placeholder="姓名/單位/Email"
                  className="text-xs px-2 py-1.5 rounded-lg outline-none w-56"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                />
              </div>

              {/* 組織篩選 */}
              {orgs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>發文組織</p>
                  <select
                    value={filterOrgId}
                    onChange={e => setFilterOrgId(e.target.value)}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                    <option value="">全部組織</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              )}

              {/* 僅顯示我的 */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>其他</p>
                <button onClick={() => setFilterMyOnly(m => !m)}
                  className="text-xs px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-all"
                  style={filterMyOnly
                    ? { background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }
                    : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                  <span className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${filterMyOnly ? "bg-primary border-primary" : "border-muted"}`}
                    style={filterMyOnly ? { background: "var(--primary)", borderColor: "var(--primary)" } : { borderColor: "var(--border-strong)" }}>
                    {filterMyOnly && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                  </span>
                  僅顯示我的公文
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedArray.length > 0 && (
        <div className="card p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                已選取 {selectedArray.length} 筆
              </span>
              <button
                className="btn btn-ghost text-xs"
                onClick={() => setSelectedIds(new Set())}
                disabled={batchBusy}>
                清除選取
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {can("document:approve") && (
                <button
                  className="btn btn-primary text-xs"
                  disabled={batchBusy}
                  onClick={() => runBatch("approve")}>
                  批量核准
                </button>
              )}
              {can("document:reject") && (
                <button
                  className="btn btn-danger text-xs"
                  disabled={batchBusy}
                  onClick={() => runBatch("reject")}>
                  批量退件
                </button>
              )}
              {can("document:archive") && (
                <button
                  className="btn btn-ghost text-xs"
                  disabled={batchBusy}
                  onClick={() => runBatch("archive")}>
                  批量封存
                </button>
              )}
              {can("document:forward") && (
                <div className="relative flex flex-wrap items-center gap-2">
                  <input
                    value={delegateQuery}
                    onChange={(e) => void searchDelegate(e.target.value)}
                    placeholder="搜尋代理人"
                    className="input h-9 w-40 text-xs"
                    disabled={batchBusy}
                  />
                  <button
                    className="btn btn-ghost text-xs"
                    disabled={batchBusy || !delegateId}
                    onClick={() => runBatch("delegate")}>
                    批量轉代理
                  </button>
                  {delegateSuggestions.length > 0 && !delegateId && (
                    <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg shadow-lg"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                      {delegateSuggestions.map((user) => (
                        <button
                          key={user.id}
                          className="block w-full px-3 py-2 text-left text-xs hover:opacity-80"
                          onClick={() => {
                            setDelegateId(user.id);
                            setDelegateQuery(`${user.display_name} <${user.email}>`);
                            setDelegateSuggestions([]);
                          }}>
                          <span className="block font-medium" style={{ color: "var(--text-primary)" }}>
                            {user.display_name}
                          </span>
                          <span style={{ color: "var(--text-muted)" }}>{user.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 統計列 */}
      {!loading && (
        <div className="flex items-center gap-3">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            共 <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{sorted.length}</span> 筆公文符合查詢條件
          </p>
        </div>
      )}

      {/* 表格卡片 */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
            <div
              className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
              style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }}
              role="status" aria-label="載入中"
            />
            <p className="text-sm">載入中…</p>
          </div>
        ) : docs.length === 0 ? (
          <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5" className="mx-auto mb-3 opacity-40" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p className="text-sm">
              {search ? `找不到「${search}」相關公文` : "尚無公文記錄"}
            </p>
          </div>
        ) : (
          /* 桌機版表格 / 手機版卡片列表 */
          <>
            {/* 桌機表格（md 以上顯示） */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm" role="table" aria-label="公文列表">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-hover)" }}>
                    <th className="px-5 py-3.5 text-left" scope="col">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        aria-label="選取目前列表所有公文"
                        className="accent-blue-600"
                      />
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }} scope="col">字號</th>
                    <SortTh label="標題" sk="title_asc" sortKey={sortKey} onToggle={(sk) => setSortKey(p => p === sk ? "created_desc" : sk)} />
                    <SortTh label="速別" sk="urgency_desc" sortKey={sortKey} onToggle={(sk) => setSortKey(p => p === sk ? "created_desc" : sk)} />
                    <th className="px-5 py-3.5 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }} scope="col">狀態</th>
                    <SortTh label="建立日期" sk="created_desc" sortKey={sortKey} onToggle={(sk) => setSortKey(p => p === sk ? "created_desc" : sk)} />
                    <SortTh label="限辦日期" sk="due_asc" sortKey={sortKey} onToggle={(sk) => setSortKey(p => p === sk ? "created_desc" : sk)} />
                    <th className="px-5 py-3.5 text-left text-xs font-semibold" style={{ color: "var(--text-muted)" }} scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((doc, idx) => (
                    <tr
                      key={doc.id}
                      style={idx < docs.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                      <td className="px-5 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(doc.id)}
                          onChange={() => toggleSelected(doc.id)}
                          aria-label={`選取公文 ${doc.serial_number}`}
                          className="accent-blue-600"
                        />
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs font-mono" style={{ color: "var(--primary)" }}>
                          {doc.serial_number}
                        </span>
                      </td>
                      <td className="px-5 py-4 max-w-xs">
                        <Link
                          href={`/documents/${encodeURIComponent(doc.serial_number)}`}
                          className="font-medium hover:underline transition-colors"
                          style={{ color: "var(--text-primary)" }}>
                          {doc.title}
                        </Link>
                        {doc.subject && (
                          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                            {doc.subject}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <UrgencyBadge urgency={doc.urgency} />
                      </td>
                      <td className="px-5 py-4">
                        <DocumentStatusBadge status={doc.status} />
                      </td>
                      <td className="px-5 py-4 text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                        {new Date(doc.created_at).toLocaleDateString("zh-TW")}
                      </td>
                      <td className="px-5 py-4 text-xs whitespace-nowrap">
                        {(() => {
                          const urg = dueDateUrgency(doc.due_date);
                          if (!urg || urg === "ok") return (
                            <span style={{ color: "var(--text-muted)" }}>
                              {doc.due_date ? new Date(doc.due_date).toLocaleDateString("zh-TW") : "—"}
                            </span>
                          );
                          const isOverdue = urg === "overdue";
                          return (
                            <span className="flex items-center gap-1.5 font-medium"
                              style={{ color: isOverdue ? "var(--danger)" : "#fb923c" }}>
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOverdue ? "bg-red-500" : "bg-orange-400 animate-pulse"}`} />
                              {new Date(doc.due_date!).toLocaleDateString("zh-TW")}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/documents/${encodeURIComponent(doc.serial_number)}`}
                            className="btn btn-ghost text-xs px-3 py-1.5"
                            style={{ minHeight: "auto" }}>
                            查看
                          </Link>
                          <button
                            onClick={async (e) => {
                              e.preventDefault();
                              const url = `${window.location.origin}/documents/${encodeURIComponent(doc.serial_number)}`;
                              try {
                                await navigator.clipboard.writeText(url);
                                toast.success("連結已複製");
                              } catch {
                                toast.error("複製失敗");
                              }
                            }}
                            className="p-1.5 rounded hover:opacity-80 transition-opacity"
                            style={{ color: "var(--text-muted)" }}
                            title="複製連結">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 手機卡片列表（md 以下顯示） */}
            <ul className="md:hidden divide-y" style={{ borderColor: "var(--border)" }} aria-label="公文列表">
              {sorted.map((doc) => {
                const urg = dueDateUrgency(doc.due_date);
                const isOverdue = urg === "overdue";
                const isSoon = urg === "soon";
                return (
                  <li key={doc.id}>
                    <div className="flex items-start justify-between gap-2 px-4 py-4 transition-colors"
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(doc.id)}
                      onChange={() => toggleSelected(doc.id)}
                      aria-label={`選取公文 ${doc.serial_number}`}
                      className="mt-1 flex-shrink-0 accent-blue-600"
                    />
                    <Link
                      href={`/documents/${encodeURIComponent(doc.serial_number)}`}
                      className="flex items-start justify-between gap-3 flex-1 min-w-0"
                      style={{ textDecoration: "none" }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                          {doc.title}
                        </p>
                        <p className="text-xs mt-0.5 font-mono" style={{ color: "var(--primary)" }}>
                          {doc.serial_number}
                        </p>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                          建立 {new Date(doc.created_at).toLocaleDateString("zh-TW")}
                        </p>
                        {doc.due_date && (isOverdue || isSoon) && (
                          <p className="flex items-center gap-1 text-xs mt-0.5 font-medium"
                            style={{ color: isOverdue ? "var(--danger)" : "#fb923c" }}>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOverdue ? "bg-red-500" : "bg-orange-400 animate-pulse"}`} />
                            限辦 {new Date(doc.due_date).toLocaleDateString("zh-TW")}
                            {isOverdue && " · 已逾期"}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <DocumentStatusBadge status={doc.status} />
                        <UrgencyBadge urgency={doc.urgency} />
                      </div>
                    </Link>
                    <button
                      onClick={async () => {
                        const url = `${window.location.origin}/documents/${encodeURIComponent(doc.serial_number)}`;
                        try { await navigator.clipboard.writeText(url); toast.success("連結已複製"); }
                        catch { toast.error("複製失敗"); }
                      }}
                      className="p-2 rounded flex-shrink-0 hover:opacity-80"
                      style={{ color: "var(--text-muted)" }} title="複製連結">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      </svg>
                    </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* 分頁指示與載入更多 */}
      {!loading && (sorted.length > 0 || hasMore) && (
        <div className="flex flex-col items-center gap-3 pt-6 pb-4">
          {sorted.length > 0 && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              已顯示 <span style={{ color: "var(--primary)", fontWeight: 500 }}>{sorted.length}</span> 筆
              {hasMore && " · 向下捲動或點擊按鈕載入更多"}
            </p>
          )}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="btn btn-ghost text-sm px-6"
              style={{ border: "1px solid var(--border)" }}>
              {loadingMore ? "載入中…" : "載入更多"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
