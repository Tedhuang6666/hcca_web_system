import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Children, isValidElement } from "react";

import { uploadUrl } from "@/lib/config";
import { extractArticleHeadings } from "@/lib/article-utils";
import remarkBreaks from "@/lib/remarkBreaks";

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

export default function ArticleMarkdown({ markdown, skipFirstTitle = false }: { markdown: string; skipFirstTitle?: boolean }) {
  const headings = extractArticleHeadings(markdown);
  let headingIndex = 0;
  let renderedTitle = false;

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
          ul: ({ children, ...props }) => <ul {...props}>{children}</ul>,
          ol: ({ children, ...props }) => <ol {...props}>{children}</ol>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
