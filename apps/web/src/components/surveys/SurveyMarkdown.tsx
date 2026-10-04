"use client";

import { useId, useState } from "react";
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

export function SurveyMarkdownField({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const id = useId();
  const [preview, setPreview] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {label}
        </label>
        <div className="flex items-center gap-1" aria-label={`${label}編輯模式`}>
          <button
            type="button"
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
            className="btn btn-ghost min-h-9 px-3 text-xs"
          >
            編輯
          </button>
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => setPreview(true)}
            className="btn btn-ghost min-h-9 px-3 text-xs"
          >
            預覽
          </button>
        </div>
      </div>
      {preview ? (
        <div
          id={id}
          className="min-h-24 rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          aria-live="polite"
        >
          {value.trim() ? (
            <SurveyMarkdown markdown={value} />
          ) : (
            <span style={{ color: "var(--text-muted)" }}>目前沒有內容。</span>
          )}
        </div>
      ) : (
        <textarea
          id={id}
          value={value}
          onChange={event => onChange(event.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="input resize-y"
          aria-describedby={`${id}-markdown-help`}
        />
      )}
      {!preview && (
        <p id={`${id}-markdown-help`} className="text-xs" style={{ color: "var(--text-muted)" }}>
          支援 Markdown：標題、粗體、清單、連結與表格。
        </p>
      )}
    </div>
  );
}
