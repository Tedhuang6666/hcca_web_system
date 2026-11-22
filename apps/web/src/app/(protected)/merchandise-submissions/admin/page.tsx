"use client";

import NumberInput from "@/components/ui/NumberInput";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  LoaderCircle,
  Plus,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage, merchandiseSubmissionsApi, orgsApi } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import {
  ItemEditor,
  ReviewRow,
  emptyItem,
  emptyField,
  FieldCaption,
  NotificationRecipientPicker,
  reviewStatusLabels,
  type AdminTab,
  type ItemDraft,
  type VotingSubmission,
} from "@/components/merchandise-submissions/SubmissionAdminParts";
import type {
  MerchandiseSubmissionAdminListItem,
  MerchandiseSubmissionItemAdminOut,
  MerchandiseSubmissionSettingsAdminOut,
  OrgRead,
  SurveyOut,
  SubmissionCustomField,
} from "@/lib/types";
import { mergeFields, toIso, toLocal } from "@/lib/merchandise-submission-editor";

export default function MerchandiseSubmissionsAdminPage() {
  const { can, isReady: permissionsReady } = usePermissions();
  const canManageSubmissions =
    can("merchandise_submission:manage") || can("shop:manage");
  const canReviewSubmissions =
    can("merchandise_submission:review") || canManageSubmissions;
  const canViewSubmissions =
    can("merchandise_submission:view") || canReviewSubmissions;
  const canAccessAdmin = canViewSubmissions;
  const [settings, setSettings] =
    useState<MerchandiseSubmissionSettingsAdminOut | null>(null);
  const [items, setItems] = useState<MerchandiseSubmissionItemAdminOut[]>([]);
  const [submissions, setSubmissions] = useState<
    VotingSubmission[]
  >([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [votingOrgId, setVotingOrgId] = useState("");
  const [preparedSurvey, setPreparedSurvey] = useState<SurveyOut | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(emptyItem());
  const [tab, setTab] = useState<AdminTab>("review");
  const [reviewItemId, setReviewItemId] = useState("");
  const [reviewUserQuery, setReviewUserQuery] = useState("");
  const [reviewStatus, setReviewStatus] = useState<
    VotingSubmission["status"] | ""
  >("");
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const load = useCallback(async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
    if (!permissionsReady) return;
    if (!canAccessAdmin) {
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      const [nextSettings, nextItems, nextSubmissions, nextOrgs] = await Promise.all([
        canManageSubmissions ? merchandiseSubmissionsApi.getSettings() : Promise.resolve(null),
        canManageSubmissions ? merchandiseSubmissionsApi.listItems() : Promise.resolve([]),
        merchandiseSubmissionsApi.listSubmissions(),
        canReviewSubmissions
          ? orgsApi.list({ active_only: true, exclude_class_orgs: true })
          : Promise.resolve([]),
      ]);
      setSettings(nextSettings);
      setItems(nextItems);
      setSubmissions(nextSubmissions);
      setOrgs(nextOrgs);
      setVotingOrgId((current) => current || nextOrgs[0]?.id || "");
    } catch (error) {
      toast.error(apiErrorMessage(error, "無法載入投稿管理設定"));
    } finally {
      setLoading(false);
    }
  }, [canAccessAdmin, canManageSubmissions, canReviewSubmissions, permissionsReady]);
  useEffect(() => {
    void load();
  }, [load]);
  const updateSubmission = useCallback((updated: MerchandiseSubmissionAdminListItem) => {
    setSubmissions((current) =>
      current.map((submission) => (submission.id === updated.id ? updated : submission)),
    );
  }, []);
  const current = useMemo(
    () => items.find((item) => item.id === draft.id),
    [draft.id, items],
  );
  const filteredSubmissions = useMemo(() => {
    const query = reviewUserQuery.trim().toLocaleLowerCase("zh-TW");
    return submissions.filter((submission) => {
      if (reviewItemId && submission.item_id !== reviewItemId) return false;
      if (reviewStatus && submission.status !== reviewStatus) return false;
      if (!query) return true;
      return [
        submission.submitter_name,
        submission.submitter_email,
        submission.submitter_student_id ?? "",
      ].some((value) => value.toLocaleLowerCase("zh-TW").includes(query));
    });
  }, [reviewItemId, reviewStatus, reviewUserQuery, submissions]);
  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const updated = await merchandiseSubmissionsApi.updateSettings({
        is_open: settings.is_open,
        opens_at: toIso(toLocal(settings.opens_at)),
        closes_at: toIso(toLocal(settings.closes_at)),
        max_file_size_mb: settings.max_file_size_mb,
        require_school_email: settings.require_school_email,
        announcement: settings.announcement || null,
        announcement_title: settings.announcement_title || null,
        submission_intro: settings.submission_intro || null,
        global_fields: settings.global_fields,
        show_announcement_popup: settings.show_announcement_popup,
        notification_enabled: settings.notification_enabled,
        notification_recipient_ids: settings.notification_recipient_ids,
      });
      setSettings(updated);
      toast.success("全站設定已儲存，公告已同步到公告模組");
    } catch (error) {
      toast.error(apiErrorMessage(error, "無法儲存全站設定"));
    } finally {
      setSavingSettings(false);
    }
  };
  const prepareVotingSurvey = async () => {
    if (!votingOrgId) {
      toast.error("請先選擇票選問卷所屬組織");
      return;
    }
    try {
      const survey = await merchandiseSubmissionsApi.prepareVotingSurvey({
        org_id: votingOrgId,
        title: "校商投稿全校票選",
        description: "請依序查看每個品項的投稿圖案，選出您喜歡的一個或多個圖案。",
      });
      setPreparedSurvey(survey);
      await load();
      toast.success("已建立票選問卷草稿，請確認題目後再發布");
    } catch (error) {
      toast.error(apiErrorMessage(error, "無法建立票選問卷草稿"));
    }
  };
  if (!permissionsReady || loading || (canManageSubmissions && !settings))
    return (
      <div className="p-6">
        <div
          className="h-36 animate-pulse rounded-xl"
          style={{ background: "var(--bg-elevated)" }}
        />
      </div>
    );
  if (!canAccessAdmin)
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold">無法存取投稿管理</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          需要校商投稿查看、管理或審核權限。
        </p>
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <header
        className="flex flex-wrap items-end justify-between gap-4 border-b pb-6"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--primary-text)" }}
          >
            商品系統整合
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            校商投稿管理
          </h1>
          <p
            className="mt-2 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            設定投稿排程、品項圖稿規格與學生投稿審核。
          </p>
        </div>
        <Link
          href="/merchandise-submissions"
          className="btn btn-ghost min-h-11"
        >
          查看學生投稿頁
          <ChevronRight size={16} />
        </Link>
      </header>
      <nav
        className="flex overflow-x-auto border-b"
        style={{ borderColor: "var(--border)" }}
        aria-label="校商投稿管理頁籤"
      >
        {[
          ["review", "投稿審核"],
          ...(canManageSubmissions
            ? [["settings", "全站投稿與公告設定"], ["items", "投稿品項"]]
            : []),
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setTab(value as AdminTab)}
            className="min-h-11 shrink-0 border-b-2 px-4 text-sm font-semibold"
            style={{
              borderColor: tab === value ? "var(--primary)" : "transparent",
              color:
                tab === value ? "var(--primary-text)" : "var(--text-secondary)",
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {canManageSubmissions && tab === "settings" && settings && (
        <section
          className="rounded-xl border p-5 sm:p-6"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border)",
          }}
        >
          <div>
            <h2 className="font-semibold">全站投稿與公告設定</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              設定時間後會在開始時間自動開放；品項可再個別覆寫。
            </p>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={settings.is_open}
                onChange={(event) =>
                  setSettings({ ...settings, is_open: event.target.checked })
                }
              />
              立即開放投稿
            </label>
            <label>
              <FieldCaption>開始時間</FieldCaption>
              <input
                type="datetime-local"
                value={toLocal(settings.opens_at)}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    opens_at: toIso(event.target.value),
                  })
                }
                className="input w-full"
              />
            </label>
            <label>
              <FieldCaption>截止時間</FieldCaption>
              <input
                type="datetime-local"
                value={toLocal(settings.closes_at)}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    closes_at: toIso(event.target.value),
                  })
                }
                className="input w-full"
              />
            </label>
            <label>
              <FieldCaption>單檔上限（MB）</FieldCaption>
              <NumberInput
                type="number"
                min="1"
                max="250"
                value={settings.max_file_size_mb}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    max_file_size_mb: Number(event.target.value) || 1,
                  })
                }
                className="input w-full"
              />
            </label>
            <label className="flex min-h-11 items-end gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.require_school_email}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    require_school_email: event.target.checked,
                  })
                }
              />
              僅限校務信箱投稿
            </label>
            <div />
            <label>
              <FieldCaption>公告標題</FieldCaption>
              <input
                value={settings.announcement_title ?? ""}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    announcement_title: event.target.value || null,
                  })
                }
                className="input w-full"
                placeholder="例如：校商投稿已開放"
              />
            </label>
            <label className="flex min-h-11 items-end gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={settings.show_announcement_popup}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    show_announcement_popup: event.target.checked,
                  })
                }
              />
              每次進入系統時彈出公告，點擊可前往校商投稿
            </label>
            <label className="sm:col-span-3">
              <FieldCaption>公告訊息（Markdown）</FieldCaption>
              <textarea
                value={settings.announcement ?? ""}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    announcement: event.target.value || null,
                  })
                }
                className="input min-h-24 w-full py-2"
                placeholder="儲存後會自動發布到公告模組，支援 Markdown。"
              />
            </label>
            <label className="sm:col-span-3">
              <FieldCaption>投稿前言與說明（Markdown）</FieldCaption>
              <textarea
                value={settings.submission_intro ?? ""}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    submission_intro: event.target.value || null,
                  })
                }
                className="input min-h-40 w-full py-2"
                placeholder="例如：請說明設計理念、用色元素、尺寸限制與交稿注意事項。支援 Markdown。"
              />
              <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>
                儲存後會顯示在所有投稿品項上方。
              </span>
            </label>
            <div className="rounded-lg border p-4 sm:col-span-3" style={{ borderColor: "var(--border)" }}>
              <h3 className="font-semibold">投稿通知</h3>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                收到新投稿時通知負責人。品項可在「投稿品項」中個別覆寫這項設定。
              </p>
              <label className="mt-3 flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.notification_enabled}
                  onChange={(event) =>
                    setSettings({ ...settings, notification_enabled: event.target.checked })
                  }
                />
                啟用全域投稿通知
              </label>
              <div className="mt-3">
                <FieldCaption>指定通知收件人（留空則依權限自動通知）</FieldCaption>
                <NotificationRecipientPicker
                  value={settings.notification_recipient_ids}
                  onChange={(ids) =>
                    setSettings({ ...settings, notification_recipient_ids: ids })
                  }
                />
              </div>
            </div>
          </div>
          <div
            className="mt-6 border-t pt-5"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">全域投稿欄位</h3>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  例如姓名、座號；所有品項都會顯示。若單一品項需要調整，再到品項設定覆寫。
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost min-h-10"
                onClick={() =>
                  setSettings({
                    ...settings,
                    global_fields: [
                      ...settings.global_fields,
                      emptyField(settings.global_fields.length),
                    ],
                  })
                }
              >
                <Plus size={15} />
                新增全域欄位
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {settings.global_fields.map((field, index) => (
                <article
                  key={`${field.key}-${index}`}
                  className="rounded-lg border p-4"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_9rem_auto]">
                    <label>
                      <FieldCaption>欄位名稱</FieldCaption>
                      <input
                        value={field.label}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            global_fields: settings.global_fields.map((entry, i) =>
                              i === index ? { ...entry, label: event.target.value } : entry,
                            ),
                          })
                        }
                        className="input h-10 w-full"
                        placeholder="例如：姓名"
                      />
                    </label>
                    <label>
                      <FieldCaption>輸入方式</FieldCaption>
                      <select
                        value={field.field_type}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            global_fields: settings.global_fields.map((entry, i) =>
                              i === index
                                ? {
                                    ...entry,
                                    field_type: event.target.value as SubmissionCustomField["field_type"],
                                  }
                                : entry,
                            ),
                          })
                        }
                        className="input h-10 w-full"
                      >
                        <option value="text">單行文字</option>
                        <option value="textarea">多行文字</option>
                      </select>
                    </label>
                    <label>
                      <FieldCaption>最多字數</FieldCaption>
                      <NumberInput
                        type="number"
                        min="1"
                        max="2000"
                        value={field.max_length}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            global_fields: settings.global_fields.map((entry, i) =>
                              i === index
                                ? { ...entry, max_length: Number(event.target.value) || 200 }
                                : entry,
                            ),
                          })
                        }
                        className="input h-10 w-full"
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <label className="flex h-10 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              global_fields: settings.global_fields.map((entry, i) =>
                                i === index
                                  ? { ...entry, required: event.target.checked }
                                  : entry,
                              ),
                            })
                          }
                        />
                        必填
                      </label>
                      <button
                        type="button"
                        aria-label={`移除 ${field.label}`}
                        onClick={() =>
                          setSettings({
                            ...settings,
                            global_fields: settings.global_fields.filter((_, i) => i !== index),
                          })
                        }
                        className="topbar-icon-btn h-10 w-10"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label>
                      <FieldCaption>輸入框提示</FieldCaption>
                      <input
                        value={field.placeholder ?? ""}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            global_fields: settings.global_fields.map((entry, i) =>
                              i === index
                                ? { ...entry, placeholder: event.target.value || null }
                                : entry,
                            ),
                          })
                        }
                        className="input h-10 w-full"
                      />
                    </label>
                    <label>
                      <FieldCaption>填寫說明</FieldCaption>
                      <input
                        value={field.help_text ?? ""}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            global_fields: settings.global_fields.map((entry, i) =>
                              i === index
                                ? { ...entry, help_text: event.target.value || null }
                                : entry,
                            ),
                          })
                        }
                        className="input h-10 w-full"
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={savingSettings}
              onClick={() => void saveSettings()}
              className="btn min-h-11"
              style={{
                background: "var(--primary)",
                color: "var(--primary-fg)",
                border: "none",
              }}
            >
              {savingSettings ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              儲存全站設定
            </button>
          </div>
        </section>
      )}
      {canManageSubmissions && tab === "items" && (
        <div className="grid items-start gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
          <aside
            className="rounded-xl border p-3"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border)",
            }}
          >
            <div className="flex items-center justify-between gap-2 px-2 pb-3">
              <h2 className="font-semibold">投稿品項</h2>
              <button
                type="button"
                onClick={() => setDraft(emptyItem())}
                className="topbar-icon-btn h-10 w-10"
                aria-label="新增品項"
              >
                <Plus size={17} />
              </button>
            </div>
            <div className="space-y-1">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setDraft({ ...item })}
                  className="w-full rounded-lg px-3 py-3 text-left text-sm"
                  style={{
                    background:
                      current?.id === item.id
                        ? "var(--primary-dim)"
                        : "transparent",
                    color: "var(--text-primary)",
                  }}
                >
                  <span className="block font-medium">{item.name}</span>
                  <span
                    className="mt-1 block text-xs"
                    style={{
                      color: item.is_active
                        ? "var(--success)"
                        : "var(--text-muted)",
                    }}
                  >
                    {item.is_active ? "啟用中" : "已停用"}
                  </span>
                </button>
              ))}
              {items.length === 0 && (
                <p
                  className="px-2 py-6 text-sm"
                  style={{ color: "var(--text-muted)" }}
                >
                  尚無投稿品項。
                </p>
              )}
            </div>
          </aside>
          <ItemEditor
            draft={draft}
            onChange={setDraft}
            onSaved={() => {
              setDraft(emptyItem());
              void load({ showLoading: false });
            }}
          />
        </div>
      )}
      {tab === "review" && (
        <section
          className="rounded-xl border p-5 sm:p-6"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border)",
          }}
        >
          <div>
            <h2 className="font-semibold">投稿審核</h2>
          </div>
          {canReviewSubmissions && (
            <div
              className="mt-5 rounded-lg border p-4"
              style={{ background: "var(--primary-dim)", borderColor: "var(--border)" }}
            >
              <p className="font-semibold">建立全校票選問卷</p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                將審核完成的品項建立為票選問卷，每品項一題。發布前請核對題目與圖稿。
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="min-w-60 flex-1">
                  <FieldCaption>問卷所屬組織</FieldCaption>
                  <select
                    value={votingOrgId}
                    onChange={(event) => setVotingOrgId(event.target.value)}
                    className="input w-full"
                  >
                    <option value="">選擇組織…</option>
                    {orgs.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void prepareVotingSurvey()}
                  className="btn min-h-11"
                  style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}
                >
                  建立問卷草稿
                </button>
                {preparedSurvey && (
                  <Link href={`/surveys/${preparedSurvey.id}`} className="btn btn-ghost min-h-11">
                    檢視／確認問卷
                  </Link>
                )}
              </div>
            </div>
          )}
          <div
            className="mt-5 grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(15rem,1.4fr)_minmax(10rem,0.8fr)_auto]"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border)",
            }}
          >
            <label>
              <FieldCaption>投稿品項</FieldCaption>
              <select
                value={reviewItemId}
                onChange={(event) => setReviewItemId(event.target.value)}
                className="input w-full"
              >
                <option value="">全部品項</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <FieldCaption>投稿者</FieldCaption>
              <input
                value={reviewUserQuery}
                onChange={(event) => setReviewUserQuery(event.target.value)}
                className="input w-full"
                placeholder="搜尋姓名、校務信箱或學號"
              />
            </label>
            <label>
              <FieldCaption>目前狀態</FieldCaption>
              <select
                value={reviewStatus}
                onChange={(event) =>
                  setReviewStatus(
                    event.target.value as
                      VotingSubmission["status"] | "",
                  )
                }
                className="input w-full"
              >
                <option value="">全部狀態</option>
                {(
                  Object.entries(reviewStatusLabels) as Array<
                    [VotingSubmission["status"], string]
                  >
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                className="btn btn-ghost min-h-11 w-full"
                disabled={!reviewItemId && !reviewUserQuery && !reviewStatus}
                onClick={() => {
                  setReviewItemId("");
                  setReviewUserQuery("");
                  setReviewStatus("");
                }}
              >
                清除篩選
              </button>
            </div>
          </div>
          <p
            className="mt-4 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            顯示 {filteredSubmissions.length} / {submissions.length} 筆投稿
          </p>
          <div className="mt-2">
            {filteredSubmissions.length ? (
              filteredSubmissions.map((submission) => (
                <ReviewRow
                  key={submission.id}
                  submission={submission}
                  canReview={canReviewSubmissions}
                  fields={mergeFields(
                    settings?.global_fields ?? [],
                    items.find((item) => item.id === submission.item_id)?.custom_fields ?? [],
                  )}
                  onReviewed={updateSubmission}
                />
              ))
            ) : (
              <p
                className="py-8 text-center text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                {submissions.length
                  ? "沒有符合目前篩選條件的投稿。"
                  : "目前尚未收到投稿。"}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
