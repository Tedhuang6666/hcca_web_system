"use client";

import { BarChart3, Bold, Eye, Heading2, ImagePlus, List, Pencil, Table2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { ArticleChartSpec } from "@/lib/article-charts";
import { siteApi } from "@/lib/api/site";
import { apiErrorMessage, petitionsApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import ArticleMarkdown from "./ArticleMarkdown";

type GalleryDraftPhoto = {
  url: string;
  filename: string;
  description: string;
};

type GalleryUploadProgress = {
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  completedBytes: number;
  activeUploads: Array<{ filename: string; fileSize: number; progress: number }>;
};

const GALLERY_UPLOAD_CONCURRENCY = 3;

function currentMonth() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month
    ? `${year}-${month}`
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

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
  const [showGalleryTools, setShowGalleryTools] = useState(false);
  const [showChartTools, setShowChartTools] = useState(false);
  const [chartMonth, setChartMonth] = useState(currentMonth);
  const [chartLoading, setChartLoading] = useState(false);
  const [imageAlt, setImageAlt] = useState("");
  const [imageWidth, setImageWidth] = useState("960");
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryDraftPhoto[]>([]);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryUploadProgress, setGalleryUploadProgress] = useState<GalleryUploadProgress | null>(null);
  const [galleryUploadErrors, setGalleryUploadErrors] = useState<string[]>([]);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const latestValueRef = useRef(value);
  const insertionPointRef = useRef<{ start: number; end: number } | null>(null);
  latestValueRef.current = value;

  const replaceRange = (
    start: number,
    end: number,
    insertion: string,
    selectionStart = insertion.length,
    selectionEnd = selectionStart,
  ) => {
    const current = latestValueRef.current;
    const safeStart = Math.max(0, Math.min(start, current.length));
    const safeEnd = Math.max(safeStart, Math.min(end, current.length));
    const nextValue = `${current.slice(0, safeStart)}${insertion}${current.slice(safeEnd)}`;
    const nextSelection = {
      start: safeStart + selectionStart,
      end: safeStart + selectionEnd,
    };
    latestValueRef.current = nextValue;
    insertionPointRef.current = nextSelection;
    onChange(nextValue);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(nextSelection.start, nextSelection.end);
    });
  };

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    if (preview) return;
    const current = latestValueRef.current;
    const point = insertionPointRef.current ?? { start: current.length, end: current.length };
    const start = Math.max(0, Math.min(point.start, current.length));
    const end = Math.max(start, Math.min(point.end, current.length));
    const selected = current.slice(start, end) || placeholder;
    const insertion = `${before}${selected}${after}`;
    replaceRange(start, end, insertion, before.length, before.length + selected.length);
  };

  const insertHeading = () => {
    if (preview) return;
    const current = latestValueRef.current;
    const point = insertionPointRef.current ?? { start: current.length, end: current.length };
    const lineStart = current.lastIndexOf("\n", Math.max(point.start - 1, 0)) + 1;
    const nextBreak = current.indexOf("\n", point.start);
    const lineEnd = nextBreak < 0 ? current.length : nextBreak;
    const content = current.slice(lineStart, lineEnd).replace(/^#{1,6}\s*/u, "");
    const heading = `## ${content || "段落標題"}`;
    if (content) {
      replaceRange(lineStart, lineEnd, heading);
    } else {
      replaceRange(lineStart, lineEnd, heading, 3, heading.length);
    }
  };

  const insertListItem = () => {
    if (preview) return;
    const current = latestValueRef.current;
    const point = insertionPointRef.current ?? { start: current.length, end: current.length };
    const start = Math.max(0, Math.min(point.start, current.length));
    const end = Math.max(start, Math.min(point.end, current.length));
    const lineStart = current.lastIndexOf("\n", Math.max(start - 1, 0)) + 1;
    const endBreak = current.indexOf("\n", end);
    const lineEnd = endBreak < 0 ? current.length : endBreak;
    const selectedLines = current.slice(lineStart, end > start ? Math.max(end, lineEnd) : lineEnd);
    const insertion = selectedLines
      .split("\n")
      .map((line) => `- ${line.replace(/^(?:[-*+] |\d+\. )/u, "")}`)
      .join("\n");
    replaceRange(lineStart, end > start ? Math.max(end, lineEnd) : lineEnd, insertion);
  };

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
    latestValueRef.current = nextValue;
    insertionPointRef.current = { start: caretPosition, end: caretPosition };
    onChange(nextValue);
    setImageAlt("");
    toast.success("圖片已插入游標位置");
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(caretPosition, caretPosition);
    });
  };

  const insertBlock = (block: string) => {
    const current = latestValueRef.current;
    const point = insertionPointRef.current ?? { start: current.length, end: current.length };
    const start = Math.max(0, Math.min(point.start, current.length));
    const end = Math.max(start, Math.min(point.end, current.length));
    const before = current.slice(0, start);
    const after = current.slice(end);
    const prefix = before ? (before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n") : "";
    const suffix = after ? (after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n") : "\n";
    replaceRange(start, end, `${prefix}${block}${suffix}`);
  };

  const uploadGalleryFiles = async (files: File[]) => {
    if (!files.length || galleryUploading) return;
    setGalleryUploading(true);
    setGalleryUploadErrors([]);
    const errors: string[] = [];
    const activeUploads = new Map<number, { filename: string; fileSize: number; progress: number }>();
    const uploadedPhotos: Array<GalleryDraftPhoto | undefined> = new Array(files.length);
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    let completedFiles = 0;
    let completedBytes = 0;
    let nextFileIndex = 0;

    const reportProgress = () => {
      setGalleryUploadProgress({
        totalFiles: files.length,
        completedFiles,
        totalBytes,
        completedBytes,
        activeUploads: Array.from(activeUploads.values()),
      });
    };

    const uploadNext = async () => {
      while (nextFileIndex < files.length) {
        const fileIndex = nextFileIndex;
        nextFileIndex += 1;
        const file = files[fileIndex];
        activeUploads.set(fileIndex, { filename: file.name, fileSize: file.size, progress: 0 });
        reportProgress();

        try {
          const uploaded = await siteApi.uploadImage(file, (progress) => {
            activeUploads.set(fileIndex, { filename: file.name, fileSize: file.size, progress });
            reportProgress();
          });
          uploadedPhotos[fileIndex] = {
            url: uploaded.url,
            filename: file.name,
            description: "",
          };
        } catch (error) {
          errors.push(`${file.name}：${apiErrorMessage(error, "上傳失敗")}`);
        } finally {
          activeUploads.delete(fileIndex);
          completedFiles += 1;
          completedBytes += file.size;
          reportProgress();
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(GALLERY_UPLOAD_CONCURRENCY, files.length) }, () => uploadNext()),
    );

    setGalleryPhotos((current) => [
      ...current,
      ...uploadedPhotos.filter((photo): photo is GalleryDraftPhoto => photo !== undefined),
    ]);

    setGalleryUploading(false);
    setGalleryUploadProgress(null);
    if (errors.length) {
      setGalleryUploadErrors(errors);
      toast.error(`有 ${errors.length} 張照片上傳失敗，其餘照片已保留`);
    } else {
      toast.success(`已上傳 ${files.length} 張照片`);
    }
  };

  const insertGallery = () => {
    if (galleryPhotos.length < 2 || galleryUploading) return;
    const photos = galleryPhotos.map(({ url, description }) => ({
      url,
      description: description.trim(),
    }));
    const block = `\`\`\`hcca-gallery\n${JSON.stringify(photos, null, 2)}\n\`\`\``;
    insertBlock(block);
    setGalleryPhotos([]);
    setGalleryUploadErrors([]);
    setShowGalleryTools(false);
    toast.success("圖片集已插入文章");
  };

  const insertChartTemplate = (type: ArticleChartSpec["type"]) => {
    const chart: ArticleChartSpec = {
      type,
      title: type === "pie" ? "圓餅圖標題" : "長條圖標題",
      description: "請補充統計期間與數據口徑。",
      unit: "件",
      data: [
        { label: "項目一", value: 0 },
        { label: "項目二", value: 0 },
      ],
    };
    const fence = String.fromCharCode(96).repeat(3);
    insertBlock(fence + "hcca-chart\n" + JSON.stringify(chart, null, 2) + "\n" + fence);
    toast.success(type === "pie" ? "已插入圓餅圖範本，請填入核實數據" : "已插入長條圖範本，請填入核實數據");
  };

  const insertPetitionChart = async () => {
    setChartLoading(true);
    try {
      const stats = await petitionsApi.monthlyStats(chartMonth);
      const chart = `\`\`\`hcca-petition-chart\n${JSON.stringify(stats, null, 2)}\n\`\`\``;
      insertBlock(chart);
      toast.success(`已插入 ${chartMonth} 陳情統計圖表`);
    } catch (error) {
      toast.error(apiErrorMessage(error, "讀取月份統計失敗；請確認陳情統計權限"));
    } finally {
      setChartLoading(false);
    }
  };

  const galleryUploadProgressValue = galleryUploadProgress
    ? (() => {
      const activeBytes = galleryUploadProgress.activeUploads.reduce(
        (total, upload) => total + upload.fileSize * upload.progress,
        0,
      );
      const total = galleryUploadProgress.totalBytes || galleryUploadProgress.totalFiles;
      const completed = galleryUploadProgress.totalBytes
        ? galleryUploadProgress.completedBytes
        : galleryUploadProgress.completedFiles;
      const active = galleryUploadProgress.totalBytes
        ? activeBytes
        : galleryUploadProgress.activeUploads.reduce((sum, upload) => sum + upload.progress, 0);
      return Math.round(((completed + active) / total) * 100);
    })()
    : 0;

  return (
    <div className="article-editor">
      <div className="article-editor-toolbar">
        <div className="article-editor-mode-switch" role="group" aria-label="文章編輯模式">
          <button type="button" className="article-editor-tool" onClick={() => setPreview(false)} aria-pressed={!preview}>
            <Pencil size={13} aria-hidden /> 撰寫
          </button>
          <button type="button" className="article-editor-tool" onClick={() => setPreview(true)} aria-pressed={preview}>
            <Eye size={13} aria-hidden /> 預覽
          </button>
        </div>
        <div className="article-editor-mode-switch">
          <button type="button" className="article-editor-tool" onClick={() => setShowChartTools((current) => !current)} aria-expanded={showChartTools} disabled={preview} title={preview ? "請切回撰寫模式插入圖表" : undefined}>
            <BarChart3 size={14} aria-hidden /> {showChartTools ? "收合圖表工具" : "插入圖表"}
          </button>
          <button type="button" className="article-editor-tool" onClick={() => setShowImageTools((current) => !current)} aria-expanded={showImageTools}>
            <ImagePlus size={14} aria-hidden /> {showImageTools ? "收合圖片工具" : "加入照片"}
          </button>
          <button type="button" className="article-editor-tool" onClick={() => setShowGalleryTools((current) => !current)} aria-expanded={showGalleryTools && !preview} disabled={preview} title={preview ? "請切回撰寫模式建立圖片集" : undefined}>
            <ImagePlus size={14} aria-hidden /> {showGalleryTools ? "收合圖片集" : "建立圖片集"}
          </button>
        </div>
      </div>

      {!preview && (
        <div className="article-editor-format-toolbar" role="toolbar" aria-label="Markdown 格式工具">
          <button type="button" className="article-editor-tool" title="為選取文字加上粗體格式" onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection("**", "**", "粗體文字")}>
            <Bold size={15} aria-hidden /> 粗體
          </button>
          <button type="button" className="article-editor-tool" title="建立段落標題" onMouseDown={(event) => event.preventDefault()} onClick={insertHeading}>
            <Heading2 size={15} aria-hidden /> 小標題
          </button>
          <button type="button" className="article-editor-tool" title="建立項目清單" onMouseDown={(event) => event.preventDefault()} onClick={insertListItem}>
            <List size={15} aria-hidden /> 項目清單
          </button>
          <button type="button" className="article-editor-tool" title="插入三欄表格範本" onMouseDown={(event) => event.preventDefault()} onClick={() => insertBlock("| 項目 | 執行情形 | 備註 |\n| --- | --- | --- |\n| 項目名稱 | 完成內容 | 補充說明 |\n")}>
            <Table2 size={15} aria-hidden /> 表格範本
          </button>
        </div>
      )}

      {showChartTools && !preview && (
        <div className="article-editor-chart-tools">
          <div>
            <h3>新增文章圖表</h3>
            <p>支援圓餅圖與長條圖；插入後編輯 JSON 的標題、項目與數值，並在預覽中確認。</p>
            <div className="article-editor-chart-template-actions">
              <button type="button" className="btn btn-secondary min-h-11" onClick={() => insertChartTemplate("pie")}>
                插入圓餅圖範本
              </button>
              <button type="button" className="btn btn-secondary min-h-11" onClick={() => insertChartTemplate("bar")}>
                插入長條圖範本
              </button>
            </div>
          </div>
          <label>
            統計月份
            <input type="month" value={chartMonth} onChange={(event) => setChartMonth(event.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => void insertPetitionChart()} disabled={chartLoading || !chartMonth}>
            <BarChart3 size={15} aria-hidden /> {chartLoading ? "載入統計中…" : "插入陳情月統計"}
          </button>
        </div>
      )}

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

      {showGalleryTools && !preview && (
        <div className="article-editor-images article-editor-gallery-tools">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">建立文章圖片集</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              可一次選取多張照片，也能分批追加。上傳順序就是輪播順序；每張照片都能加上簡短描述。
            </p>
          </div>
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            className="sr-only"
            disabled={galleryUploading}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void uploadGalleryFiles(files);
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-secondary min-h-11"
              onClick={() => galleryInputRef.current?.click()}
              disabled={galleryUploading}
            >
              <ImagePlus size={16} aria-hidden /> {galleryUploading ? `同時上傳 ${galleryUploadProgress?.activeUploads.length ?? 0} 張…` : "選擇多張照片"}
            </button>
            <span className="text-xs text-[var(--text-muted)]" aria-live="polite">
              {galleryUploadProgress
                ? `已完成 ${galleryUploadProgress.completedFiles} / ${galleryUploadProgress.totalFiles} 張，${galleryUploadProgress.activeUploads.length} 張上傳中（${galleryUploadProgressValue}%）`
                : `已加入 ${galleryPhotos.length} 張照片`}
            </span>
          </div>
          {galleryUploadProgress && (
            <div
              className="article-editor-gallery-progress"
              role="progressbar"
              aria-label="照片上傳進度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={galleryUploadProgressValue}
            >
              <span style={{ transform: `scaleX(${galleryUploadProgressValue / 100})` }} />
            </div>
          )}
          {galleryUploadErrors.length > 0 && (
            <div className="text-sm text-[var(--danger)]" role="alert">
              <p>以下照片沒有上傳成功，請重新選取後再上傳：</p>
              <ul className="mt-1 list-disc pl-5">
                {galleryUploadErrors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
              </ul>
            </div>
          )}
          {galleryPhotos.length > 0 && (
            <ul className="article-editor-gallery-photos" aria-label="圖片集照片順序與描述">
              {galleryPhotos.map((photo, index) => (
                <li className="article-editor-gallery-photo" key={`${photo.url}-${index}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={uploadUrl(photo.url)} alt="" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-[var(--text-muted)]" title={photo.filename}>{photo.filename}</p>
                    <label className="mt-1 block text-xs text-[var(--text-secondary)]">
                      第 {index + 1} 張照片描述（選填）
                      <input
                        className="input mt-1 w-full"
                        maxLength={120}
                        value={photo.description}
                        disabled={galleryUploading}
                        placeholder="例如：活動現場的報到情形"
                        onChange={(event) => setGalleryPhotos((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, description: event.target.value } : item,
                        ))}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="article-editor-gallery-remove"
                    aria-label={`移除第 ${index + 1} 張照片：${photo.filename}`}
                    disabled={galleryUploading}
                    onClick={() => setGalleryPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <X size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary min-h-11" onClick={insertGallery} disabled={galleryPhotos.length < 2 || galleryUploading}>
              插入圖片集（{galleryPhotos.length} 張）
            </button>
            {galleryPhotos.length < 2 && <span className="text-xs text-[var(--text-muted)]">請至少上傳兩張照片</span>}
          </div>
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
