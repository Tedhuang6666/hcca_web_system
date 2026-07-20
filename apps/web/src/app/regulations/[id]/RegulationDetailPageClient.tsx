"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FilePenLine,
  ScrollText,
  Trash2,
  Loader2,
  Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import {
  loadDrafts,
  saveDrafts,
  type Draft,
} from "@/components/regulations/AmendmentDraftParts";
import {
  ArticleRow,
  DiffModal,
  PROSE,
  RevisionCard,
  WfNoteModal,
  WorkflowStatusBadge,
  WorkflowTimeline,
  buildArticleDisplayRows,
  filenameFromContentDisposition,
  isTab,
  type Tab,
} from "@/components/regulations/RegulationDetailSections";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DetailPageLoading } from "@/components/ui/LoadingState";
import { RegulationCategoryBadge } from "@/components/ui/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";
import { usePersistedZoom } from "@/hooks/usePersistedZoom";
import { documentsApi, regulationsApi, regulationHref, apiErrorMessage } from "@/lib/api";
import { apiUrl } from "@/lib/config";
import { formatGeneratedHistoryRows, splitLegislativeHistory } from "@/lib/regulationHistory";
import { recordRecent } from "@/lib/recents";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";
import {
  LINKABLE_ARTICLE_TYPES,
  decodeRouteSegment,
  linkSegmentForArticle,
  normalizeLegalNumber,
  normalizedType,
  parseLawRef,
  type ParsedLawRef,
} from "@/lib/regulationLawRefs";
import type {
  DocumentOut,
  RegulationArticleOut,
  RegulationListItem,
  RegulationOut,
  RegulationRevisionOut,
} from "@/lib/types";

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function RegulationDetailPageClient() {
  const { id: rawId, refs: routeRefs } = useParams<{ id: string; refs?: string[] }>();
  // useParams 對非 ASCII 會回傳 URL-encoded 值（如 %E5%85%AD...）；
  // 統一 decode 後再給 API / localStorage / encodeURIComponent 使用，避免雙重編碼。
  const id = useMemo(() => decodeRouteSegment(rawId), [rawId]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [reg, setReg] = useState<RegulationOut | null>(null);
  const [loading, setLoading] = useState(true);
  const initialTab = searchParams.get("tab");
  const articleRef = searchParams.get("article_ref");
  const unitRef = searchParams.get("unit_ref");
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : "content");
  const { zoom, setZoom, zoomStyle } = usePersistedZoom("hcca.viewer.zoom");
  const [diffPair, setDiffPair] = useState<[RegulationRevisionOut, RegulationRevisionOut | null] | null>(null);

  const [wfActionLoading, setWfActionLoading] = useState(false);
  const [showFreeze, setShowFreeze] = useState(false);
  const [freezeReason, setFreezeReason] = useState("");
  const [freezeLoading, setFreezeLoading] = useState(false);
  const [wfNoteModal, setWfNoteModal] = useState<null | {
    action: string; label: string; fn: (note: string) => Promise<void>;
    hint?: string; placeholder?: string;
  }>(null);
  const [meetingPicker, setMeetingPicker] = useState<null | {
    to: "schedule" | "council"; title: string;
  }>(null);
  const [pickerMeetings, setPickerMeetings] = useState<
    { id: string; title: string; status: string; bill_stage: string | null }[]
  >([]);
  const [pickerMeetingId, setPickerMeetingId] = useState("");
  const [pickerNote, setPickerNote] = useState("");
  const [showRepeal, setShowRepeal] = useState(false);
  const [repealReason, setRepealReason] = useState("");
  const [repealReplacementId, setRepealReplacementId] = useState("");
  const [repealOptions, setRepealOptions] = useState<RegulationListItem[]>([]);
  const [repealLoading, setRepealLoading] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [tocVisible, setTocVisible] = useState(true);
  const [chapterCollapsedMap, setChapterCollapsedMap] = useState<Record<string, boolean>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [amendmentDrafts, setAmendmentDrafts] = useState<Draft[]>([]);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [highlightedArticleId, setHighlightedArticleId] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);
  const [publishedDoc, setPublishedDoc] = useState<DocumentOut | null>(null);
  const { can, isAdmin } = usePermissions();
  const currentUserId = typeof window !== "undefined" ? localStorage.getItem("user_id") ?? "" : "";
  const isAnonymous = typeof window !== "undefined" && !localStorage.getItem("user_id");
  const currentRegHref = reg ? regulationHref(reg) : `/regulations/${encodeURIComponent(id)}`;

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const reload = useCallback(() => {
    regulationsApi.get(id).then(setReg).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (reg) recordRecent({ kind: "regulation", id, title: reg.title, href: regulationHref(reg) });
  }, [reg, id]);

  useEffect(() => {
    regulationsApi.get(id)
      .then(setReg)
      .catch(e => toast.error(apiErrorMessage(e, "載入失敗")))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!reg?.published_document_id) {
      setPublishedDoc(null);
      return;
    }
    if (isAnonymous && reg.workflow_status !== "published" && reg.workflow_status !== "archived") {
      setPublishedDoc(null);
      return;
    }
    documentsApi.get(reg.published_document_id)
      .then(setPublishedDoc)
      .catch(() => setPublishedDoc(null));
  }, [reg?.published_document_id, reg?.workflow_status, isAnonymous]);

  useEffect(() => {
    if (!showRepeal || !reg) return;
    regulationsApi.list({ active_only: "true", limit: "100" })
      .then((items) => setRepealOptions(items.filter((item) => item.id !== reg.id)))
      .catch(() => setRepealOptions([]));
  }, [reg, showRepeal]);

  useEffect(() => {
    setAmendmentDrafts(loadDrafts(id));
  }, [id]);

  useEffect(() => {
    const nextTab = searchParams.get("tab");
    if (isTab(nextTab)) {
      setTab(nextTab);
    }
  }, [searchParams]);

  const handleTabChange = useCallback((nextTab: Tab) => {
    setTab(nextTab);
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    router.replace(`${currentRegHref}?tab=${nextTab}${hash}`, { scroll: false });
  }, [currentRegHref, router]);

  const runWfAction = useCallback(async (
    label: string, fn: (note: string) => Promise<void>, needNote = false,
    hint?: string, placeholder?: string,
  ) => {
    if (needNote) {
      setWfNoteModal({ action: label, label, fn, hint, placeholder });
    } else {
      setWfActionLoading(true);
      try { await fn(""); reload(); toast.success(`${label} 成功`); }
      catch (e) { toast.error(apiErrorMessage(e, "操作失敗")); }
      finally { setWfActionLoading(false); }
    }
  }, [reload]);

  // 排入議程／議會核定：強制綁定一場該法案已在議程上的會議
  const openMeetingPicker = useCallback(async (to: "schedule" | "council", title: string) => {
    setMeetingPicker({ to, title });
    setPickerMeetingId("");
    setPickerNote("");
    setPickerMeetings([]);
    try {
      setPickerMeetings(await regulationsApi.eligibleMeetings(id));
    } catch { setPickerMeetings([]); }
  }, [id]);

  const confirmMeetingPicker = useCallback(async () => {
    if (!meetingPicker || !pickerMeetingId) return;
    setWfActionLoading(true);
    try {
      const note = pickerNote || undefined;
      const updated = meetingPicker.to === "schedule"
        ? await regulationsApi.scheduleAgenda(id, note, pickerMeetingId)
        : await regulationsApi.councilApprove(id, note, pickerMeetingId);
      setReg(updated);
      toast.success(`${meetingPicker.title} 成功`);
      setMeetingPicker(null);
      reload();
    } catch (e) {
      toast.error(apiErrorMessage(e, "操作失敗"));
    } finally { setWfActionLoading(false); }
  }, [meetingPicker, pickerMeetingId, pickerNote, id, reload]);

  // 分享（navigator.share + clipboard fallback）
  const handleShare = useCallback(async () => {
    const shareData = { title: reg?.title ?? "法規", url: window.location.href };
    if (typeof navigator.share === "function") {
      try { await navigator.share(shareData); return; } catch {}
    }
    navigator.clipboard.writeText(window.location.href)
      .then(() => toast.success("連結已複製到剪貼簿"))
      .catch(() => toast.error("複製失敗"));
  }, [reg?.title]);

  // 全螢幕切換
  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // 複製連結
  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => toast.success("連結已複製"))
      .catch(() => toast.error("複製失敗"));
  }, []);

  const handleCopyArticleLink = useCallback((path: string) => {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(url)
      .then(() => toast.success("條文連結已複製"))
      .catch(() => toast.error("複製失敗"));
  }, []);

  const handleDeleteAmendmentDraft = useCallback((draftId: string) => {
    const draft = amendmentDrafts.find((item) => item.id === draftId);
    if (!draft) return;
    if (!window.confirm(`確定刪除「${draft.name}」？此操作只會刪除本機草稿。`)) return;
    const next = amendmentDrafts.filter((item) => item.id !== draftId);
    saveDrafts(id, next);
    setAmendmentDrafts(next);
    toast.success("修正案草稿已刪除");
  }, [amendmentDrafts, id]);

  // 必須 memo 化：否則每次 render 都是新陣列，會讓 articleDisplayRows 與
  // 下方 deep-link effect 無限重跑（重複點亮高亮、不斷 scrollIntoView 卡住頁面）。
  const allArticles = useMemo(() => reg?.articles ?? [], [reg]);
  const activeArticles = useMemo(
    () => (showDeleted ? allArticles : allArticles.filter((a) => !a.is_deleted)),
    [allArticles, showDeleted],
  );
  const chapterArticles = useMemo(
    () => activeArticles.filter((article) => article.article_type === "chapter"),
    [activeArticles],
  );
  const allChaptersCollapsed = chapterArticles.length > 0
    && chapterArticles.every((article) => chapterCollapsedMap[article.id]);
  /**
   * 章節目錄（TOC）：依條文順序計算 volume/chapter/section 編號，
   * 確保新增、刪除、調整層級後目錄即時同步。
   */
  const tocItems = useMemo(() => {
    const labelOf: Record<string, string> = { volume: "編", chapter: "章", section: "節" };
    const counters: Record<string, number> = { volume: 0, chapter: 0, section: 0 };
    const ordered = [...activeArticles].sort((a, b) => a.sort_index - b.sort_index);
    return ordered
      .filter((article) => article.article_type in labelOf)
      .map((article) => {
        const type = article.article_type as keyof typeof labelOf;
        // 進入新 volume 時重置 chapter 與 section；進入新 chapter 時重置 section
        if (type === "volume") {
          counters.volume += 1;
          counters.chapter = 0;
          counters.section = 0;
        } else if (type === "chapter") {
          counters.chapter += 1;
          counters.section = 0;
        } else {
          counters.section += 1;
        }
        const num = counters[type];
        const indent = type === "volume" ? 0 : type === "chapter" ? 1 : 2;
        return {
          id: article.id,
          anchor: `a-${article.id}`,
          label: `第 ${num} ${labelOf[type]} ${article.title ?? ""}`.trim(),
          indent,
        };
      });
  }, [activeArticles]);
  const articleDisplayRows = useMemo(
    () => buildArticleDisplayRows(activeArticles, chapterCollapsedMap),
    [activeArticles, chapterCollapsedMap],
  );
  const articleShareUrls = useMemo(() => {
    if (!reg) return {};
    const byId = new Map(activeArticles.map((article) => [article.id, article]));
    const rowById = new Map(articleDisplayRows.map((row) => [row.article.id, row]));
    // regulationHref 內部已用 encodeURIComponent 處理標題（含空白/#/?/% 等特殊字元）
    const basePath = regulationHref(reg);

    const chainForArticle = (article: RegulationArticleOut) => {
      const chain: RegulationArticleOut[] = [];
      let current: RegulationArticleOut | undefined = article;
      while (current) {
        chain.unshift(current);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
      return chain;
    };

    return Object.fromEntries(articleDisplayRows.map(({ article, displayLabel }) => {
      const pathSegments = chainForArticle(article)
        .filter((item) => LINKABLE_ARTICLE_TYPES.has(item.article_type))
        .map((item) => {
          const label = rowById.get(item.id)?.displayLabel ?? displayLabel;
          // 每段都編碼（中文「第3條」等），分隔的 / 保持原樣
          return encodeURIComponent(
            linkSegmentForArticle(item.article_type, item.legal_number, label),
          );
        });
      return [article.id, pathSegments.length > 0 ? `${basePath}/${pathSegments.join("/")}` : `${basePath}#a-${article.id}`];
    }));
  }, [activeArticles, articleDisplayRows, reg]);

  const deepLinkRefs = useMemo(() => {
    const refs = (routeRefs ?? []).map(decodeRouteSegment);
    for (let index = 0; index < 8; index += 1) {
      const value = searchParams.get(`ref${index}`);
      if (value) refs.push(value);
    }
    if (refs.length === 0 && articleRef) refs.push(articleRef);
    if (refs.length === 1 && unitRef) refs.push(unitRef);
    return refs;
  }, [articleRef, routeRefs, searchParams, unitRef]);

  useEffect(() => {
    setChapterCollapsedMap((prev) => {
      const next: Record<string, boolean> = {};
      for (const article of chapterArticles) {
        next[article.id] = prev[article.id] ?? false;
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length
        && prevKeys.every((key) => prev[key] === next[key])
      ) {
        return prev;
      }
      return next;
    });
  }, [chapterArticles]);

  useEffect(() => {
    if (tab !== "content" || tocItems.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveAnchorId(visible[0].target.id);
        }
      },
      {
        root: null,
        rootMargin: "-15% 0px -55% 0px",
        threshold: [0.1, 0.3, 0.6],
      },
    );

    const elements = tocItems
      .map(item => document.getElementById(item.anchor))
      .filter((el): el is HTMLElement => Boolean(el));
    elements.forEach(el => observer.observe(el));

    if (!activeAnchorId && tocItems[0]) {
      setActiveAnchorId(tocItems[0].anchor);
    }

    return () => observer.disconnect();
  }, [tab, tocItems, activeAnchorId]);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 520);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 條文高亮 5 秒後自動褪色（仍保留手動 X 清除）
  useEffect(() => {
    if (!highlightedArticleId) return;
    const timer = window.setTimeout(() => setHighlightedArticleId(null), 5000);
    return () => window.clearTimeout(timer);
  }, [highlightedArticleId]);

  useEffect(() => {
    if (!reg || tab !== "content" || deepLinkRefs.length === 0) return;
    const parsedRefs = deepLinkRefs.map(parseLawRef).filter((ref): ref is ParsedLawRef => Boolean(ref));
    const targetRef = parsedRefs[parsedRefs.length - 1];
    if (!targetRef) return;

    const articles = (reg.articles ?? []).filter((article) => !article.is_deleted);
    const byId = new Map(articles.map((article) => [article.id, article]));
    const rowById = new Map(articleDisplayRows.map((row) => [row.article.id, row]));
    const articleNumberForRef = (article: RegulationArticleOut) => {
      const legalNumber = normalizeLegalNumber(article.legal_number);
      if (legalNumber) return legalNumber;
      const displayLabel = rowById.get(article.id)?.displayLabel ?? "";
      return parseLawRef(
        linkSegmentForArticle(article.article_type, article.legal_number, displayLabel),
      )?.number ?? "";
    };
    const matchesRef = (article: RegulationArticleOut, ref: ParsedLawRef) =>
      normalizedType(article.article_type) === ref.type
      && articleNumberForRef(article) === ref.number;
    const chainForArticle = (article: RegulationArticleOut) => {
      const chain: RegulationArticleOut[] = [];
      let current: RegulationArticleOut | undefined = article;
      while (current) {
        chain.unshift(current);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
      return chain;
    };
    const chainMatchesRefs = (chain: RegulationArticleOut[], refs: ParsedLawRef[]) => {
      let cursor = 0;
      for (const ref of refs) {
        const foundIndex = chain.findIndex((article, index) => index >= cursor && matchesRef(article, ref));
        if (foundIndex < 0) return false;
        cursor = foundIndex + 1;
      }
      return true;
    };
    const candidates = articles.filter((article) => matchesRef(article, targetRef));
    const target = candidates.find((candidate) => {
      const ancestorRefs = parsedRefs.slice(0, -1);
      return ancestorRefs.length === 0 || chainMatchesRefs(chainForArticle(candidate).slice(0, -1), ancestorRefs);
    }) ?? candidates[0];
    if (!target) return;
    const targetChain = chainForArticle(target);
    setChapterCollapsedMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const ancestor of targetChain) {
        if (ancestor.article_type === "chapter" && next[ancestor.id]) {
          next[ancestor.id] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // 先平滑捲動到目標條文，待捲動大致結束後才亮起 + 跳動（最後到達時觸發）。
    let cancelled = false;
    const timers: number[] = [];
    const scrollThenHighlight = (attempt = 0) => {
      if (cancelled) return;
      const element = document.getElementById(`a-${target.id}`);
      if (!element) {
        if (attempt < 12) {
          timers.push(window.setTimeout(() => scrollThenHighlight(attempt + 1), 80));
        }
        return;
      }
      const rect = element.getBoundingClientRect();
      const vh = window.innerHeight;
      const wellInView = rect.top >= vh * 0.15 && rect.bottom <= vh * 0.85;
      if (wellInView) {
        setHighlightedArticleId(target.id);
        return;
      }
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) setHighlightedArticleId(target.id);
        }, 520),
      );
    };
    const rafId = requestAnimationFrame(() => scrollThenHighlight());
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      timers.forEach((t) => window.clearTimeout(t));
    };
    // 刻意不列入 articleDisplayRows / routeRefs / searchParams：
    // 高亮只需觸發一次（由 handledDeepLinkRef 控管），articleDisplayRows 會隨 reg
    // 同步更新；若列入，effect 內的 setChapterCollapsedMap 會讓它重跑並 cancel 掉
    // 正在進行的捲動與高亮，導致高亮永遠不亮 / 反覆閃爍。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkRefs, reg, tab]);

  if (loading) {
    return (
      <DetailPageLoading
        title="法規詳情載入中"
        description="正在準備條文、版本與修正紀錄。"
      />
    );
  }
  if (!reg) return <div className="py-20 text-center" style={{ color: "var(--danger)" }}>法規不存在或無法存取</div>;

  const sortedRevisions = [...(reg.revisions ?? [])].sort(
    (a, b) => new Date(a.amended_at).getTime() - new Date(b.amended_at).getTime()
  );
  const legislativeHistoryRows = splitLegislativeHistory(reg.legislative_history);
  const generatedHistoryRows = formatGeneratedHistoryRows(sortedRevisions);
  const hasHistoryRows = legislativeHistoryRows.length > 0 || generatedHistoryRows.length > 0;
  const latestRevision = sortedRevisions[sortedRevisions.length - 1] ?? null;
  const deletedCount = allArticles.filter(a => a.is_deleted).length;
  const amendmentDraftCount = amendmentDrafts.length;
  const councilApprovedLog = [...(reg.workflow_logs ?? [])]
    .reverse()
    .find((log) => log.to_status === "council_approved");
  const proposerName = reg.created_by_name ?? reg.created_by;
  const canRepeal = can("regulation:publish") || can("regulation:admin") || isAdmin;

  return (
    <>
      {/* 列印樣式 */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-content { break-inside: avoid; }
        }
      `}</style>

      <div className="regulation-detail-page max-w-6xl mx-auto space-y-5">
        {/* 麵包屑 */}
        <Breadcrumb items={[
          { label: "法規查詢", href: "/regulations" },
          { label: reg.title },
        ]} />
        {/* ── 頂部標題列 ───────────────────────────────────────────────────── */}
        <div className="regulation-detail-heading flex items-start gap-3">
          <Link href="/regulations"
            className="no-print mt-1 w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center hover:opacity-80"
            style={{ border: "1px solid var(--border)" }}>←</Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <RegulationCategoryBadge category={reg.category} />
              <span className="text-xs px-2 py-0.5 rounded"
                style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                v{reg.version}
              </span>
              <WorkflowStatusBadge status={reg.workflow_status} />
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <h1
                className="w-full min-w-0 break-words text-lg font-semibold leading-snug sm:text-xl"
                style={{
                  color: "var(--text-primary)",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {!reg.is_active && <span style={{ color: "var(--danger)" }}>(失效) </span>}
                {reg.title}
              </h1>

              {/* 工具列 */}
              <div className="regulation-detail-toolbar no-print flex w-full flex-wrap items-center justify-start gap-2 sm:justify-end">
                <GovernanceLinkPanel
                  entityType="regulation"
                  entityId={reg.id}
                  title={reg.title}
                  href={currentRegHref}
                  compact
                />
                {/* 縮放 */}
                <div className="flex items-center gap-1 rounded-lg overflow-hidden"
                  style={{ border: "1px solid var(--border)" }}>
                  <button onClick={() => setZoom(z => Math.max(70, z - 10))}
                    className="px-2 py-1.5 text-xs transition-colors hover:opacity-80"
                    style={{ color: "var(--text-muted)" }} title="縮小">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                  </button>
                  <span className="text-xs px-1.5 select-none" style={{ color: "var(--text-muted)" }}>{zoom}%</span>
                  <button onClick={() => setZoom(z => Math.min(150, z + 10))}
                    className="px-2 py-1.5 text-xs transition-colors hover:opacity-80"
                    style={{ color: "var(--text-muted)" }} title="放大">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                      <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                  </button>
                </div>

                {/* 分享 */}
                <button onClick={handleShare}
                  className="px-3 py-1.5 rounded-lg text-xs transition-all hover:opacity-80 inline-flex items-center gap-1"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
                  title="分享">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                  </svg>
                  分享
                </button>

                {/* 全螢幕 */}
                <button onClick={handleFullscreen}
                  className="px-2.5 py-1.5 rounded-lg text-xs transition-all hover:opacity-80"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
                  title={isFullscreen ? "退出全螢幕" : "全螢幕"}>
                  {isFullscreen ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                    </svg>
                  )}
                </button>

                {/* 複製連結 */}
                <button onClick={handleCopyLink}
                  className="px-3 py-1.5 rounded-lg text-xs transition-all hover:opacity-80 inline-flex items-center gap-1"
                  style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
                  title="複製連結">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  複製連結
                </button>

                {/* 匯出法規 PDF（帶 token 避免 401） */}
                <button
                  onClick={async () => {
                    if (printingPdf) return;
                    const toastId = toast.loading("正在處理檔案，請稍候...");
                    setPrintingPdf(true);
                    try {
                      const res = await fetch(apiUrl(`${currentRegHref}/print`), {
                        credentials: "include",
                      });
                      if (!res.ok) throw new Error(res.statusText);
                      const blob = await res.blob();
                      const filename = filenameFromContentDisposition(
                        res.headers.get("Content-Disposition"),
                        `${reg.title || "法規"}.pdf`,
                      );
                      const url = URL.createObjectURL(blob);
                      const anchor = document.createElement("a");
                      anchor.href = url;
                      anchor.download = filename;
                      document.body.appendChild(anchor);
                      anchor.click();
                      anchor.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 10000);
                      toast.success("PDF 已下載", { id: toastId });
                    } catch (e) {
                      toast.error(`列印失敗${e instanceof Error && e.message ? `：${e.message}` : ""}`, { id: toastId });
                    } finally {
                      setPrintingPdf(false);
                    }
                  }}
                  disabled={printingPdf}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors hover:opacity-80 disabled:opacity-60 disabled:cursor-wait"
                  style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                  {printingPdf ? (
                    <Loader2 size={12} className="animate-spin" aria-hidden={true} />
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                      <rect x="6" y="14" width="12" height="8"/>
                    </svg>
                  )}
                  {printingPdf ? "正在處理檔案" : "匯出 PDF"}
                </button>

                {/* 編輯（限建立者或管理員） */}
                {(reg.created_by === currentUserId || isAdmin) && (
                  <Link href={`${currentRegHref}/edit`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90 inline-flex items-center gap-1.5"
                    style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    編輯
                  </Link>
                )}

                {/* 直接發布已停用：法規需走審議流程並由主席公布 */}

                {/* 起草修正案 */}
                {can("regulation:create") && reg.is_active && reg.published_at && (
                  <Link
                    href={`${currentRegHref}/amendment`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90 inline-flex items-center gap-1.5"
                    style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}>
                    <FilePenLine size={12} strokeWidth={2} aria-hidden="true" />
                    起草修正案
                  </Link>
                )}

                {/* 凍結（admin，未凍結時顯示） */}
                {can("regulation:admin") && reg.is_active && !reg.freeze_reason && (
                  <button onClick={() => { setFreezeReason(""); setShowFreeze(true); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ background: "rgba(251,146,60,0.1)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.3)" }}>
                    凍結
                  </button>
                )}

                {/* 廢止 */}
                {canRepeal && reg.is_active && !reg.is_repealed && (
                  <button
                    onClick={() => {
                      setRepealReason("");
                      setRepealReplacementId("");
                      setShowRepeal(true);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                    廢止
                  </button>
                )}
              </div>
            </div>

            {reg.published_at && (
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                發布日期：{new Date(reg.published_at).toLocaleDateString("zh-TW")}
                　｜　最後更新：{new Date(reg.updated_at).toLocaleDateString("zh-TW")}
              </p>
            )}
          </div>
        </div>

        {/* ── 失效橫幅 ─────────────────────────────────────────────────────── */}
        {reg.is_repealed && (
          <div className="rounded-xl px-4 py-3 flex items-start gap-3"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" style={{ color: "#ef4444", flexShrink: 0, marginTop: 2 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#ef4444" }}>
                本法規已廢止
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {reg.repealed_date ? `廢止日期：${new Date(reg.repealed_date).toLocaleDateString("zh-TW")}　｜　` : ""}
                {reg.repeal_reason || "未提供廢止理由"}
              </p>
            </div>
          </div>
        )}

        {!reg.is_active && !reg.is_repealed && (
          <div className="rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" style={{ color: "#ef4444", flexShrink: 0 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-sm" style={{ color: "#ef4444" }}>
              本法規已停用，僅供歷史查閱，目前不具法律效力。
            </p>
          </div>
        )}

        {/* ── 凍結橫幅 ─────────────────────────────────────────────────────── */}
        {reg.freeze_reason && (
          <div className="rounded-xl px-4 py-3"
            style={{ background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.3)" }}>
            <div className="flex items-start gap-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" style={{ color: "#fb923c", flexShrink: 0, marginTop: 2 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: "#fb923c" }}>
                  本法規已凍結，效力暫停
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  凍結依據：{reg.freeze_reason}
                </p>
                {reg.freeze_at && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    凍結時間：{new Date(reg.freeze_at).toLocaleString("zh-TW")}
                  </p>
                )}
                {can("regulation:admin") && (
                  <button
                    onClick={async () => {
                      try {
                        const updated = await regulationsApi.unfreeze(id);
                        setReg(updated);
                        toast.success("法規已解凍");
                      } catch (e) { toast.error(apiErrorMessage(e, "解凍失敗")); }
                    }}
                    className="mt-2 text-xs px-3 py-1 rounded-lg"
                    style={{ color: "#fb923c", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)" }}>
                    解凍法規
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 分頁標籤 ─────────────────────────────────────────────────────── */}
        <div className="no-print flex gap-1 p-1 rounded-lg overflow-x-auto"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          {([
            { key: "content" as Tab, label: "法規內容" },
            { key: "revisions", label: `修訂歷程${sortedRevisions.length > 0 ? ` (${sortedRevisions.length})` : ""}` },
            ...(currentUserId ? [{ key: "workflow" as Tab, label: "審議流程" }] : []),
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => handleTabChange(key)}
              className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap"
              style={tab === key
                ? { background: "var(--primary-dim)", border: "1px solid var(--border-strong)", color: "var(--primary)" }
                : { color: "var(--text-muted)" }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── 分頁內容 ─────────────────────────────────────────────────────── */}

        {/* 法規內容 */}
        {tab === "content" && (
          <div className="card p-4 sm:p-6 print-content">
            {reg.preface && (
              <div className="mb-6 pb-5 border-b text-sm italic"
                style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
                {reg.preface}
              </div>
            )}
            {hasHistoryRows && (
              <details
                className="mb-6 rounded-xl"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  ...zoomStyle,
                }}
              >
                <summary
                  className="cursor-pointer px-4 py-2.5 text-xs font-semibold uppercase tracking-wider select-none"
                  style={{ color: "var(--text-muted)" }}
                >
                  法規沿革（點此展開）
                </summary>
                <div
                  className="px-4 pb-4 space-y-1 text-sm"
                  style={{
                    color: "var(--text-secondary)",
                    lineHeight: 1.8,
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {legislativeHistoryRows.map((row, index) => <p key={`manual-${index}-${row}`}>{row}</p>)}
                  {generatedHistoryRows.map((row, index) => <p key={`generated-${index}-${row}`}>{row}</p>)}
                </div>
              </details>
            )}
            {activeArticles.length === 0 && reg.content ? (
              <div className={PROSE} style={zoomStyle}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{reg.content}</ReactMarkdown>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>條文內容</h2>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    共 {activeArticles.filter(a => !a.is_deleted).length} 個有效條文
                  </span>
                </div>
                <div className="no-print flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      const nextValue = !allChaptersCollapsed;
                      setChapterCollapsedMap(
                        Object.fromEntries(chapterArticles.map((article) => [article.id, nextValue])),
                      );
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80 inline-flex items-center gap-1.5"
                    style={{
                      color: allChaptersCollapsed ? "var(--primary)" : "var(--text-muted)",
                      border: "1px solid var(--border)",
                      background: allChaptersCollapsed ? "var(--primary-dim)" : "transparent",
                    }}>
                    {allChaptersCollapsed ? "展開各章條文" : "收合各章條文"}
                  </button>
                  <button onClick={() => setTocVisible(v => !v)}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80 inline-flex items-center gap-1.5"
                    style={{
                      color: tocVisible ? "var(--primary)" : "var(--text-muted)",
                      border: "1px solid var(--border)",
                      background: tocVisible ? "var(--primary-dim)" : "transparent",
                    }}>
                    {tocVisible ? "隱藏目錄" : "顯示目錄"}
                  </button>
                  {deletedCount > 0 && (
                    <button onClick={() => setShowDeleted(v => !v)}
                      className="text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80 inline-flex items-center gap-1.5"
                      style={showDeleted
                        ? { color: "var(--danger)", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)" }
                        : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                      {showDeleted ? "隱藏已刪除" : `顯示已刪除 (${deletedCount})`}
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:gap-4 lg:items-start">
                  {tocVisible && (
                    <aside className="no-print w-full max-h-52 overflow-auto rounded-xl p-3 lg:sticky lg:top-4 lg:w-64 lg:max-h-[70vh] lg:flex-shrink-0"
                      style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                      <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>章節目錄</p>
                      <div className="space-y-1">
                        {tocItems.map(item => (
                          <button
                            key={item.anchor}
                            onClick={() => {
                              const target = document.getElementById(item.anchor);
                              if (!target) return;
                              setActiveAnchorId(item.anchor);
                              requestAnimationFrame(() => {
                                target.scrollIntoView({ behavior: "smooth", block: "start" });
                              });
                            }}
                            className="w-full text-left text-xs px-2 py-1 rounded hover:opacity-80"
                            style={{
                              paddingLeft: `${0.5 + item.indent * 0.75}rem`,
                              color: activeAnchorId === item.anchor ? "var(--primary)" : "var(--text-secondary)",
                              background: activeAnchorId === item.anchor ? "var(--primary-dim)" : "transparent",
                              border: activeAnchorId === item.anchor ? "1px solid var(--border-strong)" : "1px solid transparent",
                              fontWeight: item.indent === 0 ? 600 : 400,
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </aside>
                  )}
                  <div className="w-full min-w-0 flex-1 glass overflow-hidden" style={zoomStyle}>
                    {activeArticles.length === 0
                      ? <p className="p-6 text-center" style={{ color: "var(--text-muted)" }}>尚無條文記錄</p>
                      : articleDisplayRows.map(({ article, displayLabel, hiddenByChapter }) => (
                          <ArticleRow
                            key={article.id}
                            article={article}
                            displayLabel={displayLabel}
                            hidden={hiddenByChapter}
                            chapterCollapsed={Boolean(article.article_type === "chapter" && chapterCollapsedMap[article.id])}
                            shareUrl={articleShareUrls[article.id]}
                            onCopyLink={handleCopyArticleLink}
                            showTopDivider={!article.parent_id}
                            highlighted={highlightedArticleId === article.id}
                            onClearHighlight={() => setHighlightedArticleId(null)}
                            onToggleChapter={
                              article.article_type === "chapter"
                                ? () => setChapterCollapsedMap((prev) => ({ ...prev, [article.id]: !prev[article.id] }))
                                : null
                            }
                          />
                        ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 修訂歷程 */}
        {tab === "revisions" && (
          <div className="space-y-3">
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>版本摘要</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <p style={{ color: "var(--text-muted)" }}>提案人</p>
                  <p className="mt-1 font-medium" style={{ color: "var(--text-primary)" }}>{proposerName}</p>
                </div>
                <div>
                  <p style={{ color: "var(--text-muted)" }}>提案時間</p>
                  <p className="mt-1 font-medium" style={{ color: "var(--text-primary)" }}>
                    {new Date(reg.created_at).toLocaleDateString("zh-TW")}
                  </p>
                </div>
                <div>
                  <p style={{ color: "var(--text-muted)" }}>議會通過時間</p>
                  <p className="mt-1 font-medium" style={{ color: "var(--text-primary)" }}>
                    {councilApprovedLog ? new Date(councilApprovedLog.created_at).toLocaleDateString("zh-TW") : "尚未記錄"}
                  </p>
                </div>
                <div>
                  <p style={{ color: "var(--text-muted)" }}>主席公布字號</p>
                  {publishedDoc ? (
                    <Link
                      href={`/documents/${publishedDoc.id}`}
                      className="mt-1 inline-flex font-medium hover:opacity-80"
                      style={{ color: "var(--primary)" }}
                    >
                      {publishedDoc.serial_number}
                    </Link>
                  ) : (
                    <p className="mt-1 font-medium" style={{ color: "var(--text-primary)" }}>尚未公布</p>
                  )}
                </div>
              </div>
            </div>
            {sortedRevisions.length === 0
              ? <div className="card p-6 text-center" style={{ color: "var(--text-muted)" }}>尚無修訂歷程</div>
              : [...sortedRevisions].reverse().map((rev, i) => {
                  const sortedIdx = sortedRevisions.length - 1 - i;
                  const prevRev = sortedIdx > 0 ? sortedRevisions[sortedIdx - 1] : null;
                  return (
                    <RevisionCard
                      key={rev.id}
                      rev={rev}
                      prevRev={prevRev}
                      currentRev={latestRevision}
                      onDiff={(a, b) => setDiffPair([a, b])}
                    />
                  );
                })}
          </div>
        )}

        {/* ── 審議流程（僅登入使用者可見）─────────────────────────────────── */}
        {tab === "workflow" && currentUserId && (
          <div className="space-y-4">
            {/* 下一步視覺引導卡 */}
            {(() => {
              const NEXT: Record<string, { Icon: LucideIcon; color: string; bg: string; border: string; title: string; desc: string }> = {
                draft:            { Icon: FilePenLine, color: "#818cf8", bg: "rgba(99,102,241,0.07)", border: "rgba(99,102,241,0.25)", title: "下一步：送交議會審議", desc: "草稿完成後，由起草人點擊「送交議會審議」，進入審議流程。" },
                under_review:     { Icon: ClipboardList, color: "#0284c7", bg: "rgba(2,132,199,0.07)", border: "rgba(2,132,199,0.25)", title: "下一步：排入議程", desc: "書記官審閱後，點擊「排入議程」將法規列入下次議會討論。" },
                scheduled:        { Icon: CalendarDays, color: "#7c3aed", bg: "rgba(124,58,237,0.07)", border: "rgba(124,58,237,0.25)", title: "下一步：議會核定", desc: "議會討論後，議長點擊「議會核定通過」完成議會程序。" },
                council_approved: { Icon: ScrollText, color: "#d97706", bg: "rgba(217,119,6,0.07)", border: "rgba(217,119,6,0.25)", title: "下一步：主席公布", desc: "主席審核後點擊「主席公布法規」，法規正式生效並記錄修訂歷程。" },
                published:        { Icon: CheckCircle2, color: "var(--success)", bg: "var(--success-dim)", border: "rgba(34,197,94,0.3)", title: "法規已公布生效", desc: "此法規目前為現行有效版本。如需修訂，請從法規詳情頁起草修正案。" },
                rejected:         { Icon: Undo2, color: "var(--danger)", bg: "rgba(220,38,38,0.07)", border: "rgba(220,38,38,0.25)", title: "已退回草稿", desc: "法規已被退回，請修正內容後重新送審。" },
                archived:         { Icon: Archive, color: "var(--text-muted)", bg: "var(--bg-elevated)", border: "var(--border)", title: "法規已廢止", desc: "此法規已停用，僅供歷史查閱。" },
              };
              const info = NEXT[reg.workflow_status];
              if (!info) return null;
              const Icon = info.Icon;
              return (
                <div className="rounded-xl px-4 py-3 flex items-start gap-3"
                  style={{ background: info.bg, border: `1px solid ${info.border}` }}>
                  <span className="flex-shrink-0 mt-0.5" style={{ color: info.color }}>
                    <Icon size={18} strokeWidth={2.2} aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: info.color }}>{info.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{info.desc}</p>
                  </div>
                </div>
              );
            })()}
            {/* 審議操作按鈕 */}
            <div className="card p-4 space-y-3">
              <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>可用操作</p>
              <div className="flex flex-wrap gap-2">
                {/* 送審 */}
                {reg.workflow_status === "draft" && can("regulation:submit") && (
                  <button disabled={wfActionLoading} onClick={() => runWfAction("送審", (note) => regulationsApi.submitReview(id, note || undefined).then(setReg))}
                    className="btn btn-primary text-xs px-3 py-1.5">送交議會審議</button>
                )}
                {/* 排入議程 */}
                {reg.workflow_status === "under_review" && can("regulation:schedule") && (
                  <button disabled={wfActionLoading} onClick={() => openMeetingPicker("schedule", "排入議程")}
                    className="btn btn-primary text-xs px-3 py-1.5">排入議程</button>
                )}
                {/* 議會核定 */}
                {reg.workflow_status === "scheduled" && can("regulation:council_approve") && (
                  <button disabled={wfActionLoading} onClick={() => openMeetingPicker("council", "議會核定")}
                    className="btn btn-primary text-xs px-3 py-1.5">議會核定通過</button>
                )}
                {/* 主席公布（需填寫修正內容描述，生成主令公文） */}
                {reg.workflow_status === "council_approved" && can("regulation:president_publish") && (
                  <button disabled={wfActionLoading}
                    onClick={() => runWfAction(
                      "主席公布法規",
                      (note) => regulationsApi.presidentPublish(id, note || undefined).then(setReg),
                      true,
                      "修正條文描述（選填，將寫入主令公文）",
                      "例：修正第七條；或 修正第一條、第二條",
                    )}
                    className="btn btn-primary text-xs px-3 py-1.5">主席公布法規</button>
                )}
                {/* 退回（schedule 以上）*/}
                {["under_review", "scheduled", "council_approved"].includes(reg.workflow_status) && can("regulation:schedule") && (
                  <button disabled={wfActionLoading} onClick={() => runWfAction("退回草稿", (note) => regulationsApi.rejectRegulation(id, note || "審議退回").then(setReg), true)}
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ color: "var(--danger)", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)" }}>
                    退回草稿
                  </button>
                )}
                {/* 重新提交（rejected → under_review） */}
                {reg.workflow_status === "rejected" && (reg.created_by === currentUserId || isAdmin) && (
                  <button disabled={wfActionLoading} onClick={() => runWfAction("重新提交", (note) => regulationsApi.submitReview(id, note || undefined).then(setReg))}
                    className="btn btn-primary text-xs px-3 py-1.5">重新送審</button>
                )}
                {/* 廢止法規 */}
                {reg.workflow_status === "published" && canRepeal && !reg.is_repealed && (
                  <button
                    disabled={wfActionLoading}
                    onClick={() => {
                      setRepealReason("");
                      setRepealReplacementId("");
                      setShowRepeal(true);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ color: "var(--danger)", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)" }}>
                    廢止法規
                  </button>
                )}
                {(reg.workflow_status === "draft" || reg.workflow_status === "rejected") && !can("regulation:submit") && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    草稿由建立者送交議會後，再由書記官排入議程，議長核定，最終由主席公布。
                  </p>
                )}
              </div>
              {reg.workflow_note && (
                <div className="px-3 py-2 rounded-lg text-xs"
                  style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)", color: "var(--danger)" }}>
                  最新備註：{reg.workflow_note}
                </div>
              )}
            </div>
            {/* 時間軸 */}
            <WorkflowTimeline logs={reg.workflow_logs ?? []} currentStatus={reg.workflow_status} />

            {/* 修正案草稿 */}
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>本機修正案草稿</p>
                {amendmentDraftCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "rgba(201,168,76,0.15)", color: "var(--primary)", border: "1px solid rgba(201,168,76,0.3)" }}>
                    {amendmentDraftCount} 份草稿
                  </span>
                )}
              </div>
              {amendmentDraftCount === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>目前無本機修正案草稿。</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    您有 {amendmentDraftCount} 份尚未提交的修正案草稿，儲存於本機。
                  </p>
                  <div className="divide-y overflow-hidden rounded-lg"
                    style={{ border: "1px solid var(--border)", borderColor: "var(--border)" }}>
                    {amendmentDrafts.map((draft) => (
                      <div key={draft.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                            {draft.name}
                          </p>
                          <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {draft.amendmentType === "partial" ? "部分修正" : "全文修正"} ·
                            最後修改 {new Date(draft.updatedAt).toLocaleString("zh-TW")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteAmendmentDraft(draft.id)}
                          className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg hover:opacity-80"
                          style={{ color: "var(--danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}
                          aria-label={`刪除草稿 ${draft.name}`}
                          title="刪除草稿"
                        >
                          <Trash2 size={13} strokeWidth={2.2} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Link href={`${currentRegHref}/amendment`}
                className="btn btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
                style={{ textDecoration: "none" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {amendmentDraftCount > 0 ? "繼續修正案草稿" : "起草修正案"}
              </Link>
            </div>
          </div>
        )}

        {/* ── 元資訊頁尾 ───────────────────────────────────────────────────── */}
        <div className="card p-4">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {([
              ["最後更新", new Date(reg.updated_at).toLocaleString("zh-TW")],
              ["建立日期", new Date(reg.created_at).toLocaleDateString("zh-TW")],
              ["狀態", reg.is_active ? "生效中" : "已停用"],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k}>
                <dt style={{ color: "var(--text-muted)" }}>{k}</dt>
                <dd className="mt-0.5" style={{ color: "var(--text-primary)" }}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="no-print fixed bottom-5 right-5 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition-opacity hover:opacity-85"
          style={{
            background: "var(--bg-surface)",
            color: "var(--primary)",
            border: "1px solid var(--border-strong)",
          }}
          title="回到最上方"
          aria-label="回到最上方"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
      )}

      {/* ── 版本差異 Modal ──────────────────────────────────────────────────── */}
      {diffPair && (
        <DiffModal
          revA={diffPair[0]}
          revB={diffPair[1]}
          onClose={() => setDiffPair(null)}
        />
      )}

      {/* ── 凍結 Modal ──────────────────────────────────────────────────────── */}
      {showFreeze && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
          style={{ background: "var(--bg-overlay)" }} role="dialog" aria-modal="true">
          <div className="absolute inset-0" onClick={() => setShowFreeze(false)} aria-hidden="true" />
          <div className="relative rounded-2xl p-5 space-y-4 shadow-2xl w-full max-w-sm"
            style={{ background: "var(--bg-surface)", border: "1px solid rgba(251,146,60,0.4)" }}>
            <h2 className="text-base font-semibold" style={{ color: "#fb923c" }}>凍結整部法規</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              凍結後本法規效力暫停，頁面將顯示警告橫幅。凍結不同於廢止，仍可解凍恢復效力。
            </p>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>
                凍結依據說明（必填）
              </label>
              <textarea value={freezeReason} onChange={e => setFreezeReason(e.target.value)}
                rows={3} placeholder="例：依第三屆第四次臨時會決議暫停施行..."
                className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowFreeze(false)} className="btn btn-ghost text-xs px-4 py-1.5">取消</button>
              <button
                disabled={freezeLoading || !freezeReason.trim()}
                onClick={async () => {
                  setFreezeLoading(true);
                  try {
                    const updated = await regulationsApi.freeze(id, freezeReason.trim());
                    setReg(updated);
                    setShowFreeze(false);
                    toast.success("法規已凍結");
                  } catch (e) { toast.error(apiErrorMessage(e, "凍結失敗")); }
                  finally { setFreezeLoading(false); }
                }}
                className="text-xs px-4 py-1.5 rounded-lg font-medium disabled:opacity-50"
                style={{ background: "#fb923c", color: "white" }}>
                {freezeLoading ? "處理中…" : "確認凍結"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 廢止 Modal ──────────────────────────────────────────────────────── */}
      {showRepeal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
          style={{ background: "var(--bg-overlay)" }} role="dialog" aria-modal="true">
          <div className="absolute inset-0" onClick={() => setShowRepeal(false)} aria-hidden="true" />
          <div className="relative my-auto max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl p-5 shadow-2xl"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--danger-border)" }}>
            <div>
              <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--danger)" }}>
                REPEAL REGULATION
              </p>
              <h2 className="mt-1 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                廢止法規
              </h2>
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                廢止後法規會標記為失效並保留歷史紀錄。此操作會記錄廢止理由與替代法規。
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  廢止理由（必填）
                </span>
                <textarea
                  value={repealReason}
                  onChange={(e) => setRepealReason(e.target.value)}
                  rows={4}
                  placeholder="例：依第四屆第一次會員代表大會決議，原法規已由新版自治章程取代。"
                  className="input resize-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  替代法規（選填）
                </span>
                <select
                  className="input"
                  value={repealReplacementId}
                  onChange={(e) => setRepealReplacementId(e.target.value)}>
                  <option value="">不指定替代法規</option>
                  {repealOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title} v{item.version}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowRepeal(false)}
                className="btn btn-ghost text-xs px-4 py-1.5"
                disabled={repealLoading}>
                取消
              </button>
              <button
                disabled={repealLoading || !repealReason.trim()}
                onClick={async () => {
                  setRepealLoading(true);
                  try {
                    const updated = await regulationsApi.repeal(id, {
                      reason: repealReason.trim(),
                      replacement_id: repealReplacementId || null,
                    });
                    setReg(updated);
                    setShowRepeal(false);
                    toast.success("法規已廢止");
                  } catch (e) {
                    toast.error(apiErrorMessage(e, "廢止失敗"));
                  } finally {
                    setRepealLoading(false);
                  }
                }}
                className="text-xs px-4 py-1.5 rounded-lg font-medium disabled:opacity-50"
                style={{ background: "var(--danger)", color: "white" }}>
                {repealLoading ? "處理中…" : "確認廢止"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 流程備註輸入 Modal ──────────────────────────────────────────────── */}
      {wfNoteModal && (
        <WfNoteModal
          label={wfNoteModal.label}
          hint={wfNoteModal.hint}
          placeholder={wfNoteModal.placeholder}
          onClose={() => setWfNoteModal(null)}
          onSubmit={async (note) => {
            setWfNoteModal(null);
            setWfActionLoading(true);
            try {
              await wfNoteModal.fn(note);
              reload();
              toast.success(`${wfNoteModal.label} 成功`);
            } catch (e) {
              toast.error(apiErrorMessage(e, "操作失敗"));
            } finally { setWfActionLoading(false); }
          }}
        />
      )}

      {/* ── 排入議程／議會核定：選擇會議 Modal ──────────────────────────────── */}
      {meetingPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setMeetingPicker(null)}>
          <div className="w-full max-w-md rounded-xl bg-[var(--card,#fff)] p-5 shadow-xl"
            style={{ background: "var(--card-bg, var(--background))" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">{meetingPicker.title}</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              此動作須透過會議進行，請選擇一場已將本法案排入議程的會議。
            </p>
            {pickerMeetings.length === 0 ? (
              <p className="mt-4 rounded-lg p-3 text-xs"
                style={{ color: "var(--danger)", background: "rgba(220,38,38,0.08)" }}>
                目前沒有可用的會議。請先於會議端（同步待審法案或手動新增議程）將本法案排入議程。
              </p>
            ) : (
              <>
                <label className="mt-4 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  選擇會議
                </label>
                <select
                  value={pickerMeetingId}
                  onChange={(e) => setPickerMeetingId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
                  <option value="">— 請選擇 —</option>
                  {pickerMeetings.map((m) => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
                <label className="mt-3 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  備註（選填）
                </label>
                <input
                  value={pickerNote}
                  onChange={(e) => setPickerNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm" />
              </>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setMeetingPicker(null)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">取消</button>
              <button
                disabled={wfActionLoading || !pickerMeetingId}
                onClick={confirmMeetingPicker}
                className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-50">確認</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
