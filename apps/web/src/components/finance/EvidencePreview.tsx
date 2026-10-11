"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, ZoomIn, ZoomOut } from "lucide-react";
import Image from "next/image";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import Modal from "@/components/ui/Modal";
import { apiUrl } from "@/lib/config";

type Props = {
  url: string;
  filename: string;
  children?: ReactNode;
  className?: string;
};

function resolvePreviewUrl(url: string): string | null {
  if (url.startsWith("/finance/")) return apiUrl(url);
  if (url.startsWith("/api/")) return url;

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
  } catch {
    return null;
  }

  return null;
}

export function PdfEvidenceViewer({
  url,
  filename,
  compact = false,
}: {
  url: string;
  filename: string;
  compact?: boolean;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [viewerWidth, setViewerWidth] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    const loadDocument = async () => {
      setPdf(null);
      setPageNumber(1);
      setHasError(false);
      setIsLoading(true);

      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;

        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        loadingTask = pdfjs.getDocument({ url });
        const loadedPdf = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        setPdf(loadedPdf);
      } catch {
        if (!cancelled) setHasError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadDocument();
    return () => {
      cancelled = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [url]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const observer = new ResizeObserver(([entry]) => {
      setViewerWidth(entry.contentRect.width);
    });
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdf || !canvas || viewerWidth <= 0) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;

    const renderPage = async () => {
      setHasError(false);
      setIsRendering(true);

      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const fitWidth = Math.max(1, viewerWidth - 32) / baseViewport.width;
        const viewport = page.getViewport({ scale: fitWidth * zoom });

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = `${Math.ceil(viewport.width)}px`;
        canvas.style.height = `${Math.ceil(viewport.height)}px`;

        renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;
      } catch (error) {
        const wasCancelled = error instanceof Error
          && error.name === "RenderingCancelledException";
        if (!cancelled && !wasCancelled) setHasError(true);
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, viewerWidth, zoom]);

  const isBusy = isLoading || isRendering;

  return (
    <div className={`finance-evidence-preview__pdf${compact ? " is-compact" : ""}`}>
      {pdf && (
        <div
          className="finance-evidence-preview__pdf-toolbar"
          role="group"
          aria-label="PDF 預覽控制"
        >
          <div className="finance-evidence-preview__pdf-pages">
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="上一頁"
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span aria-live="polite">第 {pageNumber} 頁 / 共 {pdf.numPages} 頁</span>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="下一頁"
              disabled={pageNumber >= pdf.numPages}
              onClick={() => setPageNumber((current) => Math.min(pdf.numPages, current + 1))}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="finance-evidence-preview__pdf-zoom">
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="縮小預覽"
              disabled={zoom <= 0.75}
              onClick={() => setZoom((current) => Math.max(0.75, current - 0.25))}
            >
              <ZoomOut size={15} aria-hidden="true" />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="放大預覽"
              disabled={zoom >= 2.5}
              onClick={() => setZoom((current) => Math.min(2.5, current + 0.25))}
            >
              <ZoomIn size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <div
        ref={viewerRef}
        className={`finance-evidence-preview__viewer finance-evidence-preview__viewer--pdf${compact ? " is-compact" : ""}`}
        aria-busy={isBusy}
      >
        {isBusy && (
          <p className="finance-evidence-preview__loading" role="status">
            <LoaderCircle size={18} aria-hidden="true" />
            {isLoading ? "正在載入憑證…" : "正在繪製頁面…"}
          </p>
        )}
        <div className="finance-evidence-preview__pdf-canvas">
          <canvas
            key={`${pageNumber}-${zoom}-${Math.round(viewerWidth)}`}
            ref={canvasRef}
            className="finance-evidence-preview__canvas"
            role="img"
            aria-label={`${filename} 第 ${pageNumber} 頁`}
            aria-hidden={hasError}
          />
          {hasError && (
            <p className="finance-evidence-preview__error" role="alert">
              無法預覽這份 PDF，請改用下方「在新分頁開啟」。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EvidencePreview({ url, filename, children, className }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const previewUrl = resolvePreviewUrl(url);
  const triggerClassName = ["finance-evidence-preview__trigger", className]
    .filter(Boolean)
    .join(" ");
  const isPdf = filename.toLowerCase().endsWith(".pdf");

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        disabled={!previewUrl}
        aria-label={"預覽憑證：" + filename}
        onClick={() => {
          setIsImageLoading(true);
          setImageError(false);
          setIsOpen(true);
        }}
      >
        {children ?? filename}
      </button>
      {isOpen && previewUrl && (
        <Modal
          title="憑證預覽"
          onClose={() => setIsOpen(false)}
          size="full"
          footer={
            <a className="btn btn-secondary" href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} aria-hidden="true" />
              在新分頁開啟
            </a>
          }
        >
          <div className="finance-evidence-preview">
            <p className="finance-evidence-preview__filename">{filename}</p>
            {isPdf ? (
              <PdfEvidenceViewer key={previewUrl} url={previewUrl} filename={filename} />
            ) : (
              <div className="finance-evidence-preview__viewer" aria-busy={isImageLoading}>
                {isImageLoading && !imageError && (
                  <p className="finance-evidence-preview__loading" role="status">
                    <LoaderCircle size={18} aria-hidden="true" />
                    正在載入憑證…
                  </p>
                )}
                {imageError ? (
                  <p className="finance-evidence-preview__error" role="alert">
                    無法載入這張圖片，請改用下方「在新分頁開啟」。
                  </p>
                ) : (
                  <Image
                    className="finance-evidence-preview__image"
                    src={previewUrl}
                    alt={filename}
                    fill
                    sizes="100vw"
                    unoptimized
                    onLoad={() => setIsImageLoading(false)}
                    onError={() => {
                      setIsImageLoading(false);
                      setImageError(true);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
