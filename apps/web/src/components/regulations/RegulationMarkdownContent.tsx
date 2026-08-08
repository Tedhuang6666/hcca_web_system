"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import remarkBreaks from "@/lib/remarkBreaks";

export default function RegulationMarkdownContent({
  content,
  className,
  style,
}: {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={className} style={style}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</ReactMarkdown>
    </div>
  );
}
