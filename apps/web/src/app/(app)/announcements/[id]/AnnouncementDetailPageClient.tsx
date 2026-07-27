"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { announcementsApi, apiErrorMessage } from "@/lib/api";
import type { AnnouncementOut } from "@/lib/types";
import { recordRecent } from "@/lib/recents";
import AnnouncementMarkdown from "@/components/announcements/AnnouncementMarkdown";
import { usePermissions } from "@/hooks/usePermissions";
import { API_BASE } from "@/lib/config";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";

const AUDIENCE_LABEL: Record<string, string> = {
  all: "全體",
  school: "全體竹中生",
  orgs: "特定組織",
  members: "特定成員",
};

export default function AnnouncementDetailPageClient({
  initialItem = null,
}: {
  initialItem?: AnnouncementOut | null;
}) {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<AnnouncementOut | null>(initialItem);
  const [loading, setLoading] = useState(!initialItem);
  const { canAny } = usePermissions();
  const canManage = canAny(
    "announcement:edit",
    "announcement:publish",
    "announcement:set_urgent",
    "announcement:media_manage",
  );

  useEffect(() => {
    const hasInitialItem = initialItem?.id === id;
    if (!hasInitialItem) setLoading(true);
    announcementsApi.get(id)
      .then((nextItem) => setItem(nextItem))
      .catch((e) => {
        if (!hasInitialItem) toast.error(apiErrorMessage(e, "載入公告失敗"));
      })
      .finally(() => setLoading(false));
  }, [id, initialItem]);

  useEffect(() => {
    if (item) recordRecent({ kind: "announcement", id, title: item.title, href: `/announcements/${id}` });
  }, [item, id]);

  if (loading) {
    return <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>載入中…</div>;
  }
  if (!item) {
    return <div className="py-20 text-center" style={{ color: "var(--text-muted)" }}>找不到公告</div>;
  }

  return (
    <article className="mx-auto min-w-0 max-w-3xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Link href="/announcements" className="btn btn-ghost self-start">返回公告檢視</Link>
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:items-end">
          <div className="w-full sm:w-auto">
            <GovernanceLinkPanel
              entityType="announcement"
              entityId={item.id}
              title={item.title}
              href={`/announcements/${item.id}`}
              compact
            />
          </div>
          {canManage && (
            <Link href={`/announcements/${item.id}/edit`} className="btn btn-secondary self-end sm:self-auto">
              編輯公告
            </Link>
          )}
        </div>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {item.is_urgent && (
            <span className="badge" style={{ color: "var(--warning)", background: "var(--warning-dim)", borderColor: "var(--warning-border)" }}>
              重要公告
            </span>
          )}
          {!item.is_published && (
            <span className="badge" style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", borderColor: "var(--border)" }}>
              草稿
            </span>
          )}
          {item.audience_type !== "all" && (
            <span className="badge" style={{ color: "var(--primary)", background: "var(--primary-dim)", borderColor: "var(--border-strong)" }}>
              對象：{AUDIENCE_LABEL[item.audience_type] ?? item.audience_type}
            </span>
          )}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {item.published_at
              ? new Date(item.published_at).toLocaleString("zh-TW")
              : new Date(item.created_at).toLocaleString("zh-TW")}
          </span>
        </div>
        {item.audience_type === "orgs" && item.audience_orgs.length > 0 && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            對象組織：{item.audience_orgs.map((o) => o.name).join("、")}
          </p>
        )}
        {item.audience_type === "members" && item.audience_members.length > 0 && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            對象成員：{item.audience_members.map((m) => m.name).join("、")}
          </p>
        )}
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
        {item.link_url && (
          <a
            href={item.link_url}
            className="btn btn-primary mt-6"
            target={/^https?:\/\//.test(item.link_url) ? "_blank" : undefined}
            rel={/^https?:\/\//.test(item.link_url) ? "noreferrer" : undefined}
          >
            {item.link_label || "前往連結"}
          </a>
        )}
        <div className="mt-8 border-t pt-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
          公告人：{item.author_name || "未命名"}
        </div>
      </div>
    </article>
  );
}
