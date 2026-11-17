"use client";

import { useEffect, useState } from "react";
import { diffLines } from "diff";
import { toast } from "sonner";

import { ApiError } from "@/lib/api-helpers";
import { petitionsApi } from "@/lib/api/petitions";
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
  onUpdated,
}: {
  item: PetitionCaseOut;
  onUpdated: (item: PetitionCaseOut) => void;
}) {
  const draftTitle = item.public_title || item.title;
  const draftContent = item.public_content || item.content;
  const [title, setTitle] = useState(draftTitle);
  const [content, setContent] = useState(draftContent);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(item.public_title || item.title);
    setContent(item.public_content || item.content);
    setEditing(false);
  }, [item]);

  if (item.public_status !== "pending_user") return null;

  const changed = title.trim() !== draftTitle.trim() || content.trim() !== draftContent.trim();
  const cancelEditing = () => {
    setTitle(draftTitle);
    setContent(draftContent);
    setEditing(false);
  };

  const respond = async (decision: "approve" | "approve_with_changes" | "reject") => {
    if (decision === "approve_with_changes" && (!title.trim() || !content.trim())) return;
    setBusy(true);
    try {
      const updated = await petitionsApi.respondPublic(item.id, {
        decision,
        ...(decision === "approve_with_changes" ? { title: title.trim(), content: content.trim() } : {}),
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
      {editing ? (
        <>
          <div className="space-y-2">
            <label className="block text-sm font-semibold" htmlFor="public-title">公開標題</label>
            <input id="public-title" className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold" htmlFor="public-content">公開內容</label>
            <textarea id="public-content" className="input w-full min-h-32" value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary"
              disabled={busy || !changed || !title.trim() || !content.trim()}
              onClick={() => respond("approve_with_changes")}>
              送出修改並同意
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancelEditing}>取消修改</button>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">公開標題</h3>
            <PetitionPublicDiff before={item.title} after={draftTitle} />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">公開內容</h3>
            <PetitionPublicDiff before={item.content} after={draftContent} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => respond("approve")}>同意公開</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setEditing(true)}>修改內容</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => respond("reject")}>拒絕公開</button>
          </div>
        </>
      )}
    </section>
  );
}
