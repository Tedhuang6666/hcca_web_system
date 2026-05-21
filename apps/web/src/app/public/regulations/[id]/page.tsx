import Link from "next/link";
import type { Metadata } from "next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  ArticleClearHighlightButton,
  ArticleCopyButton,
  ArticleHashWrapper,
} from "@/components/regulations/ArticleHashAnchor";
import { serverApiUrl } from "@/lib/config";
import { formatGeneratedHistoryRows, splitLegislativeHistory } from "@/lib/regulationHistory";
import {
  ARTICLE_IS_STRUCTURAL,
  STRUCTURAL_INDENT,
  computeArticleDisplayLabels,
  normalizeArticleType,
} from "@/lib/regulationStructure";
import {
  SOCIAL_IMAGE,
  SOCIAL_SHARE_TITLE,
  SOCIAL_SITE_NAME,
  socialDescription,
} from "@/lib/social-metadata";

type RegulationArticleOut = {
  id: string;
  sort_index: number;
  article_type: string;
  title: string;
  subtitle: string;
  content: string | null;
  is_deleted: boolean;
  frozen_by: string | null;
  created_at: string;
  updated_at: string;
};

type RegulationRevisionOut = {
  id: string;
  version: number;
  change_brief: string;
  is_total_amendment: boolean;
  content_snapshot: string;
  resolution_link: string | null;
  amended_at: string;
  amended_by: string;
};

type RegulationOut = {
  id: string;
  title: string;
  category: string;
  content: string;
  preface: string | null;
  version: number;
  is_active: boolean;
  workflow_status: string;
  workflow_note: string | null;
  legislative_history: string | null;
  org_id: string;
  created_by: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  articles: RegulationArticleOut[];
  revisions: RegulationRevisionOut[];
};

async function fetchReg(id: string): Promise<RegulationOut | null> {
  const res = await fetch(serverApiUrl(`/regulations/${encodeURIComponent(id)}`), {
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;
  return res.json();
}

const publicRegulationHref = (reg: { title: string }) =>
  `/public/regulations/${encodeURIComponent(reg.title)}`;

const regulationHref = (reg: { title: string }) => `/regulations/${encodeURIComponent(reg.title)}`;

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const reg = await fetchReg(id);
  const regTitle = reg?.title ?? "法規";
  const desc = socialDescription(
    "法規",
    reg ? `${reg.title}${reg.preface ? `｜${reg.preface.slice(0, 80)}` : ""}` : regTitle,
    "公開法規條文與沿革查詢。",
  );
  return {
    title: SOCIAL_SHARE_TITLE,
    description: desc,
    openGraph: {
      title: SOCIAL_SHARE_TITLE,
      description: desc,
      type: "article",
      url: reg ? publicRegulationHref(reg) : `/public/regulations/${encodeURIComponent(id)}`,
      siteName: SOCIAL_SITE_NAME,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: SOCIAL_SHARE_TITLE,
      description: desc,
      images: [SOCIAL_IMAGE.url],
    },
    alternates: {
      canonical: reg ? publicRegulationHref(reg) : `/public/regulations/${encodeURIComponent(id)}`,
    },
  };
}

function isStructural(t: string) {
  const norm = normalizeArticleType(t);
  return ARTICLE_IS_STRUCTURAL[norm] ?? false;
}

export default async function PublicRegulationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const reg = await fetchReg(id);
  if (!reg) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: "var(--danger)" }}>
        找不到此法規或尚未公開
      </div>
    );
  }

  const articles = [...(reg.articles ?? []).filter((a) => !a.is_deleted)]
    .sort((a, b) => a.sort_index - b.sort_index);
  const structural = articles.filter((a) => isStructural(a.article_type));
  const displayLabels = computeArticleDisplayLabels(articles);
  const sortedRevs = [...(reg.revisions ?? [])].sort(
    (a, b) => new Date(a.amended_at).getTime() - new Date(b.amended_at).getTime(),
  );
  const manualHistoryRows = splitLegislativeHistory(reg.legislative_history);
  const generatedHistoryRows = formatGeneratedHistoryRows(sortedRevs);
  const publicHref = publicRegulationHref(reg);

  const highlight = (text: string) => {
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")})`, "ig"));
    return parts.map((p, i) => {
      if (p.toLowerCase() === q.toLowerCase()) {
        return (
          <mark
            key={i}
            style={{
              background: "rgba(250,204,21,0.18)",
              color: "var(--text-primary)",
              padding: "0 2px",
              borderRadius: 3,
              border: "1px solid rgba(250,204,21,0.22)",
            }}
          >
            {p}
          </mark>
        );
      }
      return <span key={i}>{p}</span>;
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-start justify-between gap-3 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
            <Link href="/public/regulations" className="hover:underline" style={{ color: "var(--text-muted)" }}>
              公開法規
            </Link>
            <span> / </span>
            <span className="truncate">{reg.title}</span>
          </div>
          <h1
            className="break-words text-xl font-semibold"
            style={{
              color: "var(--text-primary)",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {!reg.is_active && <span style={{ color: "var(--danger)" }}>(失效) </span>}
            {highlight(reg.title)}
          </h1>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            {reg.published_at ? `公布 ${new Date(reg.published_at).toLocaleDateString("zh-TW")}` : "未標示公布日期"}
            {"　·　"}版本 v{reg.version}
            {"　·　"}更新 {new Date(reg.updated_at).toLocaleDateString("zh-TW")}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-start lg:justify-end">
          <Link
            href={`${publicHref}${q ? `?q=${encodeURIComponent(q)}` : ""}`}
            className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            重新整理
          </Link>
          <Link
            href={regulationHref(reg)}
            className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80"
            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}
          >
            管理端檢視
          </Link>
          {sortedRevs.length >= 2 && (
            <Link
              href={`${publicHref}/compare`}
              className="px-3 py-1.5 rounded-lg text-xs hover:opacity-80"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              版本並排比對
            </Link>
          )}
        </div>
      </div>

      {!reg.is_active && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <p className="text-sm" style={{ color: "#ef4444" }}>
            本法規已停用，僅供歷史查閱，目前不具法律效力。
          </p>
        </div>
      )}

      {reg.preface && (
        <div className="card p-5 text-sm italic" style={{ color: "var(--text-muted)" }}>
          {q ? highlight(reg.preface) : reg.preface}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4 items-start">
        <article className="card p-6 space-y-6">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
              法規內容（摘要/前言/附註）
            </h2>
            {reg.content ? (
              <div className="prose prose-sm max-w-none" style={{ color: "var(--text-primary)" }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{reg.content}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                此法規未提供 Markdown 內容，請參考下方條文結構。
              </p>
            )}
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
              條文
            </h2>
            {articles.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                尚無條文
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {articles.map((a) => {
                  const frozen = Boolean(a.frozen_by);
                  const indent = STRUCTURAL_INDENT[normalizeArticleType(a.article_type)] ?? 0;
                  const structural = isStructural(a.article_type);
                  const label = displayLabels[a.id] ?? "";
                  return (
                    <ArticleHashWrapper
                      key={a.id}
                      articleId={a.id}
                      className="py-4 px-2 scroll-mt-24"
                      style={{
                        marginLeft: `${indent * 12}px`,
                        ...(frozen ? { borderLeft: "3px solid #fb923c", paddingLeft: 12, background: "rgba(251,146,60,0.04)" } : {}),
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className={structural ? "text-base font-bold" : "text-sm font-semibold"}
                            style={{ color: "var(--text-primary)" }}
                          >
                            {label ? highlight(label) : (a.title ? highlight(a.title) : "（條文）")}
                          </p>
                          {a.subtitle && (
                            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                              {highlight(a.subtitle)}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <ArticleClearHighlightButton />
                          <ArticleCopyButton ariaLabel={`複製${label || a.title || "條文"}連結`} />
                        </div>
                      </div>
                      {frozen && (
                        <p className="text-xs mt-2" style={{ color: "#fb923c" }}>
                          凍結依據：{highlight(a.frozen_by ?? "")}
                        </p>
                      )}
                      {a.content && (
                        <pre className="mt-3 whitespace-pre-wrap text-sm" style={{ color: "var(--text-primary)", lineHeight: 1.9, fontFamily: "inherit" }}>
                          {q ? highlight(a.content) : a.content}
                        </pre>
                      )}
                    </ArticleHashWrapper>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
              沿革（修訂歷程）
            </h2>
            {manualHistoryRows.length > 0 && (
              <div
                className="mb-4 space-y-1 rounded-xl p-4 text-sm"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  lineHeight: 1.8,
                  overflowWrap: "anywhere",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {manualHistoryRows.map((row, index) => <p key={`${index}-${row}`}>{row}</p>)}
              </div>
            )}
            {sortedRevs.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                尚無沿革紀錄
              </p>
            ) : (
              <ol className="space-y-3">
                {[...sortedRevs].reverse().map((rev, idx) => (
                  <li key={rev.id} className="rounded-xl p-4" style={{ border: "1px solid var(--border)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          v{rev.version} · {new Date(rev.amended_at).toLocaleDateString("zh-TW")}
                        </p>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                          {generatedHistoryRows[sortedRevs.findIndex((item) => item.id === rev.id)] ?? rev.change_brief}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {idx < sortedRevs.length - 1 && (
                          <Link
                            href={`${publicHref}/compare?from=${sortedRevs[sortedRevs.length - 1 - (idx + 1)]?.version}&to=${rev.version}`}
                            className="text-xs px-3 py-1.5 rounded-lg hover:opacity-80"
                            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}
                          >
                            與前版比對
                          </Link>
                        )}
                      </div>
                    </div>
                    {rev.resolution_link && (
                      <div className="mt-2 text-xs">
                        <a href={rev.resolution_link} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--primary)" }}>
                          查看相關決議/依據
                        </a>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </article>

        <aside className="space-y-3 lg:sticky lg:top-[88px]">
          <div className="card overflow-hidden">
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                條文目錄
              </p>
            </div>
            <div className="p-3 space-y-2">
              <form action={publicHref} className="flex gap-2">
                <input
                  name="q"
                  defaultValue={q}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none flex-1"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  placeholder="關鍵字（之後支援高亮）"
                />
                <button className="text-xs px-3 py-1.5 rounded-lg hover:opacity-80" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                  搜尋
                </button>
              </form>

              <div className="max-h-[55vh] overflow-auto pr-1">
                {structural.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    無結構標題（章/節/編）
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {structural.map((a) => (
                      <li key={a.id}>
                        <a
                          href={`#a-${a.id}`}
                          className="block text-xs px-2 py-1 rounded hover:opacity-80 truncate"
                          style={{ color: "var(--text-secondary)" }}
                          title={a.title}
                        >
                          {a.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="card p-4">
            <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
              分享
            </p>
            <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
              點條文右側的<span style={{ color: "var(--text-secondary)" }}> 複製 </span>按鈕即可取得永久連結；
              收件人開啟連結後會自動跳轉並高亮該條文（3 秒後褪色）。
            </p>
            {!reg.is_active && reg.workflow_note && (
              <p className="text-xs mt-3" style={{ color: "var(--danger)" }}>
                失效依據：{reg.workflow_note}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
