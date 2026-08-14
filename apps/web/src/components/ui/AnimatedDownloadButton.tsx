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

const RING_POINTS = 72;

function pointOnRing(index: number): [number, number] {
  const angle = -Math.PI / 2 + (index / (RING_POINTS - 1)) * Math.PI * 2;
  return [52 + Math.cos(angle) * 10, 13 + Math.sin(angle) * 10];
}

function pointOnRail(index: number): [number, number] {
  return [13 + (index / (RING_POINTS - 1)) * 78, 29];
}

function morphPath(morph: number): string {
  return Array.from({ length: RING_POINTS }, (_, index) => {
    const [ringX, ringY] = pointOnRing(index);
    const [railX, railY] = pointOnRail(index);
    const x = ringX + (railX - ringX) * morph;
    const y = ringY + (railY - ringY) * morph;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

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
  const [morph, setMorph] = useState(0);
  const morphRef = useRef(0);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
    };
  }, []);

  useEffect(() => {
    const target = state === "idle" ? 0 : 1;
    const from = morphRef.current;
    if (Math.abs(target - from) < 0.01) {
      setMorph(target);
      return;
    }

    let frame = 0;
    const startedAt = performance.now();
    const duration = target === 1 ? 520 : 260;
    const animate = (now: number) => {
      const elapsed = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - (1 - elapsed) ** 4;
      const next = from + (target - from) * eased;
      morphRef.current = next;
      setMorph(next);
      if (elapsed < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  const startDownload = async () => {
    if (state === "starting" || state === "downloading" || state === "finishing") return;
    if (!request && !href) return;
    if (resetTimer.current) window.clearTimeout(resetTimer.current);

    setState("starting");
    setProgress(0);

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
          ? progress === null ? "下載中" : `下載中 ${Math.round(progress * 100)}%`
          : label;
  const ariaLabel = buttonProps["aria-label"]
    ?? (typeof label === "string" ? label : "下載檔案");
  const path = morphPath(morph);
  const isIndeterminate = progress === null && state !== "error";
  const progressOffset = progress === null ? undefined : 1 - progress;
  const showProgressMeta = isBusy || state === "complete" || state === "error";
  const progressLabel = state === "error"
    ? "再試一次"
    : progress === null
      ? "讀取中"
      : `${Math.round(progress * 100)}%`;

  return (
    <button
      {...buttonProps}
      type="button"
      className={`animated-download-button${iconOnly ? " animated-download-button--icon-only" : ""}${className ? ` ${className}` : ""}`}
      data-download-state={state}
      disabled={disabled || isBusy}
      aria-label={ariaLabel}
      aria-busy={isBusy}
      aria-live="polite"
      onClick={startDownload}>
      <span className="animated-download__copy">
        <span className="animated-download__label">{displayLabel}</span>
      </span>
      <span className="animated-download__visual" aria-hidden="true">
        <svg className="animated-download__svg" viewBox="0 0 104 40" focusable="false">
          <path className="animated-download__rail" d={path} pathLength="1" />
          <path
            className={`animated-download__fill${isIndeterminate ? " is-indeterminate" : ""}`}
            d={path}
            pathLength="1"
            strokeDasharray={isIndeterminate ? "0.22 0.78" : "1 1"}
            style={progressOffset === undefined ? undefined : { strokeDashoffset: progressOffset }} />
        </svg>
        <span className="animated-download__arrow"><Download size={15} strokeWidth={2.15} /></span>
        <span className="animated-download__check"><Check size={20} strokeWidth={2.8} /></span>
        <span className="animated-download__retry"><RotateCcw size={16} strokeWidth={2.4} /></span>
      </span>
      {showProgressMeta && <span className="animated-download__percent">{progressLabel}</span>}
    </button>
  );
}
