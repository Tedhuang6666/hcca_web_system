"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { ChevronRight, ScanSearch, ShieldAlert } from "lucide-react";

import Modal from "@/components/ui/Modal";
import { authFetch } from "@/lib/api/core";
import { uploadUrl } from "@/lib/config";
import type { MerchandiseSubmissionAdminListItem } from "@/lib/types";
import { formatScanTime } from "@/lib/merchandise-submission-editor";

export function AuthenticatedPreviewImage({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = uploadUrl(src);
    if (!url) {
      setObjectUrl(null);
      return;
    }

    const controller = new AbortController();
    let createdUrl: string | null = null;
    setObjectUrl(null);
    void authFetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`無法載入投稿圖片（HTTP ${response.status}）`);
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => undefined);

    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src]);

  if (!objectUrl) {
    return <div className={`${className ?? ""} animate-pulse`} style={{ ...style, background: "var(--bg-elevated)" }} role="img" aria-label={alt} />;
  }

  // Blob URLs are produced after an authenticated fetch and cannot use Next Image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={objectUrl} alt={alt} className={className} style={style} />;
}

type AIDetectionStatus = NonNullable<
  MerchandiseSubmissionAdminListItem["files"][number]["ai_detection_status"]
> | "unscanned";

type AIDetectionTone = "warning" | "info" | "neutral" | "danger";

const AI_STATUS_CONFIG: Record<
  AIDetectionStatus,
  { label: string; description: string; tone: AIDetectionTone }
> = {
  detected: {
    label: "有明確 AI 來源證據",
    description: "檔案中有生成工具、提示詞或 C2PA 來源證據；仍請搭配投稿內容與人工審核判讀。",
    tone: "warning",
  },
  supporting: {
    label: "有輔助鑑識線索",
    description: "像素層統計或一般來源資訊出現需要複核的線索，不能單獨判定檔案為 AI 生成。",
    tone: "info",
  },
  no_evidence: {
    label: "尚無可靠 AI 證據",
    description: "已檢查可解析的來源資訊與像素結構，但沒有找到可靠線索；這不代表檔案一定不是 AI 生成。",
    tone: "neutral",
  },
  not_applicable: {
    label: "未偵測",
    description: "目前檔案格式不支援 AI / 內容鑑識。",
    tone: "neutral",
  },
  error: {
    label: "偵測失敗",
    description: "分析原始檔時發生問題，請重新上傳檔案或稍後再試。系統不會以失敗結果判定投稿。",
    tone: "danger",
  },
  unscanned: {
    label: "尚未偵測",
    description: "此檔案尚未完成 AI / 內容鑑識。",
    tone: "neutral",
  },
};

const AI_TONE_STYLES: Record<
  AIDetectionTone,
  { borderColor: string; background: string; color: string }
> = {
  warning: {
    borderColor: "var(--warning-border)",
    background: "var(--warning-dim)",
    color: "var(--warning)",
  },
  info: {
    borderColor: "var(--info-border)",
    background: "var(--info-dim)",
    color: "var(--info)",
  },
  neutral: {
    borderColor: "var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
  },
  danger: {
    borderColor: "var(--danger-border)",
    background: "var(--danger-dim)",
    color: "var(--danger)",
  },
};


export function AIEvidencePanel({
  file,
}: {
  file: MerchandiseSubmissionAdminListItem["files"][number];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const evidence = file.ai_detection_evidence ?? [];
  const metadata = file.ai_detection_metadata ?? [];
  const statusKey: AIDetectionStatus = file.ai_detection_status ?? "unscanned";
  const status = AI_STATUS_CONFIG[statusKey];
  const toneStyles = AI_TONE_STYLES[status.tone];
  const isFinding = statusKey === "detected";

  return (
    <>
      <div
        className="mt-2 rounded-lg border p-2.5"
        style={{ borderColor: toneStyles.borderColor, background: toneStyles.background }}
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--bg-surface)", color: toneStyles.color }}
            aria-hidden="true"
          >
            {isFinding ? <ShieldAlert size={14} /> : <ScanSearch size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold" style={{ color: toneStyles.color }}>
              AI / 內容鑑識
            </p>
            <p className="mt-0.5 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
              {status.label}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              {evidence.length > 0 ? `${evidence.length} 項判斷線索` : "尚無判斷線索"}
              {metadata.length > 0 && ` · ${metadata.length} 筆 metadata`}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost min-h-11 shrink-0 px-3 text-xs sm:min-h-8 sm:px-2"
            onClick={() => setIsOpen(true)}
            aria-haspopup="dialog"
          >
            查看詳情
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {isOpen && (
        <Modal title="AI / 內容鑑識詳情" onClose={() => setIsOpen(false)} size="2xl">
          <div className="space-y-5">
            <div
              className="flex items-start gap-3 rounded-lg border p-3"
              style={{ borderColor: toneStyles.borderColor, background: toneStyles.background }}
            >
              <span
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--bg-surface)", color: toneStyles.color }}
                aria-hidden="true"
              >
                {isFinding ? <ShieldAlert size={17} /> : <ScanSearch size={17} />}
              </span>
              <div>
                <p className="text-sm font-semibold" style={{ color: toneStyles.color }}>
                  {status.label}
                </p>
                <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
                  {status.description}
                </p>
              </div>
            </div>

            <section aria-labelledby="ai-file-summary-title">
              <h3 id="ai-file-summary-title" className="text-sm font-semibold">
                檔案摘要
              </h3>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded border p-2.5" style={{ borderColor: "var(--border)" }}>
                  <dt className="text-xs" style={{ color: "var(--text-muted)" }}>檔名</dt>
                  <dd className="mt-1 break-all text-xs font-medium">{file.filename}</dd>
                </div>
                <div className="rounded border p-2.5" style={{ borderColor: "var(--border)" }}>
                  <dt className="text-xs" style={{ color: "var(--text-muted)" }}>檔案格式／大小</dt>
                  <dd className="mt-1 text-xs font-medium">
                    {file.content_type} · {file.file_size.toLocaleString()} bytes
                  </dd>
                </div>
                <div className="rounded border p-2.5" style={{ borderColor: "var(--border)" }}>
                  <dt className="text-xs" style={{ color: "var(--text-muted)" }}>掃描時間</dt>
                  <dd className="mt-1 text-xs font-medium">{formatScanTime(file.ai_detection_scanned_at)}</dd>
                </div>
                <div className="rounded border p-2.5" style={{ borderColor: "var(--border)" }}>
                  <dt className="text-xs" style={{ color: "var(--text-muted)" }}>偵測版本</dt>
                  <dd className="mt-1 text-xs font-medium">{file.ai_detection_version ?? "尚未記錄"}</dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby="ai-evidence-title">
              <div className="flex items-center justify-between gap-3">
                <h3 id="ai-evidence-title" className="text-sm font-semibold">判斷線索</h3>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{evidence.length} 項</span>
              </div>
              {evidence.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {evidence.map((item, index) => (
                    <li
                      key={`${item.category}-${index}`}
                      className="rounded-lg border p-3"
                      style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="rounded px-1.5 py-0.5 text-xs font-semibold"
                          style={{ color: toneStyles.color, background: toneStyles.background }}
                        >
                          {item.level} 級
                        </span>
                        <span className="text-xs font-semibold">{item.category}</span>
                      </div>
                      <p className="mt-2 text-xs font-medium">{item.label}</p>
                      <p className="mt-1 break-words text-xs" style={{ color: "var(--text-secondary)" }}>
                        偵測值：{item.value}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        來源：{item.source}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div
                  className="mt-2 rounded-lg border p-3 text-xs"
                  style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
                >
                  <p className="font-medium">未偵測到可供判斷的來源或內容線索</p>
                  <p className="mt-1 leading-5" style={{ color: "var(--text-secondary)" }}>
                    系統已檢查可解析的 metadata 與像素結構；這不代表檔案一定不是 AI 生成。
                  </p>
                </div>
              )}
            </section>

            <section aria-labelledby="ai-metadata-title">
              <div className="flex items-center justify-between gap-3">
                <h3 id="ai-metadata-title" className="text-sm font-semibold">完整分析資料</h3>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{metadata.length} 筆</span>
              </div>
              {metadata.length > 0 ? (
                <div
                  className="mt-2 max-h-72 overflow-auto rounded-lg border"
                  style={{ borderColor: "var(--border)" }}
                >
                  <dl className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {metadata.map((item, index) => (
                      <div key={item.source + item.key + index} className="grid gap-1 p-3 sm:grid-cols-[10rem_1fr] sm:gap-3">
                        <dt className="break-words text-xs font-semibold">{item.key}</dt>
                        <dd className="break-words whitespace-pre-wrap text-xs" style={{ color: "var(--text-secondary)" }}>
                          <span className="mr-1 text-xs" style={{ color: "var(--text-muted)" }}>[{item.source}]</span>
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <p
                  className="mt-2 rounded-lg border p-3 text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  沒有可解析的 metadata。
                </p>
              )}
            </section>

            {file.ai_detection_sha256 && (
              <section aria-labelledby="ai-integrity-title">
                <h3 id="ai-integrity-title" className="text-sm font-semibold">檔案完整性</h3>
                <p
                  className="mt-2 break-all rounded-lg border p-3 font-mono text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  SHA-256：{file.ai_detection_sha256}
                </p>
              </section>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
