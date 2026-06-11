"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { policiesApi, apiErrorMessage } from "@/lib/api";
import { normalizeCouncilName } from "@/lib/copy";
import type { PolicyDocumentOut, PolicyKind } from "@/lib/types";

export default function PolicyDocumentViewer({
  kind,
  fallbackTitle,
}: {
  kind: PolicyKind;
  fallbackTitle: string;
}) {
  const searchParams = useSearchParams();
  const version = searchParams.get("v");
  const [doc, setDoc] = useState<PolicyDocumentOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDoc(null);
    const loader = version ? policiesApi.version(kind, version) : policiesApi.active(kind);
    loader
      .then((item) => {
        if (!cancelled) setDoc(item);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(apiErrorMessage(e, "無法載入政策文件"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, version]);

  if (error) {
    return (
      <>
        <h1>{fallbackTitle}</h1>
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      </>
    );
  }

  if (!doc) {
    return (
      <>
        <h1>{fallbackTitle}</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          正在載入目前生效版本…
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{normalizeCouncilName(doc.title)}</h1>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        生效版本：v{doc.version} · 生效日期：{new Date(doc.effective_at).toLocaleDateString("zh-TW")}
      </p>
      {doc.summary_md && (
        <section
          className="not-prose my-5 rounded-lg border p-4 text-sm"
          style={{
            background: "var(--primary-dim)",
            borderColor: "var(--warning-border)",
            color: "var(--text-secondary)",
          }}>
          <p className="mb-1 font-semibold" style={{ color: "var(--text-primary)" }}>
            本版摘要
          </p>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {normalizeCouncilName(doc.summary_md)}
          </ReactMarkdown>
        </section>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeCouncilName(doc.content_md)}</ReactMarkdown>
    </>
  );
}
