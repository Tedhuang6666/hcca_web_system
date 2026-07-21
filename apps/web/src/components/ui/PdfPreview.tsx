"use client";

import { useEffect, useRef } from "react";

interface PdfPreviewProps {
  src: string;
  className?: string;
}

export default function PdfPreview({ src, className }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url,
      ).toString();
      const doc = await pdfjs.getDocument({ url: src }).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1.2 });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
    }
    render().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <div
      className={className}
      style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}
    >
      <canvas ref={canvasRef} className="block h-auto w-full" />
    </div>
  );
}
