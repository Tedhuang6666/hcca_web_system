"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
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

export default function EvidencePreview({ url, filename, children, className }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const previewUrl = resolvePreviewUrl(url);
  const triggerClassName = ["finance-evidence-preview__trigger", className]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        disabled={!previewUrl}
        aria-label={"預覽憑證：" + filename}
        onClick={() => {
          setIsLoading(true);
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
            <div className="finance-evidence-preview__viewer" aria-busy={isLoading}>
              {isLoading && (
                <p className="finance-evidence-preview__loading" role="status">
                  <LoaderCircle size={18} aria-hidden="true" />
                  正在載入憑證…
                </p>
              )}
              <iframe
                key={previewUrl}
                src={previewUrl}
                title={filename + " 預覽"}
                onLoad={() => setIsLoading(false)}
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
