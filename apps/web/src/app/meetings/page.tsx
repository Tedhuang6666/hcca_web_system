"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Plus, Radio, ScreenShare, Settings } from "lucide-react";
import { meetingsApi, orgsApi } from "@/lib/api";
import type { MeetingListItem, MeetingWorkspaceOut, OrgRead } from "@/lib/types";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";
import { orgDisplayName } from "@/lib/orgs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePersistedState } from "@/hooks/usePersistedState";
import {
  GovernanceLinkNotice,
  createGovernanceBacklink,
  governanceContextFromParams,
} from "@/lib/governanceLinking";

const statusLabel: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  paused: "暫停",
  closed: "已結束",
};

const MeetingCard = memo(function MeetingCard({ meeting }: { meeting: MeetingListItem }) {
  return (
    <article key={meeting.id} className="rounded-lg border border-[var(--border)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/meetings/${meeting.id}`} className="text-lg font-semibold hover:underline">
            {meeting.title}
          </Link>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {statusLabel[meeting.status]} · {meeting.location || "未填地點"} · 主席{" "}
            {meeting.chair_name || "未填"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {meeting.status === "draft" && (
            <Link
              href={`/meetings/${meeting.id}/edit`}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Settings size={15} aria-hidden="true" />
              設定
            </Link>
          )}
          <Link
            href={`/meetings/${meeting.id}/control`}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <Radio size={15} aria-hidden="true" />
            控制台
          </Link>
          <Link
            href={`/meetings/${meeting.id}`}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <ScreenShare size={15} aria-hidden="true" />
            大屏連結
          </Link>
        </div>
      </div>
    </article>
  );
});

const MTG_LIST_KEY = "meetings/list";
const MTG_ORGS_KEY = "meetings/orgs";

export default function MeetingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const governanceContext = useMemo(
    () => governanceContextFromParams(searchParams),
    [searchParams],
  );
  const governanceOrgId = governanceContext?.orgId;
  const [items, setItems] = useState<MeetingListItem[]>(() => cacheGet<MeetingListItem[]>(MTG_LIST_KEY) ?? []);
  const [orgs, setOrgs] = useState<OrgRead[]>(() => cacheGet<OrgRead[]>(MTG_ORGS_KEY) ?? []);
  const [workspace, setWorkspace] = useState<MeetingWorkspaceOut | null>(null);
  const [title, setTitle] = useState(governanceContext?.matterTitle ?? "");
  // 記住上次建立會議所選的組織，常為同一組織辦會議者免每次重選。
  const [orgId, setOrgId] = usePersistedState<string>("hcca:pref:meetings:org:v1", "");
  const [loading, setLoading] = useState(!cacheHas(MTG_LIST_KEY));
  const [error, setError] = useState("");
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [isSuperuser, setIsSuperuser] = useState(false);

  useEffect(() => {
    setIsSuperuser(sessionStorage.getItem("is_superuser") === "true");
    try {
      setPermissions(new Set(JSON.parse(sessionStorage.getItem("permissions") || "[]")));
    } catch {
      setPermissions(new Set());
    }
  }, []);

  const canCreateMeeting = useMemo(
    () => isSuperuser || permissions.has("admin:all") || permissions.has("meeting:create"),
    [isSuperuser, permissions],
  );

  const load = useCallback(async () => {
    if (!cacheHas(MTG_LIST_KEY)) setLoading(true);
    setError("");
    try {
      const [meetings, orgList, ws] = await Promise.all([
        meetingsApi.list(),
        orgsApi.list({ active_only: true }).then(async (activeOrgs) =>
          activeOrgs.length > 0 ? activeOrgs : orgsApi.list()
        ),
        meetingsApi.workspace().catch(() => null),
      ]);
      setWorkspace(ws);
      setItems(meetings);
      cacheSet(MTG_LIST_KEY, meetings);
      setOrgs(orgList);
      cacheSet(MTG_ORGS_KEY, orgList);
      setOrgId((current) => {
        if (governanceOrgId && orgList.some((org) => org.id === governanceOrgId)) {
          return governanceOrgId;
        }
        return current || orgList[0]?.id || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入會議失敗");
    } finally {
      setLoading(false);
    }
  }, [governanceOrgId, setOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createMeeting() {
    if (!title.trim() || !orgId.trim()) return;
    setError("");
    try {
      const meeting = await meetingsApi.create({
        title: title.trim(),
        org_id: orgId.trim(),
        expected_voters: 0,
        quorum_count: 0,
        default_pass_threshold: 0,
      });
      await createGovernanceBacklink({
        context: governanceContext,
        targetType: "meeting",
        targetId: meeting.id,
        title: meeting.title,
        href: `/meetings/${meeting.id}`,
      });
      setTitle("");
      // 保留 orgId 作為下次預設（常為同一組織連續辦會議）。
      router.push(`/meetings/${meeting.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立會議失敗");
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-6">
      <div className="workspace-header mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">會議</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">安排議程、出席與表決。</p>
        </div>
        <Link
          href="/meetings/calendar"
          className="inline-flex items-center gap-2 self-start rounded-md border border-[var(--border)] px-3 py-2 text-sm">
          <CalendarDays size={16} aria-hidden="true" />
          行事曆
        </Link>
        <Link href="/meetings/screen/demo" className="hidden" aria-hidden="true" />
      </div>

      <GovernanceLinkNotice context={governanceContext} />

      {canCreateMeeting ? (
        <section className="mb-6 grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-[var(--border)] p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="會議名稱"
            className="min-w-0 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="min-w-0 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
            <option value="">選擇組織</option>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {orgDisplayName(org, orgs)}
              </option>
            ))}
          </select>
          <button
            onClick={createMeeting}
            disabled={!title.trim() || !orgId}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50">
            <Plus size={16} aria-hidden="true" />
            建立會議
          </button>
        </section>
      ) : (
        <section className="mb-6 rounded-lg border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          目前帳號可以查看會議，但沒有建立會議權限。
        </section>
      )}

      {workspace && (
        <section className="mb-6 grid gap-3 sm:grid-cols-4">
          {[
            ["今日會議", workspace.today.length],
            ["草稿籌備", workspace.drafts.length],
            ["進行中", workspace.active.length],
            ["已結束", workspace.closing_pending.length],
          ].map(([label, count]) => (
            <div key={label} className="rounded-lg border border-[var(--border)] p-4">
              <p className="text-xs text-[var(--muted)]">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{count}</p>
            </div>
          ))}
        </section>
      )}

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {loading ? (
        <ListPageSkeleton rows={5} showHeader={false} showFilters={false} />
      ) : (
        <div className="grid gap-3">
          {items.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
              <p className="text-base font-medium">目前還沒有會議</p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                選擇組織並建立第一場會議後，這裡會顯示控制台、大屏與議員入口。
              </p>
            </div>
          )}
          {items.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </div>
      )}
    </main>
  );
}
