"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useId, useState } from "react";

import { googleDrivePreviewUrl, isGoogleDriveUrl } from "@/lib/google-drive";

/** 項目附件：Google 雲端連結可在頁內展開預覽，其他連結直接開啟。 */
export default function AgencyLink({ href, title }: { href: string; title: string }) {
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const preview = googleDrivePreviewUrl(href);
  const isDrive = isGoogleDriveUrl(href);
  const external = /^https?:\/\//.test(href);

  return (
    <div className="agency-link">
      <div className="agency-link-actions">
        <a
          href={href}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="agency-link-open"
        >
          {isDrive ? <FileText size={15} aria-hidden /> : <ExternalLink size={15} aria-hidden />}
          {isDrive ? "在 Google 雲端開啟" : "開啟文件"}
        </a>
        {preview && (
          <button
            type="button"
            className="agency-link-toggle"
            aria-expanded={open}
            aria-controls={previewId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "收合預覽" : "展開預覽"}
          </button>
        )}
      </div>
      {preview && open && (
        <div id={previewId} className="agency-link-frame">
          <iframe
            src={preview}
            title={`${title}（預覽）`}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
}
