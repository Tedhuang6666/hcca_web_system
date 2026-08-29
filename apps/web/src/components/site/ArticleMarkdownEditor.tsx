"use client";

import { Eye, ImagePlus, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { siteApi } from "@/lib/api/site";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import ArticleMarkdown from "./ArticleMarkdown";

export default function ArticleMarkdownEditor({
  value,
  onChange,
  rows = 18,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const [preview, setPreview] = useState(false);
  const [showImageTools, setShowImageTools] = useState(false);
  const [imageAlt, setImageAlt] = useState("");
  const [imageWidth, setImageWidth] = useState("960");

  const insertImage = (url: string, filename?: string) => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    const label = (imageAlt.trim() || filename || "文章圖片").replaceAll("|", "");
    const width = Number(imageWidth);
    const size = Number.isFinite(width) && width > 0 ? `|w=${Math.min(width, 1600)}` : "";
    onChange(`${value.trimEnd()}\n\n![${label}${size}](${cleanUrl})\n`);
    setImageAlt("");
    toast.success("圖片已插入文章");
  };

  return (
    <div className="article-editor">
      <div className="article-editor-toolbar">
        <div className="flex gap-1">
          <button type="button" className="btn btn-sm" onClick={() => setPreview(false)} aria-pressed={!preview}>
            <Pencil size={13} aria-hidden /> 撰寫
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPreview(true)} aria-pressed={preview}>
            <Eye size={13} aria-hidden /> 預覽
          </button>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setShowImageTools((current) => !current)} aria-expanded={showImageTools}>
          <ImagePlus size={14} aria-hidden /> {showImageTools ? "收合圖片工具" : "加入照片"}
        </button>
      </div>

      {showImageTools && (
        <div className="article-editor-images">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <label className="text-xs text-[var(--text-secondary)]">
              圖片說明
              <input className="input mt-1 w-full" value={imageAlt} onChange={(event) => setImageAlt(event.target.value)} placeholder="例如：外送地址填寫範例" />
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              顯示寬度
              <input className="input mt-1 w-full" value={imageWidth} onChange={(event) => setImageWidth(event.target.value)} inputMode="numeric" placeholder="960" />
            </label>
          </div>
          <AnimatedFileUpload
            accept="image/png,image/jpeg,image/gif,image/webp"
            label="拖曳照片到這裡"
            hint="支援點擊選取或貼上圖片；上傳後會自動插入文章末端"
            onUpload={(file, reportProgress) => siteApi.uploadImage(file, reportProgress)}
            onUploaded={(uploaded) => insertImage(uploaded.url, uploaded.filename)}
          />
          <p className="text-xs text-[var(--text-muted)]">也可以直接在 Markdown 使用 `![圖片說明](圖片網址)`。</p>
        </div>
      )}

      {preview ? (
        <div className="article-editor-preview">
          {value.trim() ? <ArticleMarkdown markdown={value} /> : <span className="text-sm text-[var(--text-muted)]">尚未輸入文章內容</span>}
        </div>
      ) : (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="input article-editor-textarea"
          rows={rows}
          placeholder="# 文章標題\n\n文章開頭摘要...\n\n## 第一個重點\n\n內容與圖片..."
        />
      )}
    </div>
  );
}
