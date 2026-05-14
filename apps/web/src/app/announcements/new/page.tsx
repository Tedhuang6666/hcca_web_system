"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { announcementsApi, ApiError } from "@/lib/api";
import AnnouncementEditor from "@/components/announcements/AnnouncementEditor";
import { contentFromMarkdown } from "@/components/announcements/AnnouncementMarkdown";
import { usePermissions } from "@/hooks/usePermissions";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";

type AnnouncementDraft = {
  title: string;
  markdown: string;
  isUrgent: boolean;
  urgentUntil: string;
};

export default function NewAnnouncementPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [urgentUntil, setUrgentUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const canPublish = can("announcement:publish");
  const canUrgent = can("announcement:set_urgent");
  const draftValue = useMemo<AnnouncementDraft>(() => ({
    title,
    markdown,
    isUrgent,
    urgentUntil,
  }), [isUrgent, markdown, title, urgentUntil]);
  const restoreDraft = useCallback((draft: AnnouncementDraft) => {
    setTitle(draft.title ?? "");
    setMarkdown(draft.markdown ?? "");
    setIsUrgent(Boolean(draft.isUrgent));
    setUrgentUntil(draft.urgentUntil ?? "");
    toast.info("已復原未送出的公告草稿");
  }, []);
  const { clearDraft, flushDraft } = useDraftAutosave({
    key: "announcements:new",
    value: draftValue,
    onRestore: restoreDraft,
    isEmpty: useCallback((draft: AnnouncementDraft) => (
      !(draft.title ?? "").trim()
      && !(draft.markdown ?? "").trim()
      && !draft.isUrgent
      && !draft.urgentUntil
    ), []),
  });

  const save = async (publish: boolean) => {
    if (!title.trim()) {
      toast.error("請輸入公告標題");
      return;
    }
    setSaving(true);
    try {
      const created = await announcementsApi.create({
        title: title.trim(),
        content: contentFromMarkdown(markdown),
        is_urgent: canUrgent ? isUrgent : false,
        urgent_until: canUrgent && isUrgent && urgentUntil
          ? new Date(urgentUntil).toISOString()
          : null,
      });
      if (publish && canPublish) {
        await announcementsApi.publish(created.id);
      }
      clearDraft();
      toast.success(publish && canPublish ? "公告已發布" : "公告草稿已建立");
      router.push(`/announcements/${created.id}/edit`);
    } catch (e) {
      flushDraft();
      toast.error(e instanceof ApiError ? e.message : "建立公告失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">新增公告</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            以 Markdown 撰寫公告內容
          </p>
        </div>
        <Link href="/announcements" className="btn btn-ghost">取消</Link>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="input text-lg"
        placeholder="公告標題"
        maxLength={200}
      />

      <AnnouncementEditor
        value={markdown}
        onChange={setMarkdown}
        media={[]}
        canManageMedia={false}
      />

      {canUrgent && (
        <section className="card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isUrgent}
                onChange={(e) => setIsUrgent(e.target.checked)}
              />
              緊急公告
            </label>
            <input
              type="datetime-local"
              value={urgentUntil}
              onChange={(e) => setUrgentUntil(e.target.value)}
              className="input sm:w-64"
              disabled={!isUrgent}
            />
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            不設定截止時間時，緊急公告會持續顯示到手動關閉。
          </p>
        </section>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => save(false)}>
          儲存草稿
        </button>
        {canPublish && (
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save(true)}>
            發布
          </button>
        )}
      </div>
    </div>
  );
}
