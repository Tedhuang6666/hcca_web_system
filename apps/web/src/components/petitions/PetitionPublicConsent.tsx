"use client";

import { useEffect, useState } from "react";
import { diffLines } from "diff";
import { toast } from "sonner";

import { ApiError, petitionsApi } from "@/lib/api";
import type { PetitionCaseOut } from "@/lib/types";

export function PetitionPublicDiff({ before, after }: { before: string; after: string }) {
  return (
    <div className="rounded-lg overflow-hidden text-sm font-mono" style={{ border: "1px solid var(--border)" }}>
      {diffLines(before, after).map((part, index) => (
        <div
          key={`${index}-${part.value}`}
          className="px-3 py-1 whitespace-pre-wrap"
          style={{
            background: part.added ? "var(--success-dim)" : part.removed ? "var(--danger-dim)" : "transparent",
            color: part.added ? "var(--success)" : part.removed ? "var(--danger)" : "var(--text-muted)",
          }}
        >
          <span className="inline-block w-5 select-none">{part.added ? "+" : part.removed ? "−" : " "}</span>
          {part.value}
        </div>
      ))}
    </div>
  );
}

export default function PetitionPublicConsent({
  item,
  verificationCode,
  onUpdated,
}: {
  item: PetitionCaseOut;
  verificationCode?: string;
  onUpdated: (item: PetitionCaseOut) => void;
}) {
  const [title, setTitle] = useState(item.public_title || item.title);
  const [content, setContent] = useState(item.public_content || item.content);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(item.public_title || item.title);
    setContent(item.public_content || item.content);
  }, [item]);

  if (item.public_status !== "pending_user") return null;

  const respond = async (decision: "approve" | "approve_with_changes" | "reject") => {
    if (decision === "approve_with_changes" && (!title.trim() || !content.trim())) return;
    setBusy(true);
    try {
      const updated = await petitionsApi.respondPublic(item.id, {
        decision,
        ...(decision === "approve_with_changes" ? { title: title.trim(), content: content.trim() } : {}),
        verification_code: verificationCode || null,
      });
      onUpdated(updated);
      toast.success(decision === "reject" ? "已拒絕公開" : "公開意願已送出");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "送出公開意願失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 space-y-4">
      <div>
        <h2 className="font-semibold">公開陳情確認</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          承辦希望公開這件已結案陳情。公開後不會顯示您的姓名、Email、學號或其他聯絡資料。
        </p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">公開草案差異</p>
        <PetitionPublicDiff before={item.content} after={item.public_content || item.content} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">公開標題差異</p>
        <PetitionPublicDiff before={item.title} after={item.public_title || item.title} />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="public-title">公開標題（可修改）</label>
        <input id="public-title" className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="text-sm font-medium" htmlFor="public-content">公開內容（可修改）</label>
        <textarea id="public-content" className="input w-full min-h-32" value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={() => respond("approve")}>同意公開</button>
        <button className="btn btn-ghost" disabled={busy || !title.trim() || !content.trim()} onClick={() => respond("approve_with_changes")}>修改後同意</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => respond("reject")}>拒絕公開</button>
      </div>
    </section>
  );
}
