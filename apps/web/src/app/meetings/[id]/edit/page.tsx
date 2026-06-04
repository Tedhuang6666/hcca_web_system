"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileText,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { adminApi, classApi, meetingsApi, orgsApi, serialTemplatesApi } from "@/lib/api";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";
import type {
  AttendanceRole,
  AttendanceSourceType,
  MeetingBillStage,
  MeetingMode,
  MeetingOut,
  MeetingRegulationBrief,
  OrgRead,
  PositionSummary,
  SerialTemplateOut,
  SchoolClassListItem,
} from "@/lib/types";

const WORKFLOW_LABEL: Record<string, string> = {
  draft: "草稿",
  under_review: "送審中",
  scheduled: "已排入議程",
  council_approved: "議會核定",
  published: "已公布",
  rejected: "已退回",
  archived: "已廢止",
};
const AMENDMENT_LABEL: Record<string, string> = { enact: "制定", amend: "修正", abolish: "廢止" };
const STAGE_LABEL: Record<string, string> = {
  standing_committee: "常務委員會",
  council: "議會",
};
const STAGE_HINT: Record<string, string> = {
  standing_committee: "自動偵測「送審中」的新提案；表決通過後法案推進為「已排入議程」。",
  council: "自動偵測常委會通過、「已排入議程」的法案；表決通過後法案推進為「議會核定」。",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
function fromLocalInput(local: string): string | null {
  return local ? new Date(local).toISOString() : null;
}

function toUpdatePayload(form: SettingsForm) {
  return {
    title: form.title.trim(),
    mode: form.mode,
    description: form.description.trim() || null,
    location: form.location.trim() || null,
    chair_name: form.chair_name.trim() || null,
    starts_at: fromLocalInput(form.starts_at),
    ends_at: fromLocalInput(form.ends_at),
    expected_voters: form.expected_voters,
    quorum_count: form.quorum_count,
    default_pass_threshold: form.default_pass_threshold,
    default_speech_seconds: form.default_speech_seconds,
    allow_observer_requests: form.allow_observer_requests,
    bill_stage: form.bill_stage || null,
  };
}

interface SettingsForm {
  title: string;
  mode: MeetingMode;
  description: string;
  location: string;
  chair_name: string;
  starts_at: string;
  ends_at: string;
  expected_voters: number;
  quorum_count: number;
  default_pass_threshold: number;
  default_speech_seconds: number;
  allow_observer_requests: boolean;
  bill_stage: "" | MeetingBillStage;
}

function toForm(m: MeetingOut): SettingsForm {
  return {
    title: m.title,
    mode: m.mode,
    description: m.description ?? "",
    location: m.location ?? "",
    chair_name: m.chair_name ?? "",
    starts_at: toLocalInput(m.starts_at),
    ends_at: toLocalInput(m.ends_at),
    expected_voters: m.expected_voters,
    quorum_count: m.quorum_count,
    default_pass_threshold: m.default_pass_threshold,
    default_speech_seconds: m.default_speech_seconds,
    allow_observer_requests: m.allow_observer_requests,
    bill_stage: m.bill_stage ?? "",
  };
}

export default function MeetingSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [meeting, setMeeting] = useState<MeetingOut | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [originalForm, setOriginalForm] = useState<SettingsForm | null>(null);
  const [proposals, setProposals] = useState<MeetingRegulationBrief[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [sourceType, setSourceType] = useState<AttendanceSourceType>("class_cadres");
  const [sourceId, setSourceId] = useState("");
  const [sourceRole, setSourceRole] = useState<AttendanceRole>("voter");
  const [sourceVoting, setSourceVoting] = useState(true);
  const [sourcePreview, setSourcePreview] = useState("");
  const [serialTemplates, setSerialTemplates] = useState<SerialTemplateOut[]>([]);
  const [noticeSerialTemplateId, setNoticeSerialTemplateId] = useState("");
  const [noticeSerialNumber, setNoticeSerialNumber] = useState("");
  const [attachmentDrafts, setAttachmentDrafts] = useState<
    Record<string, { url: string; label: string }>
  >({});

  useEffect(() => {
    void params.then(({ id: nextId }) => setId(nextId));
  }, [params]);

  // 取回會議與待審法案，但不重設基本設定表單（避免覆蓋未儲存的編輯）
  const fetchMeeting = useCallback(async () => {
    const data = await meetingsApi.get(id);
    setMeeting(data);
    setProposals(data.bill_stage ? await meetingsApi.proposableRegulations(id) : []);
    return data;
  }, [id]);

  // 完整載入：含重設基本設定表單（初次載入、儲存或確認後使用）
  const load = useCallback(async () => {
    if (!id) return;
    setError("");
    try {
      const data = await fetchMeeting();
      setForm(toForm(data));
      setOriginalForm(toForm(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入會議失敗");
    }
  }, [id, fetchMeeting]);

  // 議程異動後僅刷新會議資料，保留使用者尚未儲存的基本設定
  const refreshMeeting = useCallback(async () => {
    if (!id) return;
    try {
      await fetchMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入會議失敗");
    }
  }, [id, fetchMeeting]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!meeting?.org_id || meeting.confirmed_at) return;
    serialTemplatesApi
      .list({ org_id: meeting.org_id, active_only: true })
      .then((rows) => {
        setSerialTemplates(rows);
        const defaultTemplate = rows.find((item) => item.is_default) ?? rows[0];
        setNoticeSerialTemplateId((prev) => prev || defaultTemplate?.id || "");
      })
      .catch(() => setSerialTemplates([]));
  }, [meeting?.confirmed_at, meeting?.org_id]);

  useEffect(() => {
    async function loadRosterOptions() {
      try {
        const [classRows, orgRows, positionRows] = await Promise.all([
          classApi.list({ is_active: "true" }),
          orgsApi.list({ active_only: true }),
          adminApi.listPositions(),
        ]);
        setClasses(classRows);
        setOrgs(orgRows);
        setPositions(positionRows);
      } catch {
        // 名冊來源選項載入失敗不阻擋會議設定主流程。
      }
    }
    void loadRosterOptions();
  }, []);

  const isDraft = meeting?.status === "draft";

  // 基本設定草稿即時儲存：離開或非正常關閉頁面時自動保存到本機
  const restoreDraft = useCallback((value: SettingsForm | null) => {
    if (value) {
      setForm(value);
      setNotice("已自動復原上次未儲存的設定變更");
    }
  }, []);
  const isFormUnchanged = useCallback(
    (value: SettingsForm | null) =>
      !value || !originalForm || JSON.stringify(value) === JSON.stringify(originalForm),
    [originalForm],
  );
  const { clearDraft } = useDraftAutosave<SettingsForm | null>({
    key: `meeting-setup:${id}`,
    value: form,
    onRestore: restoreDraft,
    enabled: isDraft && Boolean(id),
    isEmpty: isFormUnchanged,
  });
  const isConfirmed = Boolean(meeting?.confirmed_at);
  const agenda = useMemo(
    () => (meeting ? [...meeting.agenda_items].sort((a, b) => a.order_index - b.order_index) : []),
    [meeting],
  );
  const nextOrder = () => (agenda.length ? Math.max(...agenda.map((a) => a.order_index)) + 1 : 0);

  async function saveSettings() {
    if (!form || !id) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await meetingsApi.update(id, toUpdatePayload(form));
      clearDraft();
      setNotice("基本設定已儲存");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function addManualItem() {
    if (!id || !newTitle.trim()) return;
    setError("");
    try {
      const item = await meetingsApi.addAgendaItem(id, {
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        item_type: "manual",
        order_index: nextOrder(),
      });
      if (newLinkUrl.trim()) {
        await meetingsApi.addAgendaAttachmentLink(id, item.id, {
          url: newLinkUrl.trim(),
          display_text: newLinkLabel.trim() || null,
        });
      }
      for (const file of newFiles) {
        await meetingsApi.uploadAgendaAttachment(id, item.id, file);
      }
      setNewTitle("");
      setNewDescription("");
      setNewLinkUrl("");
      setNewLinkLabel("");
      setNewFiles([]);
      await refreshMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增議案失敗");
    }
  }

  async function addProposal(reg: MeetingRegulationBrief) {
    if (!id) return;
    setError("");
    try {
      await meetingsApi.addAgendaItem(id, {
        title: `審議：${reg.title}`,
        item_type: "regulation",
        order_index: nextOrder(),
        regulation_id: reg.id,
      });
      await refreshMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "排入議程失敗");
    }
  }

  async function syncAllProposals() {
    if (!id) return;
    setError("");
    setNotice("");
    try {
      await meetingsApi.syncProposals(id);
      setNotice("已將偵測到的待審法案全部排入議程");
      await refreshMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "自動排入失敗");
    }
  }

  async function removeAgendaItem(itemId: string) {
    if (!id) return;
    setError("");
    try {
      await meetingsApi.deleteAgendaItem(id, itemId);
      await refreshMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除議程失敗");
    }
  }

  async function removeAgendaAttachment(itemId: string, attachmentId: string) {
    if (!id) return;
    setError("");
    try {
      await meetingsApi.deleteAgendaAttachment(id, itemId, attachmentId);
      await refreshMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除附件失敗");
    }
  }

  async function uploadAgendaFiles(itemId: string, files: FileList | null) {
    if (!id || !files?.length) return;
    setError("");
    try {
      for (const file of Array.from(files)) {
        await meetingsApi.uploadAgendaAttachment(id, itemId, file);
      }
      await refreshMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳附件失敗");
    }
  }

  async function addAgendaLink(itemId: string) {
    if (!id) return;
    const draft = attachmentDrafts[itemId];
    if (!draft?.url.trim()) return;
    setError("");
    try {
      await meetingsApi.addAgendaAttachmentLink(id, itemId, {
        url: draft.url.trim(),
        display_text: draft.label.trim() || null,
      });
      setAttachmentDrafts((current) => ({ ...current, [itemId]: { url: "", label: "" } }));
      await refreshMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增連結附件失敗");
    }
  }

  async function moveAgendaItem(index: number, dir: -1 | 1) {
    if (!id) return;
    const target = agenda[index];
    const swap = agenda[index + dir];
    if (!target || !swap) return;
    setError("");
    try {
      await meetingsApi.updateAgendaItem(id, target.id, { order_index: swap.order_index });
      await meetingsApi.updateAgendaItem(id, swap.id, { order_index: target.order_index });
      await refreshMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "排序失敗");
    }
  }

  async function confirmMeeting() {
    if (!id || !form) return;
    setConfirming(true);
    setError("");
    setNotice("");
    try {
      // 先持久化目前表單：避免使用者已填開會時間/地點但尚未按「儲存」，
      // 導致後端讀到舊的 null 值而誤報「請先設定開會時間」。
      if (!isFormUnchanged(form)) {
        await meetingsApi.update(id, toUpdatePayload(form));
        clearDraft();
      }
      await meetingsApi.confirm(id, {
        notice_serial_template_id: noticeSerialNumber.trim() ? null : noticeSerialTemplateId || null,
        notice_serial_number: noticeSerialNumber.trim() || null,
      });
      setNotice("議程已確認，開會通知單草稿已建立。");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "確認議程失敗");
    } finally {
      setConfirming(false);
    }
  }

  async function previewAttendanceSource() {
    if (!id) return;
    setError("");
    try {
      const preview = await meetingsApi.resolveAttendanceSource(id, {
        source_type: sourceType,
        source_id: sourceId || null,
        role: sourceRole,
        is_voting_eligible: sourceVoting,
      });
      setSourcePreview(`${preview.label}：${preview.count} 人`);
    } catch (err) {
      setSourcePreview("");
      setError(err instanceof Error ? err.message : "預覽名冊來源失敗");
    }
  }

  async function importAttendanceSource() {
    if (!id) return;
    setError("");
    try {
      const source = await meetingsApi.importAttendanceSource(id, {
        source_type: sourceType,
        source_id: sourceId || null,
        role: sourceRole,
        is_voting_eligible: sourceVoting,
      });
      setNotice(`已匯入 ${source.label}，共 ${source.imported_count} 人`);
      setSourcePreview("");
      await refreshMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "匯入名冊失敗");
    }
  }

  if (error && !meeting) return <main className="p-6 text-sm text-red-500">{error}</main>;
  if (!meeting || !form) return <main className="p-6 text-sm text-[var(--muted)]">載入中...</main>;

  const canConfirm =
    isDraft &&
    !isConfirmed &&
    agenda.length > 0 &&
    Boolean(form.starts_at) &&
    Boolean(form.location.trim());
  const votingRoster = meeting.attendance_records.filter((record) => record.is_voting_eligible);
  const setupSteps = [
    {
      title: "基本資料",
      done: Boolean(form.title.trim() && form.starts_at && form.location.trim()),
      detail: form.starts_at && form.location.trim() ? "時間與地點已填" : "請補時間與地點",
    },
    {
      title: "議程 / 資料包",
      done: agenda.length > 0,
      detail: agenda.length ? `${agenda.length} 個議程項目` : "請新增至少一個議程",
    },
    {
      title: "名冊 / 表決權",
      done: votingRoster.length > 0,
      detail: votingRoster.length
        ? `${votingRoster.length} 位表決權人；同班只允許一位`
        : "請匯入或補登表決權人",
    },
    {
      title: "通知單確認",
      done: isConfirmed,
      detail: isConfirmed ? "已產生開會通知單" : "確認後會自動產生開會通知單",
    },
  ];

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">會議設定</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            預先設定基本資料與議程，存為草稿；常委會／議會會議可自動偵測待審法案。
          </p>
        </div>
        <Link
          href={`/meetings/${meeting.id}`}
          className="inline-flex items-center justify-center rounded-md border border-[var(--border)] px-3 py-2 text-sm">
          回會議頁
        </Link>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
      {notice && <p className="mb-4 text-sm text-emerald-500">{notice}</p>}

      <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {setupSteps.map((step, index) => (
            <div
              key={step.title}
              className={`rounded-md border p-3 ${
                step.done ? "border-emerald-500/40 bg-emerald-500/10" : "border-[var(--border)]"
              }`}>
              <p className="text-xs text-[var(--muted)]">步驟 {index + 1}</p>
              <div className="mt-2 flex items-center gap-2">
                <CheckCircle2
                  size={16}
                  className={step.done ? "text-emerald-500" : "text-[var(--muted)]"}
                  aria-hidden="true"
                />
                <h2 className="text-sm font-semibold">{step.title}</h2>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {!isDraft && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          會議已開始或結束，僅供檢視，無法再變更草稿設定。
        </p>
      )}

      {/* ── 基本設定 ───────────────────────────────────────── */}
      <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
        <h2 className="mb-3 text-lg font-semibold">基本設定</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-[var(--muted)]">會議名稱</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-[var(--muted)]">議事模式</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: "simple" as MeetingMode,
                    title: "簡易評議",
                    detail: "委員會適用。點名出席、逐案討論表決（無異議通過 / 計票 / 逐人），自動產生會議紀錄。",
                  },
                  {
                    value: "full" as MeetingMode,
                    title: "完整議事",
                    detail: "議會適用。報到、議員手機端逐人電子表決＋門檻、發言計時、動議與法案推進。",
                  },
                ]
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!isDraft}
                  onClick={() => setForm({ ...form, mode: opt.value })}
                  className={`rounded-md border p-3 text-left ${
                    form.mode === opt.value
                      ? "border-[var(--primary)] bg-[var(--primary-dim)]"
                      : "border-[var(--border)]"
                  } disabled:cursor-not-allowed disabled:opacity-60`}>
                  <span className="block font-medium">{opt.title}</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">{opt.detail}</span>
                </button>
              ))}
            </div>
            {form.mode === "simple" && form.bill_stage && (
              <span className="text-xs text-amber-600">
                法案審議（{STAGE_LABEL[form.bill_stage]}）需要逐人表決與法案推進，建議改用「完整議事」。
              </span>
            )}
          </div>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-[var(--muted)]">會議性質（法案審議階段）</span>
            <select
              value={form.bill_stage}
              onChange={(e) =>
                setForm({ ...form, bill_stage: e.target.value as "" | MeetingBillStage })
              }
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2">
              <option value="">一般會議（不自動帶入法案）</option>
              <option value="standing_committee">常務委員會（審議新提案）</option>
              <option value="council">議會（審議常委會通過案）</option>
            </select>
            {form.bill_stage && (
              <span className="text-xs text-[var(--muted)]">{STAGE_HINT[form.bill_stage]}</span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-[var(--muted)]">開會事由 / 說明</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">開會地點</span>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">主席</span>
            <input
              value={form.chair_name}
              onChange={(e) => setForm({ ...form, chair_name: e.target.value })}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">開會時間（留空則為手動開會）</span>
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">預計結束時間</span>
            <input
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
          {form.mode === "full" && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">預計表決權人數</span>
                <input
                  type="number"
                  min={0}
                  value={form.expected_voters}
                  onChange={(e) => setForm({ ...form, expected_voters: Number(e.target.value) || 0 })}
                  className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">法定開議人數（quorum）</span>
                <input
                  type="number"
                  min={0}
                  value={form.quorum_count}
                  onChange={(e) => setForm({ ...form, quorum_count: Number(e.target.value) || 0 })}
                  className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">預設表決通過門檻（票）</span>
                <input
                  type="number"
                  min={0}
                  value={form.default_pass_threshold}
                  onChange={(e) =>
                    setForm({ ...form, default_pass_threshold: Number(e.target.value) || 0 })
                  }
                  className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">預設發言時間（秒）</span>
                <input
                  type="number"
                  min={10}
                  value={form.default_speech_seconds}
                  onChange={(e) =>
                    setForm({ ...form, default_speech_seconds: Number(e.target.value) || 180 })
                  }
                  className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                />
              </label>
              <label className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.allow_observer_requests}
                  onChange={(e) =>
                    setForm({ ...form, allow_observer_requests: e.target.checked })
                  }
                />
                <span>允許旁聽者提出現場請求</span>
              </label>
            </>
          )}
        </div>
        <button
          onClick={saveSettings}
          disabled={saving || !isDraft}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">
          <Save size={16} aria-hidden="true" />
          {saving ? "儲存中..." : "儲存基本設定"}
        </button>
      </section>

      <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">出席名冊來源</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              可快速加入班級幹部、班級成員、組織或職位成員；QR 入口會依名冊顯示報到、投票與資料包。
            </p>
          </div>
          <Link
            href={`/meetings/join/${meeting.checkin_token}`}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            預覽會議入口
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_9rem_9rem_auto]">
          <select
            value={sourceType}
            onChange={(e) => {
              setSourceType(e.target.value as AttendanceSourceType);
              setSourceId("");
              setSourcePreview("");
            }}
            className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
            <option value="class_cadres">班級幹部</option>
            <option value="class_members">班級全體</option>
            <option value="org_members">組織成員</option>
            <option value="position_members">職位成員</option>
          </select>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
            <option value="">選擇來源</option>
            {(sourceType === "class_cadres" || sourceType === "class_members") &&
              classes.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label || `${row.academic_year} ${row.class_code}`}
                </option>
              ))}
            {sourceType === "org_members" &&
              orgs.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            {sourceType === "position_members" &&
              positions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.org_name} / {row.name}
                </option>
              ))}
          </select>
          <select
            value={sourceRole}
            onChange={(e) => setSourceRole(e.target.value as AttendanceRole)}
            className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
            <option value="voter">表決權人</option>
            <option value="attendee">列席</option>
            <option value="observer">旁聽</option>
          </select>
          <label className="flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={sourceVoting}
              onChange={(e) => setSourceVoting(e.target.checked)}
            />
            可投票
          </label>
          <div className="flex gap-2">
            <button
              onClick={previewAttendanceSource}
              disabled={!sourceId}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
              預覽
            </button>
            <button
              onClick={importAttendanceSource}
              disabled={!sourceId}
              className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50">
              匯入
            </button>
          </div>
        </div>
        {sourcePreview && <p className="mt-3 text-sm text-[var(--muted)]">{sourcePreview}</p>}
        <div className="mt-4 grid gap-2">
          {meeting.attendance_sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <span>{source.label}</span>
              <span className="text-[var(--muted)]">{source.imported_count} 人</span>
            </div>
          ))}
          {meeting.attendance_sources.length === 0 && (
            <p className="text-sm text-[var(--muted)]">尚未匯入名冊來源。</p>
          )}
        </div>
      </section>

      {/* ── 待審法案自動偵測 ───────────────────────────────── */}
      {meeting.bill_stage && (
        <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
          <div className="mb-1 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">
              待審法案（{STAGE_LABEL[meeting.bill_stage]}自動偵測）
            </h2>
            {isDraft && proposals.length > 0 && (
              <button
                onClick={syncAllProposals}
                className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black sm:w-auto sm:py-1.5">
                <RefreshCw size={14} aria-hidden="true" />
                全部排入議程（{proposals.length}）
              </button>
            )}
          </div>
          <p className="mb-3 text-sm text-[var(--muted)]">
            系統依會議性質自動偵測尚未排入議程的法案，可逐件或一次全部加入，再於下方議程重新排序。
          </p>
          <div className="grid gap-2">
            {proposals.map((reg) => (
              <div
                key={reg.id}
                className="flex items-start justify-between gap-3 rounded-md border border-[var(--border)] p-3 text-sm">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="rounded bg-[var(--border)] px-1.5 py-0.5 text-xs">
                    {AMENDMENT_LABEL[reg.amendment_type]}案
                  </span>
                  <Link href={`/regulations/${reg.id}`} className="hover:underline">
                    {reg.title}
                  </Link>
                  <span className="text-xs text-[var(--muted)]">v{reg.version}</span>
                </span>
                {isDraft && (
                  <button
                    onClick={() => addProposal(reg)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs">
                    <Plus size={13} aria-hidden="true" />
                    加入
                  </button>
                )}
              </div>
            ))}
            {proposals.length === 0 && (
              <p className="text-sm text-[var(--muted)]">目前沒有偵測到尚未排入議程的待審法案。</p>
            )}
          </div>
        </section>
      )}

      {/* ── 議程 ───────────────────────────────────────────── */}
      <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
        <h2 className="mb-3 text-lg font-semibold">議程</h2>
        <div className="grid gap-2">
          {agenda.map((item, index) => (
            <div key={item.id} className="rounded-md border border-[var(--border)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {index + 1}. {item.title}
                  </p>
                  {item.regulation && (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                      <span className="rounded bg-[var(--border)] px-1.5 py-0.5">
                        {AMENDMENT_LABEL[item.regulation.amendment_type]}案
                      </span>
                      <Link href={`/regulations/${item.regulation.id}`} className="hover:underline">
                        {item.regulation.title}
                      </Link>
                      <span>· v{item.regulation.version}</span>
                      <span>· {WORKFLOW_LABEL[item.regulation.workflow_status]}</span>
                    </p>
                  )}
                  {item.description && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">
                      {item.description}
                    </p>
                  )}
                  {item.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.attachments.map((attachment) => {
                        const href =
                          attachment.link_url ||
                          meetingsApi.agendaAttachmentDownloadUrl(id, item.id, attachment.id);
                        return (
                          <span
                            key={attachment.id}
                            className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs">
                            <Paperclip size={12} aria-hidden="true" />
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate hover:underline">
                              {attachment.display_name || attachment.filename}
                            </a>
                            {isDraft && (
                              <button
                                onClick={() => removeAgendaAttachment(item.id, attachment.id)}
                                aria-label="刪除附件"
                                className="text-red-500">
                                <Trash2 size={12} aria-hidden="true" />
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {isDraft && (
                    <div className="mt-3 grid gap-2 rounded-md border border-dashed border-[var(--border)] p-2 sm:grid-cols-[1fr_10rem_auto]">
                      <input
                        value={attachmentDrafts[item.id]?.url ?? ""}
                        onChange={(e) =>
                          setAttachmentDrafts((current) => ({
                            ...current,
                            [item.id]: {
                              url: e.target.value,
                              label: current[item.id]?.label ?? "",
                            },
                          }))
                        }
                        placeholder="新增附件連結"
                        className="min-w-0 rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs"
                      />
                      <input
                        value={attachmentDrafts[item.id]?.label ?? ""}
                        onChange={(e) =>
                          setAttachmentDrafts((current) => ({
                            ...current,
                            [item.id]: {
                              url: current[item.id]?.url ?? "",
                              label: e.target.value,
                            },
                          }))
                        }
                        placeholder="顯示名稱"
                        className="min-w-0 rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs"
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={() => addAgendaLink(item.id)}
                          disabled={!attachmentDrafts[item.id]?.url.trim()}
                          className="rounded-md border border-[var(--border)] px-2 py-1.5 text-xs disabled:opacity-50">
                          加連結
                        </button>
                        <label className="inline-flex cursor-pointer items-center rounded-md border border-[var(--border)] px-2 py-1.5 text-xs">
                          <Upload size={13} aria-hidden="true" />
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => uploadAgendaFiles(item.id, e.target.files)}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
                {isDraft && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => moveAgendaItem(index, -1)}
                      disabled={index === 0}
                      aria-label="上移"
                      className="rounded border border-[var(--border)] p-1 disabled:opacity-30">
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => moveAgendaItem(index, 1)}
                      disabled={index === agenda.length - 1}
                      aria-label="下移"
                      className="rounded border border-[var(--border)] p-1 disabled:opacity-30">
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => removeAgendaItem(item.id)}
                      aria-label="刪除"
                      className="rounded border border-[var(--border)] p-1 text-red-500">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {agenda.length === 0 && (
            <p className="text-sm text-[var(--muted)]">尚未建立議程項目。</p>
          )}
        </div>

        {isDraft && (
          <div className="mt-4 grid gap-3 rounded-md border border-dashed border-[var(--border)] p-3">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="新增一般議案標題（如：報告事項、臨時動議、法規草案）"
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            />
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="議案說明、草案摘要、條文重點或提案理由"
              rows={3}
              className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            />
            <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
              <input
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                placeholder="附件連結：法規草案網頁、雲端對照表等"
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
              />
              <input
                value={newLinkLabel}
                onChange={(e) => setNewLinkLabel(e.target.value)}
                placeholder="連結名稱"
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <Upload size={15} aria-hidden="true" />
                上傳附件
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => setNewFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              <span className="text-xs text-[var(--muted)]">
                {newFiles.length
                  ? newFiles.map((file) => file.name).join("、")
                  : "可加入法規對照表、PDF、試算表或其他會議資料"}
              </span>
              <button
                onClick={addManualItem}
                disabled={!newTitle.trim()}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50">
                <Plus size={16} aria-hidden="true" />
                加入議程
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── 確認草稿 ───────────────────────────────────────── */}
      <section className="rounded-lg border border-[var(--border)] p-4">
        <h2 className="mb-1 text-lg font-semibold">確認議程草稿</h2>
        {isConfirmed ? (
          <div className="text-sm">
            <p className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 size={16} aria-hidden="true" />
              議程已於 {new Date(meeting.confirmed_at as string).toLocaleString()} 確認。
            </p>
            {meeting.notice_document_id && (
              <Link
                href={`/documents/${meeting.notice_document_id}`}
                className="mt-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2">
                <FileText size={15} aria-hidden="true" />
                開啟開會通知單草稿
              </Link>
            )}
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-[var(--muted)]">
              確認後系統會以基本設定與議程自動建立一份「開會通知單」公文草稿。
              {!canConfirm && " 需先設定開會時間、開會地點，並至少一個議程項目。"}
            </p>
            <div className="mb-4 grid gap-3 rounded-md border border-[var(--border)] p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">通知單字號模板</span>
                <select
                  value={noticeSerialTemplateId}
                  disabled={Boolean(noticeSerialNumber.trim())}
                  onChange={(e) => setNoticeSerialTemplateId(e.target.value)}
                  className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 disabled:opacity-50">
                  <option value="">使用系統預設字號</option>
                  {serialTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.org_prefix}
                      {template.category_char}字 · {template.preview}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">手動公文字號</span>
                <input
                  value={noticeSerialNumber}
                  onChange={(e) => setNoticeSerialNumber(e.target.value)}
                  placeholder="例：嶺代生字第1150000001號"
                  maxLength={30}
                  className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                />
                <span className="text-xs text-[var(--muted)]">
                  有填手動字號時會優先使用，系統會檢查是否重複。
                </span>
              </label>
            </div>
            <button
              onClick={confirmMeeting}
              disabled={!canConfirm || confirming}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50">
              <CheckCircle2 size={16} aria-hidden="true" />
              {confirming ? "處理中..." : "確認議程並產生開會通知單"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
