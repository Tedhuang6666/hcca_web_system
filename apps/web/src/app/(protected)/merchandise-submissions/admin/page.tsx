"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  FileImage,
  LoaderCircle,
  Plus,
  Save,
  ScanSearch,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import { apiErrorMessage, merchandiseSubmissionsApi, orgsApi, usersApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import { usePermissions } from "@/hooks/usePermissions";
import UserPicker from "@/components/surveys/UserPicker";
import type {
  MerchandiseSubmissionAdminListItem,
  MerchandiseSubmissionItemCreate,
  MerchandiseSubmissionItemAdminOut,
  MerchandiseSubmissionSettingsAdminOut,
  OrgRead,
  SurveyOut,
  SubmissionCustomField,
  UserSummary,
} from "@/lib/types";

type ItemDraft = Omit<MerchandiseSubmissionItemCreate, "template_images" | "custom_fields"> & {
  id?: string;
  template_images: NonNullable<MerchandiseSubmissionItemCreate["template_images"]>;
  custom_fields: NonNullable<MerchandiseSubmissionItemCreate["custom_fields"]>;
};
type VotingSubmission = MerchandiseSubmissionAdminListItem & {
  status: MerchandiseSubmissionAdminListItem["status"] | "review_completed";
  voting_survey_id?: string | null;
  voting_survey_title?: string | null;
  voting_survey_status?: string | null;
};
type AdminTab = "review" | "settings" | "items";

const reviewStatusLabels: Record<string, string> = {
  draft: "草稿",
  submitted: "已送出",
  reviewing: "審核中",
  review_completed: "審核完成",
  approved: "已採用",
  revision_requested: "需要補件",
  rejected: "未採用",
};

function isPreviewableImage(file: { content_type: string; filename: string }) {
  return (
    file.content_type.startsWith("image/") ||
    /\.(jpe?g|png|webp)$/i.test(file.filename)
  );
}

type AIDetectionStatus = NonNullable<
  MerchandiseSubmissionAdminListItem["files"][number]["ai_detection_status"]
> | "unscanned";

type AIDetectionTone = "warning" | "info" | "neutral" | "danger";

const AI_STATUS_CONFIG: Record<
  AIDetectionStatus,
  { label: string; description: string; tone: AIDetectionTone }
> = {
  detected: {
    label: "偵測到 AI",
    description: "檔案中有可供判斷的 AI 相關 metadata，請搭配其他審核資訊判讀。",
    tone: "warning",
  },
  supporting: {
    label: "偵測到 AI 製作來源",
    description: "檔案中有可能與來源或製作流程相關的 metadata，並非直接判定檔案為 AI 生成。",
    tone: "info",
  },
  no_evidence: {
    label: "未偵測到 AI",
    description: "目前沒有找到可判斷的 AI 相關 metadata；這不代表檔案一定不是 AI 生成。",
    tone: "neutral",
  },
  not_applicable: {
    label: "未偵測",
    description: "目前檔案格式不支援 AI metadata 分析。",
    tone: "neutral",
  },
  error: {
    label: "偵測失敗",
    description: "分析原始檔時發生問題，請重新上傳檔案或稍後再試。",
    tone: "danger",
  },
  unscanned: {
    label: "尚未偵測",
    description: "此檔案尚未完成 AI metadata 偵測。",
    tone: "neutral",
  },
};

const AI_TONE_STYLES: Record<
  AIDetectionTone,
  { borderColor: string; background: string; color: string }
> = {
  warning: {
    borderColor: "var(--warning-border)",
    background: "var(--warning-dim)",
    color: "var(--warning)",
  },
  info: {
    borderColor: "var(--info-border)",
    background: "var(--info-dim)",
    color: "var(--info)",
  },
  neutral: {
    borderColor: "var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
  },
  danger: {
    borderColor: "var(--danger-border)",
    background: "var(--danger-dim)",
    color: "var(--danger)",
  },
};

function formatScanTime(value: string | null) {
  if (!value) return "尚未掃描";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" });
}

function AIEvidencePanel({
  file,
}: {
  file: MerchandiseSubmissionAdminListItem["files"][number];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const evidence = file.ai_detection_evidence ?? [];
  const metadata = file.ai_detection_metadata ?? [];
  const statusKey: AIDetectionStatus = file.ai_detection_status ?? "unscanned";
  const status = AI_STATUS_CONFIG[statusKey];
  const toneStyles = AI_TONE_STYLES[status.tone];
  const isFinding = statusKey === "detected";

  return (
    <>
      <div
        className="mt-2 rounded-lg border p-2.5"
        style={{ borderColor: toneStyles.borderColor, background: toneStyles.background }}
      >
        <div className="flex items-start gap-2">
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--bg-surface)", color: toneStyles.color }}
            aria-hidden="true"
          >
            {isFinding ? <ShieldAlert size={14} /> : <ScanSearch size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold" style={{ color: toneStyles.color }}>
              AI metadata
            </p>
            <p className="mt-0.5 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
              {status.label}
            </p>
            <p className="mt-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {evidence.length > 0 ? `${evidence.length} 項判斷線索` : "尚無判斷線索"}
              {metadata.length > 0 && ` · ${metadata.length} 筆 metadata`}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost min-h-11 shrink-0 px-3 text-[11px] sm:min-h-8 sm:px-2"
            onClick={() => setIsOpen(true)}
            aria-haspopup="dialog"
          >
            查看詳情
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {isOpen && (
        <Modal title="AI metadata 詳情" onClose={() => setIsOpen(false)} size="2xl">
          <div className="space-y-5">
            <div
              className="flex items-start gap-3 rounded-lg border p-3"
              style={{ borderColor: toneStyles.borderColor, background: toneStyles.background }}
            >
              <span
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--bg-surface)", color: toneStyles.color }}
                aria-hidden="true"
              >
                {isFinding ? <ShieldAlert size={17} /> : <ScanSearch size={17} />}
              </span>
              <div>
                <p className="text-sm font-semibold" style={{ color: toneStyles.color }}>
                  {status.label}
                </p>
                <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
                  {status.description}
                </p>
              </div>
            </div>

            <section aria-labelledby="ai-file-summary-title">
              <h3 id="ai-file-summary-title" className="text-sm font-semibold">
                檔案摘要
              </h3>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded border p-2.5" style={{ borderColor: "var(--border)" }}>
                  <dt className="text-[11px]" style={{ color: "var(--text-muted)" }}>檔名</dt>
                  <dd className="mt-1 break-all text-xs font-medium">{file.filename}</dd>
                </div>
                <div className="rounded border p-2.5" style={{ borderColor: "var(--border)" }}>
                  <dt className="text-[11px]" style={{ color: "var(--text-muted)" }}>檔案格式／大小</dt>
                  <dd className="mt-1 text-xs font-medium">
                    {file.content_type} · {file.file_size.toLocaleString()} bytes
                  </dd>
                </div>
                <div className="rounded border p-2.5" style={{ borderColor: "var(--border)" }}>
                  <dt className="text-[11px]" style={{ color: "var(--text-muted)" }}>掃描時間</dt>
                  <dd className="mt-1 text-xs font-medium">{formatScanTime(file.ai_detection_scanned_at)}</dd>
                </div>
                <div className="rounded border p-2.5" style={{ borderColor: "var(--border)" }}>
                  <dt className="text-[11px]" style={{ color: "var(--text-muted)" }}>偵測版本</dt>
                  <dd className="mt-1 text-xs font-medium">{file.ai_detection_version ?? "尚未記錄"}</dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby="ai-evidence-title">
              <div className="flex items-center justify-between gap-3">
                <h3 id="ai-evidence-title" className="text-sm font-semibold">判斷線索</h3>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{evidence.length} 項</span>
              </div>
              {evidence.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {evidence.map((item, index) => (
                    <li
                      key={`${item.category}-${index}`}
                      className="rounded-lg border p-3"
                      style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ color: toneStyles.color, background: toneStyles.background }}
                        >
                          {item.level} 級
                        </span>
                        <span className="text-xs font-semibold">{item.category}</span>
                      </div>
                      <p className="mt-2 text-xs font-medium">{item.label}</p>
                      <p className="mt-1 break-words text-xs" style={{ color: "var(--text-secondary)" }}>
                        偵測值：{item.value}
                      </p>
                      <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        來源：{item.source}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div
                  className="mt-2 rounded-lg border p-3 text-xs"
                  style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
                >
                  <p className="font-medium">未偵測到可供判斷的 AI metadata</p>
                  <p className="mt-1 leading-5" style={{ color: "var(--text-secondary)" }}>
                    這只代表目前沒有解析到相關線索，不代表檔案一定不是 AI 生成。
                  </p>
                </div>
              )}
            </section>

            <section aria-labelledby="ai-metadata-title">
              <div className="flex items-center justify-between gap-3">
                <h3 id="ai-metadata-title" className="text-sm font-semibold">完整 metadata</h3>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{metadata.length} 筆</span>
              </div>
              {metadata.length > 0 ? (
                <div
                  className="mt-2 max-h-72 overflow-auto rounded-lg border"
                  style={{ borderColor: "var(--border)" }}
                >
                  <dl className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {metadata.map((item, index) => (
                      <div key={item.source + item.key + index} className="grid gap-1 p-3 sm:grid-cols-[10rem_1fr] sm:gap-3">
                        <dt className="break-words text-xs font-semibold">{item.key}</dt>
                        <dd className="break-words whitespace-pre-wrap text-xs" style={{ color: "var(--text-secondary)" }}>
                          <span className="mr-1 text-[10px]" style={{ color: "var(--text-muted)" }}>[{item.source}]</span>
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <p
                  className="mt-2 rounded-lg border p-3 text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  沒有可解析的 metadata。
                </p>
              )}
            </section>

            {file.ai_detection_sha256 && (
              <section aria-labelledby="ai-integrity-title">
                <h3 id="ai-integrity-title" className="text-sm font-semibold">檔案完整性</h3>
                <p
                  className="mt-2 break-all rounded-lg border p-3 font-mono text-[11px]"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  SHA-256：{file.ai_detection_sha256}
                </p>
              </section>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function emptyItem(): ItemDraft {
  return {
    name: "",
    description: "",
    specification: "",
    template_images: [],
    custom_fields: [],
    sort_order: 0,
    is_active: true,
    is_open_override: null,
    opens_at_override: null,
    closes_at_override: null,
    max_file_size_mb_override: null,
    notification_enabled: null,
    notification_recipient_ids: null,
  };
}

function emptyField(index: number): SubmissionCustomField {
  return {
    key: `field_${Date.now()}_${index}`,
    label: "新欄位",
    field_type: "text",
    required: false,
    placeholder: null,
    help_text: null,
    max_length: 200,
  };
}

function mergeFields(
  globalFields: SubmissionCustomField[],
  itemFields: SubmissionCustomField[],
): SubmissionCustomField[] {
  const fields = new Map(globalFields.map((field) => [field.key, field]));
  for (const field of itemFields) fields.set(field.key, field);
  return [...fields.values()];
}

function toLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function FieldCaption({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mb-1.5 block text-xs font-medium"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </span>
  );
}

function NotificationRecipientPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const idsKey = value.join(",");
  const selectedIds = useMemo(() => (idsKey ? idsKey.split(",") : []), [idsKey]);

  useEffect(() => {
    void usersApi.listByIds(selectedIds).then(setUsers).catch(() => undefined);
  }, [idsKey, selectedIds]);

  return (
    <UserPicker
      value={users}
      onChange={(nextUsers) => {
        setUsers(nextUsers);
        onChange(nextUsers.map((user) => user.id));
      }}
    />
  );
}

function ItemEditor({
  draft,
  onChange,
  onSaved,
}: {
  draft: ItemDraft;
  onChange: (next: ItemDraft) => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const addField = () =>
    update("custom_fields", [
      ...draft.custom_fields,
      emptyField(draft.custom_fields.length),
    ]);
  const setField = (index: number, next: SubmissionCustomField) =>
    update(
      "custom_fields",
      draft.custom_fields.map((field, i) => (i === index ? next : field)),
    );
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const save = async () => {
    if (!draft.name.trim()) {
      toast.error("請輸入品項名稱");
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
        specification: draft.specification?.trim() || null,
        opens_at_override: toIso(toLocal(draft.opens_at_override)),
        closes_at_override: toIso(toLocal(draft.closes_at_override)),
        max_file_size_mb_override: draft.max_file_size_mb_override || null,
      };
      if (draft.id) await merchandiseSubmissionsApi.updateItem(draft.id, body);
      else await merchandiseSubmissionsApi.createItem(body);
      toast.success("品項設定已儲存");
      onSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error, "無法儲存品項設定"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="rounded-xl border p-5 sm:p-6"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">
            {draft.id ? "編輯投稿品項" : "新增投稿品項"}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            設定學生會看到的規格、範本與填寫內容。
          </p>
        </div>
        {draft.id && (
          <button
            type="button"
            onClick={() => onChange(emptyItem())}
            className="btn btn-ghost min-h-10"
          >
            新增品項
          </button>
        )}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label>
          <FieldCaption>品項名稱 *</FieldCaption>
          <input
            value={draft.name}
            onChange={(event) => update("name", event.target.value)}
            className="input w-full"
            placeholder="例如：運動衫"
          />
        </label>
        <label>
          <FieldCaption>顯示排序</FieldCaption>
          <input
            type="number"
            value={draft.sort_order ?? 0}
            onChange={(event) =>
              update("sort_order", Number(event.target.value))
            }
            className="input w-full"
          />
        </label>
        <label className="sm:col-span-2">
          <FieldCaption>投稿說明（Markdown）</FieldCaption>
          <textarea
            value={draft.description ?? ""}
            onChange={(event) => update("description", event.target.value)}
            className="input min-h-20 w-full py-2"
            placeholder="學生選擇品項後會先看到這段說明，支援 Markdown"
          />
        </label>
        <label className="sm:col-span-2">
          <FieldCaption>詳細規格（Markdown）</FieldCaption>
          <textarea
            value={draft.specification ?? ""}
            onChange={(event) => update("specification", event.target.value)}
            className="input min-h-36 w-full py-2"
            placeholder="尺寸、出血、解析度、設計限制等；支援 Markdown"
          />
        </label>
      </div>

      <div
        className="mt-6 border-t pt-5"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">設計範本圖片</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              可一次上傳多張；會放大顯示在學生投稿頁並可下載原圖。
            </p>
          </div>
          <div className="w-full max-w-sm">
            <AnimatedFileUpload
              multiple
              accept="image/jpeg,image/png,image/webp"
              label="拖曳範本圖片到這裡"
              hint="可一次上傳多張"
              onUpload={(file, reportProgress) => merchandiseSubmissionsApi.uploadTemplateImage(file, reportProgress)}
              onUploaded={(uploaded) => {
                const next = {
                  ...draftRef.current,
                  template_images: [...draftRef.current.template_images, { url: uploaded.url, label: uploaded.filename }],
                };
                draftRef.current = next;
                onChange(next);
                toast.success("範本圖片已上傳");
              }}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {draft.template_images.map((template, index) => (
            <div
              key={`${template.url}-${index}`}
              className="flex gap-3 rounded-lg border p-2"
              style={{ borderColor: "var(--border)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={uploadUrl(template.url)}
                alt={`${template.label} 預覽`}
                className="h-20 w-20 rounded object-contain"
                style={{ background: "var(--bg-elevated)" }}
              />
              <div className="min-w-0 flex-1">
                <FieldCaption>範本名稱</FieldCaption>
                <input
                  value={template.label}
                  onChange={(event) =>
                    update(
                      "template_images",
                      draft.template_images.map((entry, i) =>
                        i === index
                          ? { ...entry, label: event.target.value }
                          : entry,
                      ),
                    )
                  }
                  className="input h-9 w-full text-xs"
                />
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "template_images",
                      draft.template_images.filter((_, i) => i !== index),
                    )
                  }
                  className="mt-2 text-xs"
                  style={{ color: "var(--danger)" }}
                >
                  移除圖片
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="mt-6 border-t pt-5"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">品項欄位覆寫</h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              留空則沿用全域欄位；這裡新增的欄位只套用此品項。
            </p>
          </div>
          <button
            type="button"
            onClick={addField}
            className="btn btn-ghost min-h-10"
          >
            <Plus size={15} />
            新增欄位
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {draft.custom_fields.map((field, index) => (
            <article
              key={field.key}
              className="rounded-lg border p-4"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_9rem_auto]">
                <label>
                  <FieldCaption>欄位名稱（學生會看到）</FieldCaption>
                  <input
                    value={field.label}
                    onChange={(event) =>
                      setField(index, { ...field, label: event.target.value })
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
                      setField(index, {
                        ...field,
                        field_type: event.target
                          .value as SubmissionCustomField["field_type"],
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
                  <input
                    type="number"
                    min="1"
                    max="2000"
                    value={field.max_length}
                    onChange={(event) =>
                      setField(index, {
                        ...field,
                        max_length: Number(event.target.value) || 200,
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
                        setField(index, {
                          ...field,
                          required: event.target.checked,
                        })
                      }
                    />
                    必填
                  </label>
                  <button
                    type="button"
                    aria-label={`移除 ${field.label}`}
                    onClick={() =>
                      update(
                        "custom_fields",
                        draft.custom_fields.filter((_, i) => i !== index),
                      )
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
                      setField(index, {
                        ...field,
                        placeholder: event.target.value || null,
                      })
                    }
                    className="input h-10 w-full"
                    placeholder="例如：請輸入完整姓名"
                  />
                </label>
                <label>
                  <FieldCaption>填寫說明</FieldCaption>
                  <input
                    value={field.help_text ?? ""}
                    onChange={(event) =>
                      setField(index, {
                        ...field,
                        help_text: event.target.value || null,
                      })
                    }
                    className="input h-10 w-full"
                    placeholder="例如：供確認聯絡資料使用"
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div
        className="mt-6 border-t pt-5"
        style={{ borderColor: "var(--border)" }}
      >
        <h3 className="font-semibold">個別開放覆寫</h3>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          未設定時沿用全站排程；品項停用會直接停止投稿。
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_open_override === true}
              onChange={(event) =>
                update("is_open_override", event.target.checked ? true : null)
              }
            />
            立即開放此品項
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_active ?? true}
              onChange={(event) => update("is_active", event.target.checked)}
            />
            品項啟用
          </label>
          <label>
            <FieldCaption>個別開始時間</FieldCaption>
            <input
              type="datetime-local"
              value={toLocal(draft.opens_at_override)}
              onChange={(event) =>
                update("opens_at_override", event.target.value || null)
              }
              className="input w-full"
            />
          </label>
          <label>
            <FieldCaption>個別截止時間</FieldCaption>
            <input
              type="datetime-local"
              value={toLocal(draft.closes_at_override)}
              onChange={(event) =>
                update("closes_at_override", event.target.value || null)
              }
              className="input w-full"
            />
          </label>
          <label>
            <FieldCaption>個別檔案上限（MB）</FieldCaption>
            <input
              type="number"
              min="1"
              max="250"
              value={draft.max_file_size_mb_override ?? ""}
              onChange={(event) =>
                update(
                  "max_file_size_mb_override",
                  event.target.value ? Number(event.target.value) : null,
                )
              }
              className="input w-full"
              placeholder="沿用全站"
            />
          </label>
        </div>
      </div>
      <div
        className="mt-6 border-t pt-5"
        style={{ borderColor: "var(--border)" }}
      >
        <h3 className="font-semibold">投稿通知</h3>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          品項送出時通知指定負責人；未指定收件人時會依系統權限自動尋找負責人。
        </p>
        <div className="mt-3 space-y-3">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.notification_enabled !== false}
              onChange={(event) =>
                update("notification_enabled", event.target.checked ? true : false)
              }
            />
            啟用此品項通知
          </label>
          <NotificationRecipientPicker
            value={draft.notification_recipient_ids ?? []}
            onChange={(ids) => update("notification_recipient_ids", ids)}
          />
          {(draft.notification_enabled !== null || draft.notification_recipient_ids !== null) && (
            <button
              type="button"
              className="btn btn-ghost min-h-9 text-xs"
              onClick={() => {
                onChange({
                  ...draft,
                  notification_enabled: null,
                  notification_recipient_ids: null,
                });
              }}
            >
              恢復沿用全域通知設定
            </button>
          )}
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="btn min-h-11"
          style={{
            background: "var(--primary)",
            color: "var(--primary-fg)",
            border: "none",
          }}
        >
          {saving ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <Save size={16} />
          )}
          儲存品項設定
        </button>
      </div>
    </section>
  );
}

function ReviewRow({
  submission,
  fields,
  onReviewed,
  canReview,
}: {
  submission: VotingSubmission;
  fields: SubmissionCustomField[];
  onReviewed: () => void;
  canReview: boolean;
}) {
  const [status, setStatus] = useState<
    | "reviewing"
    | "review_completed"
    | "approved"
    | "revision_requested"
    | "rejected"
  >(
    submission.status === "draft" || submission.status === "submitted"
      ? "reviewing"
      : submission.status,
  );
  const [note, setNote] = useState(submission.review_note ?? "");
  const [saving, setSaving] = useState(false);
  const review = async () => {
    setSaving(true);
    try {
      await merchandiseSubmissionsApi.review(submission.id, {
        status,
        review_note: note || null,
      });
      toast.success("審核結果已儲存，學生會收到通知");
      onReviewed();
    } catch (error) {
      toast.error(apiErrorMessage(error, "無法儲存審核結果"));
    } finally {
      setSaving(false);
    }
  };
  const uploadFile = (file: File, reportProgress: (progress: number) => void, replaceFileId?: string) =>
    replaceFileId
      ? merchandiseSubmissionsApi.replaceSubmissionFile(submission.id, replaceFileId, file, reportProgress)
      : merchandiseSubmissionsApi.addSubmissionFile(submission.id, file, reportProgress);
  return (
    <article
      className="min-w-0 border-b py-4 last:border-0"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold">
            {submission.item_name}{" "}
            <span
              className="font-normal break-words"
              style={{ color: "var(--text-muted)" }}
            >
              · {submission.submitter_name} ·{" "}
              {submission.submitter_student_id || "未填學號"}
            </span>
          </p>
          <p className="mt-1 break-words text-xs" style={{ color: "var(--text-muted)" }}>
            {submission.submitter_email} ·{" "}
            {submission.submitted_at
              ? new Date(submission.submitted_at).toLocaleString("zh-TW")
              : "草稿"}
          </p>
        </div>
        <span
          className="rounded px-2 py-1 text-xs font-medium"
          style={{
            background: "var(--primary-dim)",
            color: "var(--primary-text)",
          }}
        >
          {submission.status}
        </span>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {Object.entries(submission.field_values).map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
              {fields.find((field) => field.key === key)?.label ?? key}
            </dt>
            <dd className="break-words" style={{ color: "var(--text-secondary)" }}>{value}</dd>
          </div>
        ))}
      </dl>
      {submission.voting_survey_title && submission.voting_survey_id && (
        <p className="mt-3 break-words text-sm" style={{ color: "var(--text-secondary)" }}>
          已加入票選問卷：
          <Link
            href={`/surveys/${submission.voting_survey_id}`}
            className="ml-1 break-all underline"
          >
            {submission.voting_survey_title}
          </Link>
          {submission.voting_survey_status === "draft" && "（尚未發布）"}
        </p>
      )}
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {submission.files.map((file) => (
          <div
            key={file.id}
            className="min-w-0 overflow-hidden rounded-lg border p-2 text-xs"
            style={{ borderColor: "var(--border)" }}
          >
            <a
              href={uploadUrl(file.url)}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {isPreviewableImage(file) ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={uploadUrl(file.url)}
                  alt={`${file.filename} 預覽`}
                  className="aspect-square w-full rounded object-cover"
                />
              ) : (
                <div
                  className="flex aspect-square items-center justify-center rounded"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  <FileImage size={28} />
                </div>
              )}
            </a>
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium" title={file.filename}>
                {file.filename}
              </span>
              {canReview && (
                <div className="w-40 shrink-0">
                  <AnimatedFileUpload
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    label="替換檔案"
                    hint=""
                    onUpload={(replacement, reportProgress) => uploadFile(replacement, reportProgress, file.id)}
                    onUploaded={() => {
                      toast.success("投稿檔案已替換");
                      onReviewed();
                    }}
                  />
                </div>
              )}
            </div>
            <AIEvidencePanel file={file} />
          </div>
        ))}
      </div>
      {canReview && (
        <>
          <div className="mt-3 max-w-sm">
            <AnimatedFileUpload
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              label="拖曳新投稿檔案到這裡"
              hint="可一次增加多個檔案"
              onUpload={(file, reportProgress) => uploadFile(file, reportProgress)}
              onUploaded={() => {
                toast.success("投稿檔案已增加");
                onReviewed();
              }}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[11rem_1fr_auto]">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              className="input"
            >
              <option value="reviewing">審核中</option>
              <option value="review_completed">審核完成（進入全校投票）</option>
              <option value="approved">採用</option>
              <option value="revision_requested">請補件</option>
              <option value="rejected">未採用</option>
            </select>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="input"
              placeholder="給學生的審核說明（選填）"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => void review()}
              className="btn min-h-11"
              style={{
                background: "var(--primary)",
                color: "var(--primary-fg)",
                border: "none",
              }}
            >
              {saving ? "儲存中…" : "儲存審核"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}

export default function MerchandiseSubmissionsAdminPage() {
  const { can } = usePermissions();
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
  const load = useCallback(async () => {
    if (!canAccessAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
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
  }, [canAccessAdmin, canManageSubmissions, canReviewSubmissions]);
  useEffect(() => {
    void load();
  }, [load]);
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
  if (!canAccessAdmin)
    return (
      <main className="p-6">
        <h1 className="text-xl font-bold">無法存取投稿管理</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          需要校商投稿查看、管理或審核權限。
        </p>
      </main>
    );
  if (loading || (canManageSubmissions && !settings))
    return (
      <main className="p-6">
        <div
          className="h-36 animate-pulse rounded-xl"
          style={{ background: "var(--bg-elevated)" }}
        />
      </main>
    );

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
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
              <input
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
                      <input
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
              void load();
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
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              依品項、投稿者與目前狀態篩選，快速處理需要審核的投稿。
            </p>
          </div>
          {canReviewSubmissions && (
            <div
              className="mt-5 rounded-lg border p-4"
              style={{ background: "var(--primary-dim)", borderColor: "var(--border)" }}
            >
              <p className="font-semibold">建立全校票選問卷</p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                將所有「審核完成」的品項彙整成同一份問卷，每個品項一題，讓同學選擇一個或多個喜歡的圖案。
                建立後請先確認題目與圖稿，再到問卷頁發布。
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
                  onReviewed={() => void load()}
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
    </main>
  );
}
