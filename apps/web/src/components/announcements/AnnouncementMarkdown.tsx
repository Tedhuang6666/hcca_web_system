"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { API_BASE } from "@/lib/config";
import remarkBreaks from "@/lib/remarkBreaks";
import { markdownFromContent } from "./announcementContent";

function parseImageMeta(alt: string | undefined): {
  alt: string;
  width?: number;
  height?: number;
} {
  const raw = alt ?? "";
  const [label, ...parts] = raw.split("|").map((part) => part.trim());
  const meta = parts.join("|");
  const width = meta.match(/(?:^|[,; ])w=(\d{2,4})(?:px)?/i)?.[1];
  const height = meta.match(/(?:^|[,; ])h=(\d{2,4})(?:px)?/i)?.[1];
  return {
    alt: label,
    width: width ? Number(width) : undefined,
    height: height ? Number(height) : undefined,
  };
}

export default function AnnouncementMarkdown({
  content,
  className = "",
}: {
  content: Record<string, unknown> | null | undefined;
  className?: string;
}) {
  const markdown = markdownFromContent(content);

  return (
    <div className={`announcement-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            const meta = parseImageMeta(alt);
            const rawSrc = typeof src === "string" ? src : "";
            const resolvedSrc = rawSrc.startsWith("/uploads/") ? `${API_BASE}${rawSrc}` : rawSrc;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolvedSrc}
                alt={meta.alt}
                width={meta.width}
                height={meta.height}
                style={{
                  maxWidth: "100%",
                  width: meta.width ? `${meta.width}px` : undefined,
                  height: meta.height ? `${meta.height}px` : "auto",
                }}
              />
            );
          },
        }}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
