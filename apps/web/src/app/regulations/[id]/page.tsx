"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import {
  ARTICLE_IS_STRUCTURAL,
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
import { RegulationCategoryBadge } from "@/components/ui/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";
import { ApiError, documentsApi, regulationsApi, usersApi } from "@/lib/api";
import type { DocumentOut, RegulationOut, RegulationRevisionOut } from "@/lib/types";

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function RegulationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [reg, setReg] = useState<RegulationOut | null>(null);
  const [loading, setLoading] = useState(true);
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : "content");
  const [zoom, setZoom] = useState(100);
  const [diffPair, setDiffPair] = useState<[RegulationRevisionOut, RegulationRevisionOut | null] | null>(null);

  const [wfActionLoading, setWfActionLoading] = useState(false);
  const [showFreeze, setShowFreeze] = useState(false);
  const [freezeReason, setFreezeReason] = useState("");
  const [freezeLoading, setFreezeLoading] = useState(false);
  const [wfNoteModal, setWfNoteModal] = useState<null | {
    action: string; label: string; fn: (note: string) => Promise<void>;
    hint?: string; placeholder?: string;
  }>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [tocVisible, setTocVisible] = useState(true);
  const [chapterCollapsedMap, setChapterCollapsedMap] = useState<Record<string, boolean>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [amendmentDraftCount, setAmendmentDraftCount] = useState(0);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [printingPdf, setPrintingPdf] = useState(false);
  const [publishedDoc, setPublishedDoc] = useState<DocumentOut | null>(null);
  const [userDirectory, setUserDirectory] = useState<Record<string, string>>({});
  const { can, isAdmin } = usePermissions();
  const currentUserId = typeof window !== "undefined" ? localStorage.getItem("user_id") ?? "" : "";

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const reload = useCallback(() => {
    regulationsApi.get(id).then(setReg).catch(() => {});
  }, [id]);

  useEffect(() => {
    regulationsApi.get(id)
      .then(setReg)
      .catch(e => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    usersApi.list()
      .then((users) => {
        setUserDirectory(
          Object.fromEntries(users.map((user) => [user.id, user.display_name])),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!reg?.published_document_id) {
      setPublishedDoc(null);
      return;
    }
    documentsApi.get(reg.published_document_id)
      .then(setPublishedDoc)
      .catch(() => setPublishedDoc(null));
  }, [reg?.published_document_id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`amendment_drafts_${id}`);
      if (raw) {
        const drafts = JSON.parse(raw);
        setAmendmentDraftCount(Array.isArray(drafts) ? drafts.length : 0);
      }
    } catch { /* ignore */ }
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
    router.replace(`/regulations/${id}?tab=${nextTab}${hash}`, { scroll: false });
  }, [id, router]);

  const runWfAction = useCallback(async (
    label: string, fn: (note: string) => Promise<void>, needNote = false,
    hint?: string, placeholder?: string,
  ) => {
    if (needNote) {
      setWfNoteModal({ action: label, label, fn, hint, placeholder });
    } else {
      setWfActionLoading(true);
      try { await fn(""); reload(); toast.success(`${label} 成功`); }
      catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
      finally { setWfActionLoading(false); }
    }
  }, [reload]);

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

  const allArticles = reg?.articles ?? [];
  const activeArticles = showDeleted ? allArticles : allArticles.filter(a => !a.is_deleted);
  const chapterArticles = useMemo(
    () => activeArticles.filter((article) => article.article_type === "chapter"),
    [activeArticles],
  );
  const allChaptersCollapsed = chapterArticles.length > 0
    && chapterArticles.every((article) => chapterCollapsedMap[article.id]);
  const tocItems = useMemo(() => {
    let chapterNumber = 0;
    return chapterArticles.map((article) => {
      chapterNumber += 1;
      return {
        id: article.id,
        anchor: `a-${article.id}`,
        label: `第 ${chapterNumber} 章 ${article.title ?? ""}`.trim(),
      };
    });
  }, [chapterArticles]);
  const articleDisplayRows = useMemo(
    () => buildArticleDisplayRows(activeArticles, chapterCollapsedMap),
    [activeArticles, chapterCollapsedMap],
  );

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

  if (loading) return <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>載入中...</div>;
  if (!reg) return <div className="py-20 text-center" style={{ color: "var(--danger)" }}>法規不存在或無法存取</div>;

  const sortedRevisions = [...(reg.revisions ?? [])].sort(
    (a, b) => new Date(a.amended_at).getTime() - new Date(b.amended_at).getTime()
  );
  const latestRevision = sortedRevisions[sortedRevisions.length - 1] ?? null;
  const deletedCount = allArticles.filter(a => a.is_deleted).length;
  const councilApprovedLog = [...(reg.workflow_logs ?? [])]
    .reverse()
    .find((log) => log.to_status === "council_approved");
  const proposerName = reg.created_by_name ?? userDirectory[reg.created_by] ?? reg.created_by;

  return (
    <>
      {/* 列印樣式 */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-content { break-inside: avoid; }
        }
      `}</style>

      <div className="max-w-5xl mx-auto space-y-5">
        {/* 麵包屑 */}
        <Breadcrumb items={[
          { label: "法規查詢", href: "/regulations" },
          { label: reg.title },
        ]} />
        {/* ── 頂部標題列 ───────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3">
          <Link href="/regulations"
            className="no-print mt-1 w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center hover:opacity-80"
            style={{ border: "1px solid var(--border)" }}>←</Link>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <RegulationCategoryBadge category={reg.category} />
              <span className="text-xs px-2 py-0.5 rounded"
                style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                v{reg.version}
              </span>
              <WorkflowStatusBadge status={reg.workflow_status} />
            </div>

            <div className="flex items-start justify-between gap-3">
              <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                {!reg.is_active && <span style={{ color: "var(--danger)" }}>(失效) </span>}
                {reg.title}
              </h1>

              {/* 工具列 */}
              <div className="no-print flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
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

                {/* 列印 */}
                {/* 列印/匯出法規（帶 token 避免 401） */}
                <button
                  onClick={async () => {
                    if (printingPdf) return;
                    const toastId = toast.loading("正在處理檔案，請稍候...");
                    setPrintingPdf(true);
                    try {
                      const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
                      const res = await fetch(`${BASE}/regulations/${id}/print`, {
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
                    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M21 12a9 9 0 0 1-9 9"/>
                      <path d="M3 12a9 9 0 0 1 9-9"/>
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                      <rect x="6" y="14" width="12" height="8"/>
                    </svg>
                  )}
                  {printingPdf ? "正在處理檔案" : "列印法規"}
                </button>

                {/* 編輯（限建立者或管理員） */}
                {(reg.created_by === currentUserId || isAdmin) && (
                  <Link href={`/regulations/${id}/edit`}
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
                    href={`/regulations/${id}/amendment`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90"
                    style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}>
                    ✍ 起草修正案
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

                {/* 停用（inline 確認） */}
                {can("regulation:admin") && reg.is_active && (
                  confirmArchive ? (
                    <>
                      <button
                        onClick={async () => {
                          try {
                            await regulationsApi.archive(id);
                            toast.success("法規已停用");
                            regulationsApi.get(id).then(setReg).catch(() => {});
                          } catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
                          finally { setConfirmArchive(false); }
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: "#ef4444", color: "white", border: "1px solid #ef4444" }}>
                        確定停用
                      </button>
                      <button onClick={() => setConfirmArchive(false)}
                        className="px-2 py-1.5 rounded-lg text-xs"
                        style={{ color: "var(--text-muted)" }}>取消</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmArchive(true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}>
                      停用
                    </button>
                  )
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
        {!reg.is_active && (
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
                      } catch (e) { toast.error(e instanceof ApiError ? e.message : "解凍失敗"); }
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

        {/* 法規內容（Markdown） */}
        {tab === "content" && (
          <div className="card p-6 print-content" style={{ fontSize: `${zoom}%` }}>
            {reg.preface && (
              <div className="mb-6 pb-5 border-b text-sm italic"
                style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
                {reg.preface}
              </div>
            )}
            {reg.content && (
              <div className={PROSE}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{reg.content}</ReactMarkdown>
              </div>
            )}
            <div className="mt-8 pt-6 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>條文內容</h2>
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
                <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
                  共 {activeArticles.filter(a => !a.is_deleted).length} 個有效條文
                </span>
              </div>

              <div className="flex gap-4 items-start">
                {tocVisible && (
                  <aside className="no-print w-64 max-h-[70vh] overflow-auto rounded-xl p-3 sticky top-4"
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
                            color: activeAnchorId === item.anchor ? "var(--primary)" : "var(--text-secondary)",
                            background: activeAnchorId === item.anchor ? "var(--primary-dim)" : "transparent",
                            border: activeAnchorId === item.anchor ? "1px solid var(--border-strong)" : "1px solid transparent",
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </aside>
                )}
                <div className="flex-1 glass divide-y divide-slate-700/50 overflow-hidden" style={{ fontSize: `${zoom}%` }}>
                  {activeArticles.length === 0
                    ? <p className="p-6 text-center" style={{ color: "var(--text-muted)" }}>尚無條文記錄</p>
                    : articleDisplayRows.map(({ article, index, displayLabel, hiddenByChapter }) => (
                        <ArticleRow
                          key={article.id}
                          article={article}
                          index={index}
                          displayLabel={displayLabel}
                          collapsed={hiddenByChapter && !ARTICLE_IS_STRUCTURAL[article.article_type]}
                          hidden={hiddenByChapter}
                          chapterCollapsed={Boolean(article.article_type === "chapter" && chapterCollapsedMap[article.id])}
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
              const NEXT: Record<string, { icon: string; color: string; bg: string; border: string; title: string; desc: string }> = {
                draft:            { icon: "✍️", color: "#818cf8", bg: "rgba(99,102,241,0.07)", border: "rgba(99,102,241,0.25)", title: "下一步：送交議會審議", desc: "草稿完成後，由起草人點擊「送交議會審議」，進入審議流程。" },
                under_review:     { icon: "📋", color: "#0284c7", bg: "rgba(2,132,199,0.07)", border: "rgba(2,132,199,0.25)", title: "下一步：排入議程", desc: "書記官審閱後，點擊「排入議程」將法規列入下次議會討論。" },
                scheduled:        { icon: "🗓️", color: "#7c3aed", bg: "rgba(124,58,237,0.07)", border: "rgba(124,58,237,0.25)", title: "下一步：議會核定", desc: "議會討論後，議長點擊「議會核定通過」完成議會程序。" },
                council_approved: { icon: "📜", color: "#d97706", bg: "rgba(217,119,6,0.07)", border: "rgba(217,119,6,0.25)", title: "下一步：主席公布", desc: "主席審核後點擊「主席公布法規」，法規正式生效並記錄修訂歷程。" },
                published:        { icon: "✅", color: "var(--success)", bg: "var(--success-dim)", border: "rgba(34,197,94,0.3)", title: "法規已公布生效", desc: "此法規目前為現行有效版本。如需修訂，請從法規詳情頁起草修正案。" },
                rejected:         { icon: "↩️", color: "var(--danger)", bg: "rgba(220,38,38,0.07)", border: "rgba(220,38,38,0.25)", title: "已退回草稿", desc: "法規已被退回，請修正內容後重新送審。" },
                archived:         { icon: "🗄️", color: "var(--text-muted)", bg: "var(--bg-elevated)", border: "var(--border)", title: "法規已廢止", desc: "此法規已停用，僅供歷史查閱。" },
              };
              const info = NEXT[reg.workflow_status];
              if (!info) return null;
              return (
                <div className="rounded-xl px-4 py-3 flex items-start gap-3"
                  style={{ background: info.bg, border: `1px solid ${info.border}` }}>
                  <span className="text-lg flex-shrink-0 mt-0.5">{info.icon}</span>
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
                  <button disabled={wfActionLoading} onClick={() => runWfAction("排入議程", (note) => regulationsApi.scheduleAgenda(id, note || undefined).then(setReg))}
                    className="btn btn-primary text-xs px-3 py-1.5">排入議程</button>
                )}
                {/* 議會核定 */}
                {reg.workflow_status === "scheduled" && can("regulation:council_approve") && (
                  <button disabled={wfActionLoading} onClick={() => runWfAction("議會核定", (note) => regulationsApi.councilApprove(id, note || undefined).then(setReg))}
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
                {/* 廢止法規（inline 確認） */}
                {reg.workflow_status === "published" && can("regulation:admin") && (
                  confirmArchive ? (
                    <>
                      <button disabled={wfActionLoading} onClick={async () => {
                        setWfActionLoading(true);
                        try { const r = await regulationsApi.archive(id); setReg(r); toast.success("法規已廢止"); }
                        catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
                        finally { setWfActionLoading(false); setConfirmArchive(false); }
                      }}
                        className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-40"
                        style={{ color: "white", background: "#ef4444", border: "1px solid #ef4444" }}>
                        確定廢止
                      </button>
                      <button onClick={() => setConfirmArchive(false)}
                        className="text-xs px-2 py-1.5 rounded-lg"
                        style={{ color: "var(--text-muted)" }}>取消</button>
                    </>
                  ) : (
                    <button disabled={wfActionLoading} onClick={() => setConfirmArchive(true)}
                      className="text-xs px-3 py-1.5 rounded-lg"
                      style={{ color: "var(--danger)", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)" }}>
                      廢止法規
                    </button>
                  )
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
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  您有 {amendmentDraftCount} 份尚未提交的修正案草稿，儲存於本機。
                </p>
              )}
              <Link href={`/regulations/${id}/amendment`}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
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
                  } catch (e) { toast.error(e instanceof ApiError ? e.message : "凍結失敗"); }
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
              toast.error(e instanceof ApiError ? e.message : "操作失敗");
            } finally { setWfActionLoading(false); }
          }}
        />
      )}
    </>
  );
}
