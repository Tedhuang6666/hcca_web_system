"use client";

import { Eye, ImagePlus, Pencil } from "lucide-react";
import { useRef, useState } from "react";
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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const latestValueRef = useRef(value);
  const insertionPointRef = useRef<{ start: number; end: number } | null>(null);
  latestValueRef.current = value;

  const insertImage = (url: string, filename?: string) => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    if (preview) {
      toast.error("請先切回撰寫模式，把游標放在要插入的位置");
      return;
    }
    const label = (imageAlt.trim() || filename || "文章圖片").replaceAll("|", "");
    const width = Number(imageWidth);
    const size = Number.isFinite(width) && width > 0 ? `|w=${Math.min(width, 1600)}` : "";
    const block = `![${label}${size}](${cleanUrl})`;
    const current = latestValueRef.current;
    const point = insertionPointRef.current ?? { start: current.length, end: current.length };
    const start = Math.max(0, Math.min(point.start, current.length));
    const end = Math.max(start, Math.min(point.end, current.length));
    const before = current.slice(0, start);
    const after = current.slice(end);
    const prefix = before
      ? before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
      : "";
    const suffix = after
      ? after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n"
      : "\n";
    const nextValue = `${before}${prefix}${block}${suffix}${after}`;
    const caretPosition = start + prefix.length + block.length;
    insertionPointRef.current = { start: caretPosition, end: caretPosition };
    onChange(nextValue);
    setImageAlt("");
    toast.success("圖片已插入游標位置");
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(caretPosition, caretPosition);
    });
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
            disabled={preview}
            label="拖曳照片到這裡"
            hint={preview ? "請切回撰寫模式後再上傳，圖片會插入游標位置" : "先在文章內文放置游標，再上傳照片"}
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
          ref={editorRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => {
            insertionPointRef.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
          }}
          onSelect={(event) => {
            insertionPointRef.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            };
          }}
          className="input article-editor-textarea"
          rows={rows}
          placeholder="# 文章標題\n\n文章開頭摘要...\n\n## 第一個重點\n\n內容與圖片..."
        />
      )}
    </div>
  );
}
