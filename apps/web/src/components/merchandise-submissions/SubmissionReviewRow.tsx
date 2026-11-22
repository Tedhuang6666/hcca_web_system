"use client";

import { useState } from "react";
import Link from "next/link";
import { FileImage } from "lucide-react";
import { toast } from "sonner";

import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import { apiErrorMessage, merchandiseSubmissionsApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import type {
  MerchandiseSubmissionAdminListItem,
  SubmissionCustomField,
} from "@/lib/types";
import { isPreviewableImage } from "@/lib/merchandise-submission-editor";

import { AIEvidencePanel, AuthenticatedPreviewImage } from "./SubmissionAIEvidence";
import type { VotingSubmission } from "./SubmissionAdminTypes";

export function ReviewRow({
  submission,
  fields,
  onReviewed,
  canReview,
}: {
  submission: VotingSubmission;
  fields: SubmissionCustomField[];
  onReviewed: (updated: MerchandiseSubmissionAdminListItem) => void;
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
      const updated = await merchandiseSubmissionsApi.review(submission.id, {
        status,
        review_note: note || null,
      });
      toast.success("審核結果已儲存，學生會收到通知");
      onReviewed(updated);
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
                <AuthenticatedPreviewImage
                  src={file.url}
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
                    onUploaded={(updated) => {
                      toast.success("投稿檔案已替換");
                      onReviewed(updated);
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
              onUploaded={(updated) => {
                toast.success("投稿檔案已增加");
                onReviewed(updated);
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
