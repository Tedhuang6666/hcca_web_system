"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Clock3,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  LoaderCircle,
  Package,
  Pencil,
  Plus,
  Send,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage, merchandiseSubmissionsApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import { usePermissions } from "@/hooks/usePermissions";
import MarkdownBlock from "@/components/site/MarkdownBlock";
import { excerpt } from "@/lib/seo";
import type {
  MerchandiseSubmissionItemPortalOut,
  MerchandiseSubmissionOut,
  MerchandiseSubmissionPortalOut,
  MerchandiseSubmissionUploadOut,
} from "@/lib/types";

type VotingSubmission = MerchandiseSubmissionOut & {
  status: MerchandiseSubmissionOut["status"] | "review_completed";
  voting_survey_id?: string | null;
  voting_survey_status?: string | null;
};

const statusLabel: Record<string, string> = {
  draft: "草稿",
  submitted: "已送出",
  reviewing: "審核中",
  review_completed: "審核完成",
  approved: "已採用",
  revision_requested: "需要補件",
  rejected: "未採用",
};
const editableStatuses = new Set<MerchandiseSubmissionOut["status"]>([
  "draft",
  "revision_requested",
]);

function isPreviewableImage(file: { content_type: string; filename: string }) {
  return (
    file.content_type.startsWith("image/") ||
    /\.(jpe?g|png|webp)$/i.test(file.filename)
  );
}

function hasItemDetails(item: MerchandiseSubmissionItemPortalOut) {
  return Boolean(
    item.description?.trim() ||
      item.specification?.trim() ||
      item.template_images.length,
  );
}

function formatDeadline(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function UploadBox({
  item,
  files,
  onChange,
  disabled,
}: {
  item: MerchandiseSubmissionItemPortalOut;
  files: MerchandiseSubmissionUploadOut[];
  onChange: (next: MerchandiseSubmissionUploadOut[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (picked: FileList | null) => {
    if (!picked?.length || disabled) return;
    if (files.length + picked.length > 10) {
      toast.error("每次投稿最多可上傳 10 個檔案");
      return;
    }
    setUploading(true);
    try {
      const added: MerchandiseSubmissionUploadOut[] = [];
      for (const file of Array.from(picked))
        added.push(await merchandiseSubmissionsApi.upload(item.id, file));
      onChange([...files, ...added]);
      toast.success(`已上傳 ${added.length} 個檔案`);
    } catch (error) {
      toast.error(apiErrorMessage(error, "上傳失敗，請確認檔案格式與大小"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  return (
    <div className="space-y-3">
      <div
        className="rounded-xl border border-dashed p-5 text-center"
        style={{ borderColor: "var(--border-strong)" }}
      >
        <Upload
          size={30}
          className="mx-auto"
          style={{ color: "var(--primary-text)" }}
        />
        <p className="mt-3 font-medium">可一次選擇多個設計圖稿</p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          JPG、PNG、WebP、PDF；單檔上限 {item.effective_max_file_size_mb} MB
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          disabled={disabled || uploading}
          onChange={(event) => void upload(event.target.files)}
        />
        <button
          type="button"
          className="btn mt-4 min-h-11"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          style={{
            background: "var(--primary)",
            color: "var(--primary-fg)",
            border: "none",
          }}
        >
          {uploading ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <Upload size={16} />
          )}
          {uploading ? "正在上傳…" : "選擇圖稿檔案"}
        </button>
        {disabled && (
          <p className="mt-3 text-xs" style={{ color: "var(--danger)" }}>
            目前無法上傳，請確認投稿時間與校務信箱限制。
          </p>
        )}
      </div>
      {files.length > 0 && (
        <ul
          className="divide-y rounded-lg border"
          style={{ borderColor: "var(--border)" }}
        >
          {files.map((file) => (
            <li key={file.storage_key} className="flex items-center gap-3 p-3">
              {isPreviewableImage(file) ? (
                <a
                  href={uploadUrl(file.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 overflow-hidden rounded border"
                  style={{ borderColor: "var(--border)" }}
                  aria-label={`預覽 ${file.filename}`}
                >
                  {/* Uploaded files use runtime storage URLs, so Next image optimization cannot be applied. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={uploadUrl(file.url)}
                    alt={`${file.filename} 預覽`}
                    className="h-14 w-14 object-cover"
                  />
                </a>
              ) : (
                <FileText size={18} style={{ color: "var(--primary-text)" }} />
              )}
              <input
                value={file.filename}
                onChange={(event) =>
                  onChange(
                    files.map((entry) =>
                      entry.storage_key === file.storage_key
                        ? { ...entry, filename: event.target.value }
                        : entry,
                    ),
                  )
                }
                className="input h-9 min-w-0 flex-1 text-sm"
                aria-label="投稿檔案名稱"
              />
              <span
                className="shrink-0 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                {(file.file_size / 1024 / 1024).toFixed(1)} MB
              </span>
              <button
                type="button"
                className="topbar-icon-btn h-9 w-9"
                aria-label={`移除 ${file.filename}`}
                onClick={() =>
                  onChange(
                    files.filter(
                      (entry) => entry.storage_key !== file.storage_key,
                    ),
                  )
                }
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateGallery({
  item,
}: {
  item: MerchandiseSubmissionItemPortalOut;
}) {
  if (!item.template_images.length) return null;
  return (
    <section
      className="rounded-xl border p-5 sm:p-6"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
    >
      <h2 className="text-lg font-semibold">設計範本</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        請依範本完成設計；可開啟原圖檢視細節或下載。
      </p>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {item.template_images.map((template) => (
          <a
            key={template.url}
            href={uploadUrl(template.url)}
            target="_blank"
            rel="noreferrer"
            className="group overflow-hidden rounded-lg border p-3"
            style={{ borderColor: "var(--border)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={uploadUrl(template.url)}
              alt={`${template.label} 範本`}
              className="max-h-[34rem] w-full object-contain"
              style={{ background: "var(--bg-elevated)" }}
            />
            <span className="mt-3 flex items-center justify-between gap-2 text-sm font-semibold">
              {template.label}
              <Download size={16} />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function MerchandiseSubmissionsPage() {
  const { can } = usePermissions();
  const [portal, setPortal] = useState<MerchandiseSubmissionPortalOut | null>(
    null,
  );
  const [submissions, setSubmissions] = useState<VotingSubmission[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<MerchandiseSubmissionUploadOut[]>([]);
  const [tab, setTab] = useState<"submit" | "mine">("submit");
  const [isPickerOpen, setIsPickerOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const shouldScrollToDetails = useRef(false);
  const selected = useMemo(
    () => portal?.items.find((item) => item.id === selectedId) ?? null,
    [portal, selectedId],
  );
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [portalData, mine] = await Promise.all([
        merchandiseSubmissionsApi.portal(),
        merchandiseSubmissionsApi.mine(),
      ]);
      setPortal(portalData);
      setSubmissions(mine);
    } catch (error) {
      toast.error(apiErrorMessage(error, "無法載入校商投稿"));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!shouldScrollToDetails.current || isPickerOpen || !selectedId) return;
    shouldScrollToDetails.current = false;
    if (!selected || !hasItemDetails(selected)) return;

    const frame = window.requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isPickerOpen, selected, selectedId]);
  const choose = (id: string) => {
    shouldScrollToDetails.current = true;
    setSelectedId(id);
    setEditingId(null);
    setValues({});
    setFiles([]);
    setIsPickerOpen(false);
  };
  const edit = (submission: MerchandiseSubmissionOut) => {
    shouldScrollToDetails.current = true;
    setSelectedId(submission.item_id);
    setValues(submission.field_values);
    setFiles(submission.files);
    setEditingId(submission.id);
    setIsPickerOpen(false);
    setTab("submit");
  };
  const save = async (submit: boolean) => {
    if (!selected) return;
    setSaving(true);
    try {
      const body = { item_id: selected.id, field_values: values, files };
      const saved = editingId
        ? await merchandiseSubmissionsApi.updateSubmission(
            editingId,
            body,
            submit,
          )
        : await merchandiseSubmissionsApi.save(body, submit);
      setSubmissions((current) =>
        editingId
          ? current.map((entry) => (entry.id === saved.id ? saved : entry))
          : [saved, ...current],
      );
      if (submit) {
        setEditingId(null);
        setValues({});
        setFiles([]);
      } else setEditingId(saved.id);
      toast.success(
        submit ? "投稿已送出。" : "草稿已儲存，可在我的投稿繼續編輯。",
      );
    } catch (error) {
      toast.error(
        apiErrorMessage(error, submit ? "無法送出投稿" : "無法儲存草稿"),
      );
    } finally {
      setSaving(false);
    }
  };
  if (loading)
    return (
      <main className="p-6">
        <div
          className="h-36 animate-pulse rounded-xl"
          style={{ background: "var(--bg-elevated)" }}
        />
      </main>
    );
  const canUpload = Boolean(
    selected?.is_accepting && portal?.is_eligible_submitter,
  );
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <header
        className="flex flex-wrap items-end justify-between gap-4 border-b pb-6"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--primary-text)" }}
          >
            校園商品設計徵集
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">校商投稿</h1>
          <p
            className="mt-2 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            依規格上傳圖稿、儲存草稿並送出審核。
          </p>
        </div>
        {can("shop:manage") && (
          <Link
            href="/merchandise-submissions/admin"
            className="btn btn-ghost min-h-11"
          >
            管理投稿設定
          </Link>
        )}
      </header>
      {portal?.settings.require_school_email &&
        !portal.is_eligible_submitter && (
          <p
            className="rounded-lg border px-4 py-3 text-sm"
            style={{
              background: "var(--danger-dim)",
              borderColor: "var(--danger-border)",
              color: "var(--danger)",
            }}
          >
            本次校商投稿僅限使用校務信箱登入的帳號。
          </p>
        )}
      <nav
        className="flex border-b"
        style={{ borderColor: "var(--border)" }}
        aria-label="校商投稿頁籤"
      >
        <button
          type="button"
          onClick={() => setTab("submit")}
          className="min-h-11 border-b-2 px-4 text-sm font-semibold"
          style={{
            borderColor: tab === "submit" ? "var(--primary)" : "transparent",
          }}
        >
          {editingId ? "編輯投稿" : "我要投稿"}
        </button>
        <button
          type="button"
          onClick={() => setTab("mine")}
          className="min-h-11 border-b-2 px-4 text-sm font-semibold"
          style={{
            borderColor: tab === "mine" ? "var(--primary)" : "transparent",
          }}
        >
          我的投稿（{submissions.length}）
        </button>
      </nav>
      {tab === "mine" ? (
        <section className="space-y-3">
          {submissions.length ? (
            submissions.map((submission) => (
              <article
                key={submission.id}
                className="rounded-xl border p-5"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: "var(--border)",
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{submission.item_name}</h2>
                    <p
                      className="mt-1 flex items-center gap-1 text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <Clock3 size={12} />
                      {new Intl.DateTimeFormat("zh-TW", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(
                        new Date(
                          submission.submitted_at ?? submission.created_at,
                        ),
                      )}
                    </p>
                  </div>
                  <span
                    className="rounded px-2 py-1 text-xs font-semibold"
                    style={{
                      background: "var(--primary-dim)",
                      color: "var(--primary-text)",
                    }}
                  >
                    {statusLabel[submission.status]}
                  </span>
                </div>
                {submission.review_note && (
                  <p
                    className="mt-3 rounded-lg p-3 text-sm"
                    style={{ background: "var(--bg-elevated)" }}
                  >
                    {submission.review_note}
                  </p>
                )}
                {submission.status === "review_completed" && (
                  submission.voting_survey_id && submission.voting_survey_status === "open" ? (
                    <Link
                      href={`/surveys/${submission.voting_survey_id}`}
                      className="btn mt-3 min-h-10"
                      style={{
                        background: "var(--primary)",
                        color: "var(--primary-fg)",
                        border: "none",
                      }}
                    >
                      前往全校投票
                    </Link>
                  ) : (
                    <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
                      投票問卷準備中，待管理員確認發布後開放填答。
                    </p>
                  )
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {submission.files.map((file) => (
                    <a
                      key={file.id}
                      href={uploadUrl(file.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="overflow-hidden rounded-lg border p-2 text-xs"
                      style={{ borderColor: "var(--border)" }}
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
                          <FileText size={28} />
                        </div>
                      )}
                      <span className="mt-2 block truncate font-medium">
                        {file.filename}
                      </span>
                    </a>
                  ))}
                </div>
                {editableStatuses.has(submission.status) && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => edit(submission)}
                      className="btn min-h-10"
                      style={{
                        background: "var(--primary)",
                        color: "var(--primary-fg)",
                        border: "none",
                      }}
                    >
                      <Pencil size={14} />
                      編輯投稿
                    </button>
                  </div>
                )}
              </article>
            ))
          ) : (
            <p
              className="py-16 text-center text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              尚未送出任何投稿。
            </p>
          )}
        </section>
      ) : (
        <div className="space-y-6">
          {portal?.settings.submission_intro && (
            <section
              className="rounded-xl border p-5 sm:p-6"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border)",
              }}
            >
              <h2 className="text-lg font-semibold">投稿前言與說明</h2>
              <div className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
                <MarkdownBlock markdown={portal.settings.submission_intro} />
              </div>
            </section>
          )}
          {portal?.settings.closes_at && (
            <section
              className="flex items-start gap-3 rounded-xl border p-4 sm:p-5"
              style={{
                background: "var(--primary-dim)",
                borderColor: "var(--border-strong)",
              }}
            >
              <Clock3
                size={20}
                className="mt-0.5 shrink-0"
                style={{ color: "var(--primary-text)" }}
              />
              <div>
                <h2 className="font-semibold">全站預設截止時間</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                  請於 {formatDeadline(portal.settings.closes_at)} 前送出投稿；若品項有個別
                  設定，請以品項卡片標示的時間為準。
                </p>
              </div>
            </section>
          )}
          {portal?.items.length ? (
            <>
              <section
                className="rounded-xl border p-5 sm:p-6"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: "var(--border)",
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">
                        {isPickerOpen ? "可投稿品項" : "已選擇品項"}
                      </h2>
                      {!isPickerOpen && selected && (
                        <span
                          className="rounded px-2 py-1 text-xs font-semibold"
                          style={{
                            background: "var(--success-dim)",
                            color: "var(--success)",
                          }}
                        >
                          已選擇
                        </span>
                      )}
                    </div>
                    <p
                      className="mt-1 text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {isPickerOpen
                        ? "請選擇要設計的商品；每個品項都有自己的規格與範本。"
                        : `目前選擇：${selected?.name ?? "尚未選擇"}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected && !isPickerOpen && !editingId && (
                      <button
                        type="button"
                        className="btn btn-ghost min-h-10"
                        aria-expanded={isPickerOpen}
                        aria-controls="merchandise-item-picker"
                        onClick={() => setIsPickerOpen(true)}
                      >
                        <ChevronDown size={15} />
                        更換品項
                      </button>
                    )}
                    {editingId && (
                      <button
                        type="button"
                        className="btn btn-ghost min-h-10"
                        onClick={() => {
                          setEditingId(null);
                          setValues({});
                          setFiles([]);
                          setIsPickerOpen(true);
                        }}
                      >
                        <Plus size={15} />
                        建立新投稿
                      </button>
                    )}
                  </div>
                </div>
                {isPickerOpen ? (
                  <div
                    id="merchandise-item-picker"
                    className="mt-5 grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3"
                    role="group"
                    aria-label="可投稿品項"
                  >
                      {portal.items.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          aria-pressed={selectedId === item.id}
                          disabled={Boolean(editingId)}
                          onClick={() => choose(item.id)}
                          className="relative flex min-h-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:block sm:min-h-36 sm:rounded-xl sm:p-4"
                          style={{
                            background:
                              selectedId === item.id
                                ? "var(--primary-dim)"
                                : "var(--bg-elevated)",
                            borderColor:
                              selectedId === item.id
                                ? "var(--primary)"
                                : "var(--border)",
                            outlineColor: "var(--primary)",
                          }}
                        >
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10"
                            style={{
                              background:
                                selectedId === item.id
                                  ? "var(--bg-surface)"
                                  : "var(--primary-dim)",
                              color: "var(--primary-text)",
                            }}
                          >
                            <Package size={20} />
                          </span>
                          {selectedId === item.id && (
                            <CheckCircle2
                              size={20}
                              className="absolute right-3 top-3 sm:right-4 sm:top-4"
                              style={{ color: "var(--primary-text)" }}
                              aria-label="已選擇"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold sm:mt-4 sm:text-base">
                              {item.name}
                            </span>
                            <span
                              className="mt-1 hidden truncate text-sm sm:block"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              {excerpt(item.description, "") ||
                                (item.specification
                                  ? "已提供詳細規格"
                                  : "請依品項需求上傳圖稿")}
                            </span>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:mt-3">
                              <span
                                className="inline-flex rounded px-2 py-1 text-xs font-semibold"
                                style={{
                                  background: item.is_accepting
                                    ? "var(--success-dim)"
                                    : "var(--danger-dim)",
                                  color: item.is_accepting
                                    ? "var(--success)"
                                    : "var(--danger)",
                                }}
                              >
                                {item.is_accepting ? "開放投稿" : "目前未開放"}
                              </span>
                              {item.effective_closes_at && (
                                <span
                                  className="flex items-center gap-1 text-xs font-medium"
                                  style={{ color: "var(--text-secondary)" }}
                                >
                                  <Clock3 size={13} />
                                  截止 {formatDeadline(item.effective_closes_at)}
                                </span>
                              )}
                              {hasItemDetails(item) && (
                                <span
                                  className="flex items-center gap-1 text-xs font-medium"
                                  style={{ color: "var(--primary-text)" }}
                                >
                                  <FileText size={13} />
                                  有規格與範本
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                  </div>
                ) : selected ? (
                  <div
                    className="mt-5 flex items-center gap-3 rounded-lg border p-3"
                    style={{
                      background: "var(--bg-elevated)",
                      borderColor: "var(--border)",
                    }}
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: "var(--primary-dim)",
                        color: "var(--primary-text)",
                      }}
                    >
                      <Package size={20} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{selected.name}</p>
                      <p
                        className="mt-1 text-sm"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {hasItemDetails(selected)
                          ? "以下為品項資訊、規格與設計範本。"
                          : "已選擇品項，請準備投稿檔案。"}
                      </p>
                    </div>
                  </div>
                ) : null}
              </section>
              {selected && hasItemDetails(selected) && (
                <div
                  ref={detailsRef}
                  id="merchandise-item-details"
                  className="scroll-mt-24 space-y-6"
                >
                  {selected.description && (
                    <section
                      className="rounded-xl border p-5 sm:p-6"
                      style={{
                        background: "var(--bg-surface)",
                        borderColor: "var(--border)",
                      }}
                    >
                      <h2 className="text-lg font-semibold">品項資訊</h2>
                      <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                        <MarkdownBlock markdown={selected.description} />
                      </div>
                    </section>
                  )}
                  {selected.specification && (
                    <section
                      className="rounded-xl border p-5 sm:p-6"
                      style={{
                        background: "var(--bg-surface)",
                        borderColor: "var(--border)",
                      }}
                    >
                      <h2 className="text-lg font-semibold">品項規格</h2>
                      <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                        <MarkdownBlock markdown={selected.specification} />
                      </div>
                    </section>
                  )}
                  <TemplateGallery item={selected} />
                </div>
              )}
              {selected && (
                <section
                  className="rounded-xl border p-5 sm:p-6"
                  style={{
                    background: "var(--bg-surface)",
                    borderColor: "var(--border)",
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">
                      {editingId ? "編輯圖稿與投稿資料" : "上傳圖稿與投稿資料"}
                    </h2>
                    <span
                      className="rounded px-2 py-1 text-xs font-semibold"
                      style={{
                        background: selected.is_accepting
                          ? "var(--success-dim)"
                          : "var(--danger-dim)",
                        color: selected.is_accepting
                          ? "var(--success)"
                          : "var(--danger)",
                      }}
                    >
                      {selected.is_accepting ? "開放投稿中" : "目前未開放"}
                    </span>
                  </div>
                  {selected.effective_closes_at && (
                    <p
                      className="mt-3 flex items-center gap-1.5 text-sm font-medium"
                      style={{ color: "var(--primary-text)" }}
                    >
                      <Clock3 size={15} />
                      投稿截止時間：{formatDeadline(selected.effective_closes_at)}
                    </p>
                  )}
                  <div className="mt-5">
                    <UploadBox
                      item={selected}
                      files={files}
                      onChange={setFiles}
                      disabled={!canUpload}
                    />
                  </div>
                  <div className="mt-6 space-y-4">
                    {selected.custom_fields.map((field) => (
                      <label key={field.key} className="block">
                        <span className="text-sm font-medium">
                          {field.label}
                          {field.required && (
                            <span style={{ color: "var(--danger)" }}> *</span>
                          )}
                        </span>
                        {field.field_type === "textarea" ? (
                          <textarea
                            value={values[field.key] ?? ""}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                            maxLength={field.max_length}
                            placeholder={field.placeholder ?? ""}
                            className="input mt-2 min-h-28 w-full py-2"
                          />
                        ) : (
                          <input
                            value={values[field.key] ?? ""}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                            maxLength={field.max_length}
                            placeholder={field.placeholder ?? ""}
                            className="input mt-2 w-full"
                          />
                        )}
                        {field.help_text && (
                          <span
                            className="mt-1 block text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {field.help_text}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                  <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      className="btn btn-ghost min-h-11"
                      disabled={saving || !portal?.is_eligible_submitter}
                      onClick={() => void save(false)}
                    >
                      儲存草稿
                    </button>
                    <button
                      type="button"
                      className="btn min-h-11"
                      disabled={saving || !canUpload}
                      onClick={() => void save(true)}
                      style={{
                        background: "var(--primary)",
                        color: "var(--primary-fg)",
                        border: "none",
                      }}
                    >
                      {saving ? (
                        <LoaderCircle className="animate-spin" size={16} />
                      ) : (
                        <Send size={16} />
                      )}
                      {editingId ? "確認更新投稿" : "確認送出投稿"}
                    </button>
                  </div>
                </section>
              )}
            </>
          ) : (
            <section
              className="rounded-xl border p-8 text-center"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border)",
              }}
            >
              <Package
                size={30}
                className="mx-auto"
                style={{ color: "var(--text-muted)" }}
              />
              <h2 className="mt-4 font-semibold">目前尚未建立投稿品項</h2>
              <p
                className="mx-auto mt-2 max-w-lg text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                管理員需要先建立投稿品項並設定開放時間，這裡才會出現可投稿的商品。
              </p>
              {can("shop:manage") && (
                <Link
                  href="/merchandise-submissions/admin"
                  className="btn mt-5 inline-flex min-h-10"
                  style={{
                    background: "var(--primary)",
                    color: "var(--primary-fg)",
                    border: "none",
                  }}
                >
                  前往建立投稿品項
                </Link>
              )}
            </section>
          )}
        </div>
      )}
    </main>
  );
}
