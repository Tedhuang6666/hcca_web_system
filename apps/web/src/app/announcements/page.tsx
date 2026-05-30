"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { announcementsApi, ApiError } from "@/lib/api";
import type { AnnouncementListItem } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import ActivitySelect from "@/components/activities/ActivitySelect";
import type { Activity } from "@/lib/types";

const AUDIENCE_LABEL: Record<string, string> = {
  all: "全體",
  school: "全體竹中生",
  orgs: "特定組織",
  members: "特定成員",
};

function StatusBadge({ item }: { item: AnnouncementListItem }) {
  if (item.is_urgent) {
    return (
      <span className="badge" style={{ color: "var(--danger)", background: "var(--danger-dim)", borderColor: "var(--danger-border)" }}>
        緊急
      </span>
    );
  }
  if (!item.is_published) {
    return (
      <span className="badge" style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", borderColor: "var(--border)" }}>
        草稿
      </span>
    );
  }
  return (
    <span className="badge" style={{ color: "var(--success)", background: "var(--success-dim)", borderColor: "var(--success-border)" }}>
      已發布
    </span>
  );
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState<AnnouncementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDrafts, setShowDrafts] = useState(false);
  const [activityId, setActivityId] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const { can, canAny } = usePermissions();
  const canCreate = can("announcement:create") || activities.length > 0;
  const canListDrafts = can("announcement:create");
  const canManage = canAny(
    "announcement:create",
    "announcement:edit",
    "announcement:publish",
    "announcement:set_urgent",
    "announcement:media_manage",
  );

  useEffect(() => {
    setLoading(true);
    const params = { limit: 100, activity_id: activityId || undefined };
    const req = showDrafts && canListDrafts
      ? announcementsApi.listAll(params)
      : announcementsApi.list(params);
    req
      .then(setItems)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入公告失敗"))
      .finally(() => setLoading(false));
  }, [activityId, showDrafts, canListDrafts]);

  const activityNameById = useMemo(
    () => new Map(activities.map((activity) => [activity.id, activity.name])),
    [activities],
  );

  const sorted = useMemo(
    () => [...items].sort((a, b) => (
      (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at)
    )),
    [items],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">公告檢視</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            瀏覽學生自治平台的公開消息與緊急通知
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canListDrafts && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowDrafts((value) => !value)}>
              {showDrafts ? "只看公開" : "顯示草稿"}
            </button>
          )}
          {canCreate && (
            <Link href="/announcements/new" className="btn btn-primary">
              新增公告
            </Link>
          )}
        </div>
      </div>

      <section className="card p-4">
        <ActivitySelect
          value={activityId}
          onChange={setActivityId}
          label="依活動篩選"
          noneLabel="全部公告"
          scope="all"
          onActivitiesLoaded={setActivities}
        />
      </section>

      {loading ? (
        <ListPageSkeleton rows={5} showHeader={false} showFilters={false} />
      ) : sorted.length === 0 ? (
        <div className="card p-10 text-center" style={{ color: "var(--text-muted)" }}>
          目前沒有公告
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => (
            <Link
              key={item.id}
              href={`/announcements/${item.id}`}
              className="card card-hover block p-5"
              style={{ textDecoration: "none" }}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusBadge item={item} />
                    {item.audience_type !== "all" && (
                      <span className="badge" style={{ color: "var(--primary)", background: "var(--primary-dim)", borderColor: "var(--border-strong)" }}>
                        {AUDIENCE_LABEL[item.audience_type] ?? item.audience_type}
                      </span>
                    )}
                    {item.activity_id && (
                      <span className="badge" style={{ color: "var(--info)", background: "var(--info-dim)", borderColor: "var(--border-strong)" }}>
                        {activityNameById.get(item.activity_id) ?? "活動公告"}
                      </span>
                    )}
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {item.published_at
                        ? new Date(item.published_at).toLocaleString("zh-TW")
                        : new Date(item.created_at).toLocaleString("zh-TW")}
                    </span>
                  </div>
                  <h2 className="text-base font-semibold leading-snug">{item.title}</h2>
                  <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    公告人：{item.author_name || "未命名"}
                  </p>
                </div>
                {canManage && (
                  <span className="btn btn-sm btn-ghost self-start">
                    管理
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
