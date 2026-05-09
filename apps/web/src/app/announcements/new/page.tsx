"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { announcementsApi, ApiError } from "@/lib/api";
import AnnouncementEditor from "@/components/announcements/AnnouncementEditor";
import { contentFromMarkdown } from "@/components/announcements/AnnouncementMarkdown";
import { usePermissions } from "@/hooks/usePermissions";

export default function NewAnnouncementPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [saving, setSaving] = useState(false);
  const canPublish = can("announcement:publish");

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
      });
      if (publish && canPublish) {
        await announcementsApi.publish(created.id);
      }
      toast.success(publish && canPublish ? "公告已發布" : "公告草稿已建立");
      router.push(`/announcements/${created.id}/edit`);
    } catch (e) {
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
