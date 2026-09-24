"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { announcementsApi, apiErrorMessage } from "@/lib/api";
import AnnouncementEditor from "@/components/announcements/AnnouncementEditor";
import AnnouncementAudiencePicker, {
  type AudienceValue,
} from "@/components/announcements/AnnouncementAudiencePicker";
import { contentFromMarkdown } from "@/components/announcements/AnnouncementMarkdown";
import { usePermissions } from "@/hooks/usePermissions";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";

const DEFAULT_AUDIENCE: AudienceValue = {
  audience_type: "all",
  audience_org_ids: [],
  audience_user_ids: [],
};

type AnnouncementDraft = {
  title: string;
  markdown: string;
  isUrgent: boolean;
  urgentUntil: string;
  linkUrl: string;
  linkLabel: string;
  showOnEveryVisit: boolean;
};

export default function NewAnnouncementPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [urgentUntil, setUrgentUntil] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [showOnEveryVisit, setShowOnEveryVisit] = useState(false);
  const [audience, setAudience] = useState<AudienceValue>(DEFAULT_AUDIENCE);
  const [saving, setSaving] = useState(false);
  const canCreateGlobal = can("announcement:create");
  const canPublish = can("announcement:publish");
  const canUrgent = can("announcement:set_urgent");
  const draftValue = useMemo<AnnouncementDraft>(() => ({
    title,
    markdown,
    isUrgent,
    urgentUntil,
    linkUrl,
    linkLabel,
    showOnEveryVisit,
  }), [isUrgent, linkLabel, linkUrl, markdown, showOnEveryVisit, title, urgentUntil]);
  const restoreDraft = useCallback((draft: AnnouncementDraft) => {
    setTitle(draft.title ?? "");
    setMarkdown(draft.markdown ?? "");
    setIsUrgent(Boolean(draft.isUrgent));
    setUrgentUntil(draft.urgentUntil ?? "");
    setLinkUrl(draft.linkUrl ?? "");
    setLinkLabel(draft.linkLabel ?? "");
    setShowOnEveryVisit(Boolean(draft.showOnEveryVisit));
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
      && !draft.linkUrl
      && !draft.linkLabel
      && !draft.showOnEveryVisit
    ), []),
  });
  const canCreate = canCreateGlobal;

  const save = async (publish: boolean) => {
    if (!title.trim()) {
      toast.error("請輸入公告標題");
      return;
    }
    if (audience.audience_type === "orgs" && audience.audience_org_ids.length === 0) {
      toast.error("對象為特定組織時，請至少選擇一個組織");
      return;
    }
    if (audience.audience_type === "members" && audience.audience_user_ids.length === 0) {
      toast.error("對象為特定成員時，請至少選擇一位成員");
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
        link_url: linkUrl.trim() || null,
        link_label: linkUrl.trim() ? linkLabel.trim() || null : null,
        show_on_every_visit: canUrgent && isUrgent && showOnEveryVisit,
        audience_type: audience.audience_type,
        audience_org_ids: audience.audience_org_ids,
        audience_user_ids: audience.audience_user_ids,
      });
      if (publish && canPublish) {
        await announcementsApi.publish(created.id);
      }
      clearDraft();
      toast.success(publish && canPublish ? "公告已發布" : "公告草稿已建立");
      router.push(`/announcements/${created.id}/edit`);
    } catch (e) {
      flushDraft();
      toast.error(apiErrorMessage(e, "建立公告失敗"));
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

      <AnnouncementAudiencePicker onChange={setAudience} />

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">行動連結</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            選填。可填入站內路徑或完整 HTTP(S) 網址，讓讀者直接前往下一步。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className="space-y-1 text-sm">
            <span>連結網址</span>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="input w-full"
              placeholder="https://example.com 或 /merchandise-submissions"
              maxLength={500}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>按鈕文字</span>
            <input
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              className="input w-full"
              placeholder="前往連結"
              maxLength={60}
              disabled={!linkUrl.trim()}
            />
          </label>
        </div>
      </section>


      {canUrgent && (
        <section className="card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
              <input
                type="checkbox"
                checked={isUrgent}
                onChange={(e) => setIsUrgent(e.target.checked)}
              />
              設為重要公告
            </label>
            <input
              type="datetime-local"
              value={urgentUntil}
              onChange={(e) => setUrgentUntil(e.target.value)}
              className="input sm:!w-64"
              disabled={!isUrgent}
            />
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            不設定截止時間時，重要公告會持續顯示到手動關閉。
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showOnEveryVisit}
              onChange={(e) => setShowOnEveryVisit(e.target.checked)}
              disabled={!isUrgent}
            />
            每次進入系統時顯示
          </label>
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
