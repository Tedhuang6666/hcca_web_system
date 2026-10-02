"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, Download, RotateCcw } from "lucide-react";
import { authFetch } from "@/lib/api/core";

export type DownloadState =
  | "idle"
  | "starting"
  | "downloading"
  | "finishing"
  | "complete"
  | "error";

export type DownloadRequest = () => Promise<Response | Blob>;

type AnimatedDownloadButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type"
> & {
  href?: string;
  request?: DownloadRequest;
  filename?: string;
  label?: ReactNode;
  completeLabel?: ReactNode;
  errorLabel?: ReactNode;
  iconOnly?: boolean;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};

type DownloadPayload = {
  blob: Blob;
  filename: string;
};

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { return encoded; }
  }
  return disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    ?? disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim()
    ?? null;
}

function safeFilename(value: string | null | undefined, fallback: string): string {
  const candidate = value?.split(/[\\/]/).pop()?.trim();
  return candidate || fallback;
}

function filenameFromUrl(href: string): string {
  try {
    const path = new URL(href, window.location.href).pathname;
    return safeFilename(decodeURIComponent(path), "download");
  } catch {
    return "download";
  }
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function readDownload(
  source: Response | Blob,
  fallbackFilename: string,
  onProgress: (progress: number | null) => void,
): Promise<DownloadPayload> {
  if (source instanceof Blob) {
    onProgress(1);
    return { blob: source, filename: fallbackFilename };
  }

  if (!source.ok) {
    throw new Error(source.statusText || `下載失敗（${source.status}）`);
  }

  const filename = safeFilename(
    filenameFromDisposition(source.headers.get("Content-Disposition")),
    fallbackFilename,
  );
  const total = Number(source.headers.get("Content-Length"));
  const contentType = source.headers.get("Content-Type") || "application/octet-stream";

  if (!source.body) {
    const blob = await source.blob();
    onProgress(1);
    return { blob, filename };
  }

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(Number.isFinite(total) && total > 0 ? Math.min(loaded / total, 1) : null);
  }

  onProgress(1);
  return { blob: new Blob(chunks as BlobPart[], { type: contentType }), filename };
}

export default function AnimatedDownloadButton({
  href,
  request,
  filename,
  label = "下載",
  completeLabel = "完成",
  errorLabel = "重試",
  iconOnly = false,
  onComplete,
  onError,
  className,
  disabled,
  ...buttonProps
}: AnimatedDownloadButtonProps) {
  const [state, setState] = useState<DownloadState>("idle");
  const [progress, setProgress] = useState<number | null>(0);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    };
  }, []);

  const startDownload = async () => {
    if (state === "starting" || state === "downloading" || state === "finishing") return;
    if (!request && !href) return;
    if (resetTimer.current) window.clearTimeout(resetTimer.current);

    setState("starting");
    setProgress(null);

    try {
      const source = request
        ? await request()
        : await authFetch(href!, { credentials: "include" });
      const payload = await readDownload(
        source,
        safeFilename(filename, href ? filenameFromUrl(href) : "download"),
        (nextProgress) => {
          setState("downloading");
          setProgress(nextProgress);
        },
      );
      setState("finishing");
      saveBlob(payload.blob, safeFilename(filename, payload.filename));
      setProgress(1);
      setState("complete");
      onComplete?.();
      resetTimer.current = window.setTimeout(() => {
        setProgress(0);
        setState("idle");
      }, 2_600);
    } catch (error) {
      setState("error");
      setProgress(null);
      onError?.(error);
    }
  };

  const isBusy = state === "starting" || state === "downloading" || state === "finishing";
  const displayLabel = state === "complete"
    ? completeLabel
    : state === "error"
      ? errorLabel
      : state === "starting"
        ? "準備中"
        : state === "downloading"
          ? "下載中"
          : label;
  const announcement = state === "starting"
    ? "正在準備下載"
    : state === "downloading"
      ? "正在下載檔案"
      : state === "finishing"
        ? "正在完成下載"
        : state === "complete"
          ? "檔案已下載"
          : state === "error"
            ? "下載失敗，可以重試"
            : "";
  const ariaLabel = buttonProps["aria-label"]
    ?? (typeof label === "string" ? label : "下載檔案");
  const isIndeterminate = progress === null && state !== "error";
  const StatusIcon = state === "complete" ? Check : state === "error" ? RotateCcw : Download;
  const progressValue = progress === null ? undefined : Math.round(progress * 100);

  return (
    <button
      {...buttonProps}
      type="button"
      className={`animated-download-button${iconOnly ? " animated-download-button--icon-only" : ""}${className ? ` ${className}` : ""}`}
      data-download-state={state}
      disabled={disabled || isBusy}
      aria-label={ariaLabel}
      aria-busy={isBusy || undefined}
      onClick={startDownload}>
      <span className="animated-download__icon" aria-hidden="true">
        <StatusIcon size={15} strokeWidth={2.1} />
      </span>
      <span className="animated-download__copy">
        <span className="animated-download__label">{displayLabel}</span>
      </span>
      {isBusy && (
        <span
          className="animated-download__progress"
          role="progressbar"
          aria-label="下載進度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressValue}
          aria-valuetext={progressValue === undefined ? "下載進度讀取中" : `${progressValue}%`}
        >
          <span
            className={`animated-download__progress-fill${isIndeterminate ? " is-indeterminate" : ""}`}
            style={{ width: progressValue === undefined ? "28%" : `${progressValue}%` }}
          />
        </span>
      )}
      <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
    </button>
  );
}
