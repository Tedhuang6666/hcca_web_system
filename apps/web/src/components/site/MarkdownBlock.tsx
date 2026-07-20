"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownBlock({ markdown }: { markdown: string | null | undefined }) {
  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ul: ({ children, ...props }) => (
            <ul {...props} className="my-3 list-disc space-y-1 pl-6 first:mt-0 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol {...props} className="my-3 list-decimal space-y-1 pl-6 first:mt-0 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="pl-1" {...props}>
              {children}
            </li>
          ),
          p: ({ children, ...props }) => (
            <p className="my-3 first:mt-0 last:mb-0" {...props}>
              {children}
            </p>
          ),
        }}
      >
        {markdown ?? ""}
      </ReactMarkdown>
    </div>
  );
}
