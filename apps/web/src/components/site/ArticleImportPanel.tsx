"use client";

import Image from "next/image";
import { CheckCircle2, FileUp, Rocket, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { siteApi } from "@/lib/api/site";
import { uploadUrl } from "@/lib/config";
import type { PublicSitePageOut } from "@/lib/types";
import {
  articleSummaryFromMarkdown,
  articleTitleFromMarkdown,
} from "@/lib/article-utils";
import { LUNCH_GUIDE_MARKDOWN } from "@/lib/article-content";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import ArticleMarkdownEditor from "./ArticleMarkdownEditor";

export default function ArticleImportPanel({ onImported }: { onImported?: (page: PublicSitePageOut) => void }) {
  const [markdown, setMarkdown] = useState("");
  const [titleOverride, setTitleOverride] = useState("");
  const [summaryOverride, setSummaryOverride] = useState("");
  const [slug, setSlug] = useState("new-article");
  const [coverUrl, setCoverUrl] = useState("");
  const [coverAlt, setCoverAlt] = useState("");
  const [showInNav, setShowInNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishedHref, setPublishedHref] = useState("");
  const markdownFileRef = useRef<HTMLInputElement>(null);

  const inferredTitle = articleTitleFromMarkdown(markdown);
  const inferredSummary = articleSummaryFromMarkdown(markdown);
  const title = titleOverride.trim() || inferredTitle;
  const summary = summaryOverride.trim() || inferredSummary;

  const loadExample = () => {
    setMarkdown(LUNCH_GUIDE_MARKDOWN);
    setTitleOverride("");
    setSummaryOverride("");
    setSlug("zhuzhong-lunch-guide");
    setPublishedHref("");
  };

  const importMarkdownFile = async (file: File) => {
    if (!file.name.toLocaleLowerCase().endsWith(".md") && !file.name.toLocaleLowerCase().endsWith(".txt")) {
      toast.error("請選擇 Markdown（.md）或純文字（.txt）檔案");
      return;
    }
    setMarkdown(await file.text());
    setTitleOverride("");
    setSummaryOverride("");
    setPublishedHref("");
    toast.success(`已載入 ${file.name}`);
  };

  const importArticle = async () => {
    if (!title) {
      toast.error("請在 Markdown 第一行使用 # 標題，或手動填寫文章標題");
      return;
    }
    if (!markdown.trim()) {
      toast.error("請貼上文章 Markdown 內容");
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(slug.trim())) {
      toast.error("Slug 只能使用小寫英文字母、數字與連字號");
      return;
    }

    setBusy(true);
    try {
      const created = await siteApi.createPage({
        slug: slug.trim(),
        title,
        summary: summary || null,
        body_md: markdown.trim(),
        page_kind: "article",
        layout_config: {},
        content_blocks: {},
        cover_image_url: coverUrl.trim() || null,
        cover_image_alt: coverUrl.trim() ? coverAlt.trim() || title : null,
        seo_title: title,
        seo_description: summary || null,
        nav_label: null,
        nav_order: 0,
        sort_order: 0,
        show_in_nav: showInNav,
        is_published: true,
      });
      setPublishedHref(`/articles/${encodeURIComponent(created.slug)}`);
      toast.success("文章已匯入並立即上線");
      onImported?.(created);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文章匯入失敗；請確認 slug 尚未使用");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card overflow-hidden border-[var(--primary)]/30" aria-labelledby="article-import-title">
      <div className="border-b border-[var(--border)] bg-[var(--primary-dim)] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--bg-surface)] text-[var(--primary)]">
              <Rocket size={19} aria-hidden />
            </span>
            <div>
              <h2 id="article-import-title" className="font-semibold text-[var(--text-primary)]">快速匯入文章並上線</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                貼上完整 Markdown，系統會自動設定文章類別、標題、摘要、SEO 與發布狀態；按下按鈕後，文章會直接出現在公開文章專欄。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={markdownFileRef}
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importMarkdownFile(file);
                event.target.value = "";
              }}
            />
            <button type="button" className="btn btn-secondary shrink-0" onClick={() => markdownFileRef.current?.click()}>
              <FileUp size={15} aria-hidden /> 匯入 .md 檔
            </button>
            <button type="button" className="btn btn-secondary shrink-0" onClick={loadExample}>
              <Sparkles size={15} aria-hidden /> 帶入訂餐指南範例
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-4">
          <ArticleMarkdownEditor value={markdown} onChange={setMarkdown} rows={16} />
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-[var(--text-secondary)]">
              文章標題
              <input className="input mt-1 w-full" value={titleOverride || inferredTitle} onChange={(event) => setTitleOverride(event.target.value)} placeholder="會自動讀取 Markdown 第一個 # 標題" />
            </label>
            <label className="block text-sm font-medium text-[var(--text-secondary)]">
              對外摘要
              <textarea className="input mt-1 min-h-11 w-full" value={summaryOverride || inferredSummary} onChange={(event) => setSummaryOverride(event.target.value)} placeholder="會自動讀取文章首段" />
            </label>
          </div>
        </div>

        <aside className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)]">
              公開網址 Slug
              <input className="input mt-1 w-full" value={slug} onChange={(event) => setSlug(event.target.value)} spellCheck={false} />
            </label>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">/articles/{slug || "…"}</p>
          </div>

          <label className="block text-sm font-medium text-[var(--text-secondary)]">
            封面照片網址（選填）
            <input className="input mt-1 w-full" value={coverUrl} onChange={(event) => setCoverUrl(event.target.value)} placeholder="上傳照片或貼上 https://…" />
          </label>
          <label className="block text-sm font-medium text-[var(--text-secondary)]">
            封面替代文字
            <input className="input mt-1 w-full" value={coverAlt} onChange={(event) => setCoverAlt(event.target.value)} placeholder="照片內容說明" />
          </label>
          <AnimatedFileUpload
            accept="image/png,image/jpeg,image/gif,image/webp"
            label="上傳封面照片"
            hint="上傳後會自動填入封面網址"
            onUpload={(file, reportProgress) => siteApi.uploadImage(file, reportProgress)}
            onUploaded={(uploaded) => {
              setCoverUrl(uploaded.url);
              if (!coverAlt) setCoverAlt(uploaded.filename);
              toast.success("封面照片已上傳");
            }}
          />
          {uploadUrl(coverUrl) && (
            <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
              <Image src={uploadUrl(coverUrl)} alt={coverAlt || "封面預覽"} fill unoptimized sizes="304px" className="object-cover" />
            </div>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={showInNav} onChange={(event) => setShowInNav(event.target.checked)} className="h-4 w-4" />
            同時放入公開導覽列
          </label>
          <button type="button" className="btn btn-primary min-h-11 w-full" onClick={() => void importArticle()} disabled={busy}>
            <Rocket size={16} aria-hidden /> {busy ? "匯入中…" : "匯入並立即上線"}
          </button>
          {publishedHref && (
            <a href={publishedHref} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--success-border)] bg-[var(--success-dim)] px-3 text-sm font-semibold text-[var(--success)]">
              <CheckCircle2 size={16} aria-hidden /> 開啟已上線文章
            </a>
          )}
          <p className="text-xs leading-5 text-[var(--text-muted)]">匯入會建立一篇新的文章。若 slug 已存在，請修改網址後再試。</p>
        </aside>
      </div>
    </section>
  );
}
