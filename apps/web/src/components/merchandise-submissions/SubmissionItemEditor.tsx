"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";

import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import NumberInput from "@/components/ui/NumberInput";
import UserPicker from "@/components/surveys/UserPicker";
import { apiErrorMessage, merchandiseSubmissionsApi, usersApi } from "@/lib/api";
import type { SubmissionCustomField, UserSummary } from "@/lib/types";
import { toIso, toLocal } from "@/lib/merchandise-submission-editor";

import { AuthenticatedPreviewImage } from "./SubmissionAIEvidence";
import type { ItemDraft } from "./SubmissionAdminTypes";

export function emptyItem(): ItemDraft {
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

export function emptyField(index: number): SubmissionCustomField {
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




export function FieldCaption({ children }: { children: ReactNode }) {
  return (
    <span
      className="mb-1.5 block text-xs font-medium"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </span>
  );
}

export function NotificationRecipientPicker({
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

export function ItemEditor({
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
          <NumberInput
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
              <AuthenticatedPreviewImage
                src={template.url}
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
                  <NumberInput
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
