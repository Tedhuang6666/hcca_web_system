"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { announcementsApi, ApiError } from "@/lib/api";
import type { AnnouncementMediaOut, AnnouncementOut } from "@/lib/types";
import AnnouncementEditor from "@/components/announcements/AnnouncementEditor";
import { contentFromMarkdown, markdownFromContent } from "@/components/announcements/AnnouncementMarkdown";
import { usePermissions } from "@/hooks/usePermissions";

export default function EditAnnouncementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = usePermissions();
  const [item, setItem] = useState<AnnouncementOut | null>(null);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [urgentUntil, setUrgentUntil] = useState("");
  const [media, setMedia] = useState<AnnouncementMediaOut[]>([]);
  const [saving, setSaving] = useState(false);

  const canEdit = can("announcement:edit");
  const canPublish = can("announcement:publish");
  const canUrgent = can("announcement:set_urgent");
  const canMedia = can("announcement:media_manage");

  useEffect(() => {
    announcementsApi.get(id)
      .then((data) => {
        setItem(data);
        setTitle(data.title);
        setMarkdown(markdownFromContent(data.content));
        setIsUrgent(data.is_urgent);
        setUrgentUntil(data.urgent_until ? data.urgent_until.slice(0, 16) : "");
        setMedia(data.media);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入公告失敗"));
  }, [id]);

  const saveContent = async () => {
    if (!canEdit || !item) return;
    if (!title.trim()) {
      toast.error("請輸入公告標題");
      return;
    }
    setSaving(true);
    try {
      const updated = await announcementsApi.update(item.id, {
        title: title.trim(),
        content: contentFromMarkdown(markdown),
      });
      setItem(updated);
      toast.success("公告已儲存");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const saveUrgent = async () => {
    if (!canUrgent || !item) return;
    setSaving(true);
    try {
      const updated = await announcementsApi.setUrgent(item.id, {
        is_urgent: isUrgent,
        urgent_until: urgentUntil ? new Date(urgentUntil).toISOString() : null,
      });
      setItem(updated);
      toast.success("緊急公告設定已更新");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新緊急設定失敗");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    if (!canPublish || !item) return;
    setSaving(true);
    try {
      const updated = item.is_published
        ? await announcementsApi.unpublish(item.id)
        : await announcementsApi.publish(item.id);
      setItem(updated);
      toast.success(updated.is_published ? "公告已發布" : "公告已取消發布");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "發布狀態更新失敗");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!canEdit || !item || !confirm("確定刪除這則公告？")) return;
    setSaving(true);
    try {
      await announcementsApi.delete(item.id);
      toast.success("公告已刪除");
      router.push("/announcements");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "刪除失敗");
      setSaving(false);
    }
  };

  if (!item) {
    return <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>載入中…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">編輯公告</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {item.is_published ? "已發布" : "草稿"} · 公告人：{item.author_name || "未命名"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/announcements/${item.id}`} className="btn btn-ghost">查看</Link>
          {canPublish && (
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={togglePublish}>
              {item.is_published ? "取消發布" : "發布"}
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn btn-danger-ghost" disabled={saving} onClick={remove}>
              刪除
            </button>
          )}
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="input text-lg"
        placeholder="公告標題"
        maxLength={200}
        disabled={!canEdit}
      />

      <AnnouncementEditor
        value={markdown}
        onChange={setMarkdown}
        announcementId={item.id}
        media={media}
        canManageMedia={canMedia}
        onMediaUploaded={(uploaded) => setMedia((current) => [...current, uploaded])}
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
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={saveUrgent}>
              更新緊急設定
            </button>
          </div>
        </section>
      )}

      <div className="flex justify-end">
        <button type="button" className="btn btn-primary" disabled={!canEdit || saving} onClick={saveContent}>
          儲存內容
        </button>
      </div>
    </div>
  );
}
