"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { announcementsApi, ApiError } from "@/lib/api";
import type { AnnouncementMediaOut } from "@/lib/types";
import AnnouncementMarkdown from "./AnnouncementMarkdown";

export default function AnnouncementEditor({
  value,
  onChange,
  announcementId,
  media,
  canManageMedia,
  onMediaUploaded,
}: {
  value: string;
  onChange: (value: string) => void;
  announcementId?: string;
  media: AnnouncementMediaOut[];
  canManageMedia: boolean;
  onMediaUploaded?: (media: AnnouncementMediaOut) => void;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [imageWidth, setImageWidth] = useState("720");
  const [uploading, setUploading] = useState(false);

  const previewContent = useMemo(() => ({ markdown: value }), [value]);

  const insertImage = (url: string, filename?: string) => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    const alt = (imageAlt.trim() || filename || "公告圖片").replaceAll("|", "");
    const width = Number(imageWidth);
    const size = Number.isFinite(width) && width > 0 ? `|w=${Math.min(width, 1200)}` : "";
    const snippet = `\n\n![${alt}${size}](${cleanUrl})\n\n`;
    onChange(`${value}${snippet}`);
    setImageUrl("");
    setImageAlt("");
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !announcementId || !canManageMedia) return;
    setUploading(true);
    try {
      const uploaded = await announcementsApi.uploadMedia(announcementId, file);
      onMediaUploaded?.(uploaded);
      insertImage(uploaded.url, uploaded.filename);
      toast.success("圖片已插入公告");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "上傳失敗");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
        <div className="flex gap-1">
          {(["write", "preview"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className="btn btn-sm"
              style={tab === key
                ? { background: "var(--primary-dim)", color: "var(--primary)", borderColor: "var(--border-strong)" }
                : undefined}>
              {key === "write" ? "撰寫" : "預覽"}
            </button>
          ))}
        </div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Markdown
        </span>
      </div>

      {tab === "write" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input min-h-[430px] rounded-none border-0 font-mono text-sm"
          placeholder={"支援 Markdown，例如：\n\n## 標題\n\n公告內容...\n\n![圖片說明|w=640](圖片網址)"}
          style={{ resize: "vertical", background: "var(--bg-surface)" }}
        />
      ) : (
        <div className="min-h-[430px] p-5">
          <AnnouncementMarkdown content={previewContent} />
        </div>
      )}

      <div className="grid gap-3 p-4 md:grid-cols-[1fr_110px_auto]"
        style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          className="input"
          placeholder="圖片 URL"
          aria-label="圖片 URL"
        />
        <input
          value={imageWidth}
          onChange={(e) => setImageWidth(e.target.value)}
          className="input"
          inputMode="numeric"
          placeholder="寬度"
          aria-label="圖片寬度"
        />
        <button type="button" className="btn btn-secondary" onClick={() => insertImage(imageUrl)}>
          插入圖片
        </button>
        <input
          value={imageAlt}
          onChange={(e) => setImageAlt(e.target.value)}
          className="input md:col-span-2"
          placeholder="圖片說明"
          aria-label="圖片說明"
        />
        <label className={`btn btn-ghost ${(!announcementId || !canManageMedia) ? "opacity-50 cursor-not-allowed" : ""}`}>
          {uploading ? "上傳中" : "上傳圖片"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            disabled={!announcementId || !canManageMedia || uploading}
            onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {media.length > 0 && (
        <div className="flex gap-2 overflow-x-auto p-4 pt-0" style={{ background: "var(--bg-elevated)" }}>
          {media.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => insertImage(item.url, item.filename)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              {item.filename}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
