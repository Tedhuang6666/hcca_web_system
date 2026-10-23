"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "@/lib/remarkBreaks";

export function SurveyMarkdown({
  markdown,
  className = "",
}: {
  markdown: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={`survey-markdown ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {markdown ?? ""}
      </ReactMarkdown>
    </div>
  );
}
