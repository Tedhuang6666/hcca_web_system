"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  PROSE,
  RevisionCard,
  buildArticleDisplayRows,
  isTab,
  type Tab,
} from "@/components/regulations/RegulationDetailSections";
import { DetailPageLoading } from "@/components/ui/LoadingState";
import ArticleRow from "@/components/regulations/LawReadingRow";
import { administrativeDate, countLawArticles, REGULATION_CATEGORIES, regulationPublicState } from "@/lib/administrative";
import { usePermissions } from "@/hooks/usePermissions";
import { usePersistedZoom } from "@/hooks/usePersistedZoom";
import { authFetch } from "@/lib/api/core";
import { documentsApi } from "@/lib/api/documents";
import { regulationHref, regulationsApi } from "@/lib/api/regulations";
import { apiErrorMessage } from "@/lib/api-helpers";
import { apiUrl } from "@/lib/config";
import AnimatedDownloadButton from "@/components/ui/AnimatedDownloadButton";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatGeneratedHistoryRows, splitLegislativeHistory } from "@/lib/regulationHistory";
import { recordRecent } from "@/lib/recents";
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
  RegulationOut,
  RegulationRevisionOut,
} from "@/lib/types";

const RegulationMarkdownContent = dynamic(
  () => import("@/components/regulations/RegulationMarkdownContent"),
  { ssr: false },
);
const RegulationDiffModal = dynamic(
  () => import("@/components/regulations/RegulationDiffModal"),
  { ssr: false },
);

type RegulationDetailPageClientProps = {
  initialId: string;
  initialRefs?: string[];
  initialTitle?: string | null;
  initialRegulation?: RegulationOut | null;
  initialTab?: string | null;
  initialArticleRef?: string | null;
  initialUnitRef?: string | null;
};

function showErrorToast(message: string): void {
  void import("sonner").then(({ toast }) => toast.error(message));
}

function showSuccessToast(message: string): void {
  void import("sonner").then(({ toast }) => toast.success(message));
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function RegulationDetailPageClient({
  initialId,
  initialRefs = [],
  initialTitle = null,
  initialRegulation = null,
  initialTab,
  initialArticleRef,
  initialUnitRef,
}: RegulationDetailPageClientProps) {
  // useParams 對非 ASCII 會回傳 URL-encoded 值（如 %E5%85%AD...）；
  // 統一 decode 後再給 API / localStorage / encodeURIComponent 使用，避免雙重編碼。
  const id = useMemo(() => decodeRouteSegment(initialId), [initialId]);
  const router = useRouter();
  const confirm = useConfirm();
  const [reg, setReg] = useState<RegulationOut | null>(initialRegulation);
  const [loading, setLoading] = useState(!initialRegulation);
  const normalizedInitialTab = initialTab ?? null;
  const [tab, setTab] = useState<Tab>(isTab(normalizedInitialTab) ? normalizedInitialTab : "content");
  const { zoom, setZoom, zoomStyle } = usePersistedZoom("hcca.viewer.zoom");
  const [diffPair, setDiffPair] = useState<[RegulationRevisionOut, RegulationRevisionOut | null] | null>(null);

  const [showDeleted, setShowDeleted] = useState(false);
  const [tocVisible, setTocVisible] = useState(true);
  const [mobileTocExpanded, setMobileTocExpanded] = useState(false);
  const [chapterCollapsedMap, setChapterCollapsedMap] = useState<Record<string, boolean>>({});
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [highlightedArticleId, setHighlightedArticleId] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [publishedDoc, setPublishedDoc] = useState<DocumentOut | null>(null);
  const { can } = usePermissions();
  const [publishing, setPublishing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const isAnonymous = !currentUserId;
  const currentRegHref = reg ? regulationHref(reg) : `/regulations/${encodeURIComponent(id)}`;

  const reload = useCallback(() => {
    regulationsApi.get(id).then(setReg).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (reg) recordRecent({ kind: "regulation", id, title: reg.title, href: regulationHref(reg) });
  }, [reg, id]);

  useEffect(() => {
    const storedUserId = localStorage.getItem("user_id") ?? "";
    setCurrentUserId(storedUserId);
  }, []);

  useEffect(() => {
    // 公開法規已由 Server Component 注入；登入與匿名訪客都不必重複下載同一份資料。
    // 寫入操作完成後仍由 reload 明確刷新，避免首屏再發一次相同請求。
    if (initialRegulation) {
      setLoading(false);
      return;
    }
    if (!initialRegulation) setLoading(true);
    regulationsApi.get(id)
      .then(setReg)
      .catch(e => showErrorToast(apiErrorMessage(e, "載入失敗")))
      .finally(() => setLoading(false));
  }, [id, initialRegulation]);

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
    const syncTabFromUrl = () => {
      const nextTab = new URLSearchParams(window.location.search).get("tab");
      if (isTab(nextTab)) setTab(nextTab);
    };
    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, []);

  useEffect(() => {
    const nextTab = initialTab ?? null;
    if (isTab(nextTab)) {
      setTab(nextTab);
    }
  }, [initialTab]);

  const handleTabChange = useCallback((nextTab: Tab) => {
    setTab(nextTab);
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    router.replace(`${currentRegHref}?tab=${nextTab}${hash}`, { scroll: false });
  }, [currentRegHref, router]);

  // 分享（navigator.share + clipboard fallback）
  const handleShare = useCallback(async () => {
    const shareData = { title: reg?.title ?? "法規", url: window.location.href };
    if (typeof navigator.share === "function") {
      try { await navigator.share(shareData); return; } catch {}
    }
    navigator.clipboard.writeText(window.location.href)
      .then(() => showSuccessToast("連結已複製到剪貼簿"))
      .catch(() => showErrorToast("複製失敗"));
  }, [reg?.title]);

  // 複製連結
  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => showSuccessToast("連結已複製"))
      .catch(() => showErrorToast("複製失敗"));
  }, []);

  const handleCopyArticleLink = useCallback((path: string) => {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(url)
      .then(() => showSuccessToast("條文連結已複製"))
      .catch(() => showErrorToast("複製失敗"));
  }, []);

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
    // 使用 UUID 建立穩定連結，避免同名法規誤導向其他版本
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
    const refs = initialRefs.map(decodeRouteSegment);
    if (refs.length === 0 && initialArticleRef) refs.push(initialArticleRef);
    if (refs.length === 1 && initialUnitRef) refs.push(initialUnitRef);
    return refs;
  }, [initialArticleRef, initialRefs, initialUnitRef]);

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
    if (initialTitle) {
      return (
        <div className="regulation-detail-loading regulation-detail-page app-page-width space-y-5">
          <div className="regulation-detail-heading flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1
                className="w-full min-w-0 break-words text-lg font-semibold leading-snug sm:text-xl"
                style={{ color: "var(--text-primary)", overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                {initialTitle}
              </h1>
            </div>
          </div>
          <DetailPageLoading
            title="法規詳情載入中"
            description="正在準備條文、版本與修正紀錄。"
          />
        </div>
      );
    }
    return (
      <div className="regulation-detail-loading">
        <DetailPageLoading
          title="法規詳情載入中"
          description="正在準備條文、版本與修正紀錄。"
        />
      </div>
    );
  }
  if (!reg) return <div className="py-20 text-center" style={{ color: "var(--danger)" }}>法規不存在或無法存取</div>;

  const sortedRevisions = [...(reg.revisions ?? [])].sort(
    (a, b) => new Date(a.amended_at).getTime() - new Date(b.amended_at).getTime()
  );
  const legislativeHistoryRows = splitLegislativeHistory(reg.legislative_history);
  // 匯入的既有法規會同時留下文字沿革與 revision 快照；兩者代表同一批事件，
  // 不應在畫面上再追加一份系統合成的沿革。
  const generatedHistoryRows = legislativeHistoryRows.length > 0
    ? []
    : formatGeneratedHistoryRows(sortedRevisions);
  const hasHistoryRows = legislativeHistoryRows.length > 0 || generatedHistoryRows.length > 0;
  const latestRevision = sortedRevisions[sortedRevisions.length - 1] ?? null;
  const deletedCount = allArticles.filter(a => a.is_deleted).length;

  return (
    <>
      <div className="regulation-detail-page app-page-width space-y-5">
        <nav className="administrative-breadcrumb no-print" aria-label="目前位置">
          <Link href="/regulations">自治法規</Link><span aria-hidden="true">/</span>
          <Link href={`/regulations?category=${reg.category}`}>{REGULATION_CATEGORIES[reg.category]}</Link>
          <span aria-hidden="true">/</span><span>法規內容</span>
        </nav>
        <header className="regulation-detail-heading">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {!reg.is_active && <span style={{ color: "var(--danger)" }}>(失效) </span>}
            {reg.title}
          </h1>
          <div className="regulation-reading-meta">
            <span>{regulationPublicState(reg)}</span>
            {reg.published_at && <span>公布日期：{administrativeDate(reg.published_at, true)}</span>}
            {reg.effective_date && <span>施行日期：{administrativeDate(reg.effective_date, true)}</span>}
          </div>
          <div className="regulation-reading-toolbar no-print">
            <div className="regulation-reading-tools" role="group" aria-label="閱讀工具">
              <div className="regulation-reading-zoom" role="group" aria-label="法規字級">
                <button type="button" onClick={() => setZoom((value) => Math.max(70, value - 10))}
                  disabled={zoom <= 70} aria-label="縮小" title="縮小">A−</button>
                <span aria-live="polite">{zoom}%</span>
                <button type="button" onClick={() => setZoom((value) => Math.min(150, value + 10))}
                  disabled={zoom >= 150} aria-label="放大" title="放大">A＋</button>
              </div>
              <button type="button" onClick={handleShare} className="btn btn-ghost">分享</button>
              <button type="button" onClick={handleCopyLink} className="btn btn-ghost">複製連結</button>
              <AnimatedDownloadButton
                request={() => authFetch(apiUrl(`${currentRegHref}/print`), { credentials: "include" })}
                filename={`${reg.title || "法規"}.pdf`}
                className="btn btn-secondary"
                aria-label="下載 PDF"
                label="下載 PDF"
                onComplete={() => showSuccessToast("PDF 已下載")}
                onError={(error) => showErrorToast(`PDF 匯出失敗${error instanceof Error && error.message ? `：${error.message}` : ""}`)} />
            </div>
            {!reg.published_at && !reg.is_repealed && reg.workflow_status !== "archived"
              && (can("regulation:publish") || can("regulation:president_publish") || can("regulation:admin")) && (
              <button type="button" className="btn btn-secondary" disabled={publishing} onClick={async () => {
                if (!await confirm({ title: "公布此法規？", confirmLabel: "公布" })) return;
                setPublishing(true);
                try {
                  await regulationsApi.publish(id, { change_brief: "公布法規" });
                  reload();
                  showSuccessToast("法規已公布");
                } catch (error) { showErrorToast(apiErrorMessage(error, "公布失敗")); }
                finally { setPublishing(false); }
              }}>{publishing ? "公布中…" : "公布"}</button>
            )}
          </div>
        </header>

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
                {reg.repealed_date ? `廢止日期：${new Date(reg.repealed_date).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}　｜　` : ""}
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
                    凍結時間：{new Date(reg.freeze_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }).replace(/\s+/gu, " ")}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 分頁標籤 ─────────────────────────────────────────────────────── */}
        <div className="administrative-reader-tabs no-print flex gap-1 p-1 rounded-lg overflow-x-auto"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          {([
            { key: "content" as Tab, label: "條文內容" },
            { key: "revisions", label: "歷史版本" },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button key={key} aria-pressed={tab === key} onClick={() => handleTabChange(key)}
              className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-[color,background-color,border-color,opacity,box-shadow,transform] whitespace-nowrap"
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
          <div className="administrative-law-reader print-content">
            {reg.preface && (
              <div className="mb-6 pb-5 border-b text-sm italic"
                style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
                {reg.preface}
              </div>
            )}
            {hasHistoryRows && (
              <details
                className="administrative-law-history reader-font-scale mb-6"
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
                  法規沿革
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
              <RegulationMarkdownContent
                content={reg.content}
                className={`reader-font-scale ${PROSE}`}
                style={zoomStyle}
              />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>條文內容</h2>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    共 {countLawArticles(allArticles)} 條未刪除條文
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
                    className="text-xs px-3 py-1.5 rounded-lg transition-[color,background-color,border-color,opacity,box-shadow,transform] hover:opacity-80 inline-flex items-center gap-1.5"
                    style={{
                      color: allChaptersCollapsed ? "var(--primary)" : "var(--text-muted)",
                      border: "1px solid var(--border)",
                      background: allChaptersCollapsed ? "var(--primary-dim)" : "transparent",
                    }}>
                    {allChaptersCollapsed ? "展開各章條文" : "收合各章條文"}
                  </button>
                  <button onClick={() => setTocVisible(v => !v)}
                    className="text-xs px-3 py-1.5 rounded-lg transition-[color,background-color,border-color,opacity,box-shadow,transform] hover:opacity-80 inline-flex items-center gap-1.5"
                    style={{
                      color: tocVisible ? "var(--primary)" : "var(--text-muted)",
                      border: "1px solid var(--border)",
                      background: tocVisible ? "var(--primary-dim)" : "transparent",
                    }}>
                    {tocVisible ? "隱藏目錄" : "顯示目錄"}
                  </button>
                  {deletedCount > 0 && (
                    <button onClick={() => setShowDeleted(v => !v)}
                      className="text-xs px-3 py-1.5 rounded-lg transition-[color,background-color,border-color,opacity,box-shadow,transform] hover:opacity-80 inline-flex items-center gap-1.5"
                      style={showDeleted
                        ? { color: "var(--danger)", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)" }
                        : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                      {showDeleted ? "隱藏已刪除" : `顯示已刪除 (${deletedCount})`}
                    </button>
                  )}
                </div>

                <div className="administrative-law-layout">
                  {tocVisible && (
                    <aside className="administrative-law-toc no-print"
                      style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                      <p className="administrative-toc-desktop-title text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>章節目錄</p>
                      <button type="button" className="administrative-toc-mobile-toggle" aria-expanded={mobileTocExpanded}
                        aria-controls="law-toc-links" onClick={() => setMobileTocExpanded((value) => !value)}>章節目錄　{mobileTocExpanded ? "收合" : "展開"}</button>
                      <div id="law-toc-links" className="space-y-1" data-expanded={mobileTocExpanded}>
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
                  <div
                    className="administrative-law-text reader-font-scale w-full min-w-0 flex-1"
                    style={zoomStyle}
                  >
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
            {publishedDoc && <Link className="administrative-source-link" href={`/documents/${publishedDoc.id}`}>公布公文：{publishedDoc.serial_number}</Link>}
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

        {/* ── 元資訊頁尾 ───────────────────────────────────────────────────── */}
        <div className="card p-4">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {([
              ["最後更新", new Date(reg.updated_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }).replace(/\s+/gu, " ")],
              ["建立日期", new Date(reg.created_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })],
              ["狀態", regulationPublicState(reg)],
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
        <RegulationDiffModal
          revA={diffPair[0]}
          revB={diffPair[1]}
          onClose={() => setDiffPair(null)}
        />
      )}

    </>
  );
}
