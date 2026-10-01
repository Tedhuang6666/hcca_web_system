import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";

import { uploadUrl } from "@/lib/config";
import { isArticleChartSpec } from "@/lib/article-charts";
import type { PetitionMonthlyStatsOut } from "@/lib/types";
import { extractArticleHeadings } from "@/lib/article-utils";
import remarkBreaks from "@/lib/remarkBreaks";
import ArticleChart from "./ArticleChart";
import ArticleGallery, { type ArticleGalleryPhoto } from "./ArticleGallery";
import PetitionMonthlyChart from "./PetitionMonthlyChart";

function resolveImageSrc(src: string | undefined): string {
  return uploadUrl(src);
}

function imageAlt(alt: string | undefined): { label: string; width?: number } {
  const [label, ...meta] = (alt ?? "").split("|").map((part) => part.trim());
  const width = meta.join("|").match(/(?:^|[,; ])w=(\d{2,4})(?:px)?/iu)?.[1];
  return { label, width: width ? Number(width) : undefined };
}

function ArticleImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  const meta = imageAlt(alt);
  const resolvedSrc = resolveImageSrc(typeof src === "string" ? src : undefined);
  if (!resolvedSrc) return null;
  return (
    <figure className="article-markdown-image">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolvedSrc}
        alt={meta.label}
        loading="lazy"
        width={meta.width}
        style={{ width: meta.width ? `${meta.width}px` : undefined }}
      />
      {meta.label && <figcaption className="article-markdown-image-caption">{meta.label}</figcaption>}
    </figure>
  );
}

function normalizeEscapedBold(markdown: string): string {
  let inFence = false;
  return markdown.split("\n").map((line) => {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : line.replace(/\\\*\\\*([^*\n]+?)\\\*\\\*/gu, "**$1**");
  }).join("\n");
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPetitionMonthlyStats(value: unknown): value is PetitionMonthlyStatsOut {
  if (!value || typeof value !== "object") return false;
  const stats = value as Partial<PetitionMonthlyStatsOut>;
  return typeof stats.month === "string"
    && /^\d{4}-(0[1-9]|1[0-2])$/u.test(stats.month)
    && isCount(stats.received_total)
    && isCount(stats.completed_total)
    && (stats.average_completion_hours === null
      || (typeof stats.average_completion_hours === "number" && Number.isFinite(stats.average_completion_hours)))
    && Array.isArray(stats.by_type)
    && stats.by_type.every((item) => Boolean(item)
      && typeof item.type_name === "string"
      && isCount(item.count));
}

function isArticleGallery(value: unknown): value is ArticleGalleryPhoto[] {
  return Array.isArray(value)
    && value.length >= 2
    && value.every((photo) => Boolean(photo)
      && typeof photo.url === "string"
      && photo.url.trim().length > 0
      && typeof photo.description === "string");
}

function markdownText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(markdownText).join("");
  if (isValidElement<{ children?: ReactNode }>(value)) return markdownText(value.props.children);
  return "";
}

function ArticlePre({ children, ...props }: ComponentProps<"pre">) {
  const code = Children.toArray(children).find((child) =>
    isValidElement<{ className?: string; children?: ReactNode }>(child)
      && child.props.className?.split(/\s+/u).some((name) =>
          name === "language-hcca-chart"
            || name === "language-hcca-petition-chart"
            || name === "language-hcca-gallery",
      ),
  );
  if (isValidElement<{ className?: string; children?: ReactNode }>(code)) {
    const source = String(code.props.children ?? "").replace(/\n$/u, "");
    const language = code.props.className?.split(/\s+/u).find((name) => name.startsWith("language-"));
    let stats: unknown;
    try {
      stats = JSON.parse(source);
    } catch {
      // Keep malformed or manually edited chart data visible as a code block.
    }
    if (language === "language-hcca-chart" && isArticleChartSpec(stats)) {
      return <ArticleChart chart={stats} />;
    }
    if (language === "language-hcca-gallery" && isArticleGallery(stats)) {
      return <ArticleGallery photos={stats} />;
    }
    if (isPetitionMonthlyStats(stats)) return <PetitionMonthlyChart stats={stats} />;
  }
  return <pre {...props}>{children}</pre>;
}

export default function ArticleMarkdown({
  markdown,
  skipFirstTitle = false,
  skipFirstSummary,
}: {
  markdown: string;
  skipFirstTitle?: boolean;
  skipFirstSummary?: string | null;
}) {
  const renderMarkdown = normalizeEscapedBold(markdown);
  const headings = extractArticleHeadings(renderMarkdown);
  let headingIndex = 0;
  let renderedTitle = false;
  let checkedFirstParagraph = false;

  return (
    <div className="article-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children, ...props }) => {
            if (skipFirstTitle && !renderedTitle) {
              renderedTitle = true;
              return null;
            }
            renderedTitle = true;
            return <h1 {...props}>{children}</h1>;
          },
          h2: ({ children, ...props }) => {
            const heading = headings[headingIndex++];
            return <h2 {...props} id={heading?.id}>{children}</h2>;
          },
          h3: ({ children, ...props }) => {
            const heading = headings[headingIndex++];
            return <h3 {...props} id={heading?.id}>{children}</h3>;
          },
          p: ({ children, ...props }) => {
            if (skipFirstSummary && !checkedFirstParagraph) {
              checkedFirstParagraph = true;
              if (markdownText(Children.toArray(children)).trim() === skipFirstSummary.trim()) return null;
            }
            const childNodes = Children.toArray(children);
            const isMediaParagraph = childNodes.some(
              (child) => isValidElement(child) && child.type === ArticleImage,
            );
            return isMediaParagraph
              ? <div className="article-markdown-media-paragraph">{children}</div>
              : <p {...props}>{children}</p>;
          },
          a: ({ href, children }) => {
            const external = Boolean(href && /^https?:\/\//iu.test(href));
            return (
              <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
                {children}
              </a>
            );
          },
          img: ArticleImage,
          pre: ArticlePre,
          ul: ({ children, ...props }) => <ul {...props}>{children}</ul>,
          ol: ({ children, ...props }) => <ol {...props}>{children}</ol>,
        }}
      >
        {renderMarkdown}
      </ReactMarkdown>
    </div>
  );
}
