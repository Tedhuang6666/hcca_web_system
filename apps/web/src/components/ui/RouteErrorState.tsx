"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Home, RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";

import { usePageError } from "@/hooks/usePageError";

export default function RouteErrorState({
  error,
  reset,
  homeHref = "/",
  scope = "route.error",
  embedded = false,
}: {
  error: Error & { digest?: string; status?: number; errorId?: string | null };
  reset: () => void;
  homeHref?: string;
  scope?: string;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const { presentation, code } = usePageError(error, scope);
  const Container = embedded ? "div" : "main";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function primaryAction() {
    if (presentation.recovery === "login") {
      const next = `${window.location.pathname}${window.location.search}`;
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    if (presentation.recovery === "back") {
      window.history.back();
      return;
    }
    if (presentation.recovery === "home") {
      router.push(homeHref);
      return;
    }
    reset();
  }

  const tone = presentation.tone === "danger" ? "var(--danger)" : presentation.tone === "warning" ? "var(--warning)" : "var(--primary)";
  return (
    <Container className="flex min-h-[55vh] items-center justify-center p-6" role="alert">
      <section className="w-full max-w-lg rounded-xl border p-6" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>
            <AlertTriangle size={20} aria-hidden={true} />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{presentation.title}</h1>
            <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>{presentation.description}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={primaryAction} className="btn btn-primary inline-flex items-center gap-2">
            <RefreshCw size={15} aria-hidden={true} />{presentation.action}
          </button>
          <button type="button" onClick={() => window.history.back()} className="btn inline-flex items-center gap-2" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            <Undo2 size={15} aria-hidden={true} />返回上一頁
          </button>
          <Link href={homeHref} className="btn inline-flex items-center gap-2" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            <Home size={15} aria-hidden={true} />首頁
          </Link>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: "var(--bg-muted)" }}>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>錯誤編號：<code className="font-mono">{code}</code></span>
          <button type="button" onClick={copyCode} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium" style={{ color: "var(--primary)" }}>
            {copied ? <Check size={14} aria-hidden={true} /> : <Copy size={14} aria-hidden={true} />}
            {copied ? "已複製" : "複製"}
          </button>
        </div>
      </section>
    </Container>
  );
}
