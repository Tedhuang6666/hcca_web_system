"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { announcementsApi, ApiError } from "@/lib/api";
import type { AnnouncementOut } from "@/lib/types";
import AnnouncementMarkdown from "@/components/announcements/AnnouncementMarkdown";
import { usePermissions } from "@/hooks/usePermissions";
import { API_BASE } from "@/lib/config";

export default function AnnouncementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<AnnouncementOut | null>(null);
  const [loading, setLoading] = useState(true);
  const { canAny } = usePermissions();
  const canManage = canAny(
    "announcement:edit",
    "announcement:publish",
    "announcement:set_urgent",
    "announcement:media_manage",
  );

  useEffect(() => {
    announcementsApi.get(id)
      .then(setItem)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入公告失敗"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>載入中…</div>;
  }
  if (!item) {
    return <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>找不到公告</div>;
  }

  return (
    <article className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/announcements" className="btn btn-ghost">返回公告檢視</Link>
        {canManage && (
          <Link href={`/announcements/${item.id}/edit`} className="btn btn-secondary">
            編輯公告
          </Link>
        )}
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {item.is_urgent && (
            <span className="badge" style={{ color: "var(--danger)", background: "var(--danger-dim)", borderColor: "var(--danger-border)" }}>
              緊急公告
            </span>
          )}
          {!item.is_published && (
            <span className="badge" style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              草稿
            </span>
          )}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {item.published_at
              ? new Date(item.published_at).toLocaleString("zh-TW")
              : new Date(item.created_at).toLocaleString("zh-TW")}
          </span>
        </div>
        <h1 className="text-2xl font-semibold leading-tight">{item.title}</h1>
      </header>

      {item.media.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {item.media.map((media, index) => {
            const href = media.url.startsWith("/uploads/") ? `${API_BASE}${media.url}` : media.url;
            return (
              <a
                key={media.id}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm"
              >
                圖片 {index + 1}
              </a>
            );
          })}
        </div>
      )}

      <div className="card p-5 md:p-7">
        <AnnouncementMarkdown content={item.content} />
        <div className="mt-8 border-t pt-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
          公告人：{item.author_name || "未命名"}
        </div>
      </div>
    </article>
  );
}
