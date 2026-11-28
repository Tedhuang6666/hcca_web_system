"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, petitionsApi } from "@/lib/api";
import type { PetitionCaseOut } from "@/lib/types";
import { PetitionStatusBadge } from "@/components/ui/StatusBadge";
import PetitionPublicConsent from "@/components/petitions/PetitionPublicConsent";
import PetitionContentEditor from "@/components/petitions/PetitionContentEditor";
import PetitionAttachmentList from "@/components/petitions/PetitionAttachmentList";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import { PetitionConfidentialBlocked } from "@/components/petitions/PetitionConfidentialBlocked";
import { uploadStagedAttachments, type UploadedStagedAttachment } from "@/components/petitions/petitionStagedAttachments";

function fmt(iso: string | null) {
  if (!iso) return "未設定";
  return new Date(iso).toLocaleString("zh-TW");
}

export default function PetitionDetailPage() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<PetitionCaseOut | null>(null);
  const [supplement, setSupplement] = useState("");
  const [supplementFiles, setSupplementFiles] = useState<File[]>([]);
  const [uploadedSupplementFiles, setUploadedSupplementFiles] = useState<UploadedStagedAttachment[]>([]);
  const [submittingSupplement, setSubmittingSupplement] = useState(false);
  const [supplementUploadKey, setSupplementUploadKey] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItem(await petitionsApi.get(params.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "載入失敗，請從案件查詢進入");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const submitSupplement = async () => {
    if (!item || submittingSupplement || !supplement.trim()) return;
    setSubmittingSupplement(true);
    try {
      await uploadStagedAttachments(
        item.id,
        supplementFiles,
        uploadedSupplementFiles,
        (caseId, file) => petitionsApi.uploadAttachment(caseId, file),
        setUploadedSupplementFiles,
      );
      const updated = await petitionsApi.supplement(item.id, {
        content: supplement.trim(),
      });
      setItem(updated);
      setSupplement("");
      setSupplementFiles([]);
      setUploadedSupplementFiles([]);
      setSupplementUploadKey((key) => key + 1);
      toast.success("補件已送出");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "補件失敗");
    } finally {
      setSubmittingSupplement(false);
    }
  };

  if (loading) return <div className="mx-auto w-full max-w-4xl card p-5">載入中...</div>;
  if (!item) {
    return (
      <div className="mx-auto w-full max-w-2xl card p-5 space-y-3">
        <p className="text-fg-muted!">無法直接查看此案件。</p>
        <Link className="btn btn-primary min-h-11 w-fit" href="/petitions">回我的案件</Link>
      </div>
    );
  }
  if (item.confidential_blocked) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <PetitionConfidentialBlocked item={item} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl min-w-0 space-y-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="break-words text-sm text-fg-muted!">案號 {item.case_number}</p>
          <h1 className="mt-1 break-words text-xl font-semibold text-fg-primary!">{item.title}</h1>
          <p className="mt-1 break-words text-sm text-fg-muted!">{item.current_org_name} · {item.type_name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {item.is_confidential && (
            <span className="rounded-full bg-warning-soft! px-2.5 py-1 text-xs font-medium text-warning!">
              密件處理
            </span>
          )}
          <PetitionStatusBadge status={item.status} />
        </div>
      </div>

      {item.is_confidential && (
        <div className="space-y-1 rounded-lg border border-warning-border! bg-warning-soft! p-4">
          <p className="font-medium text-warning!">本案已密件處理</p>
          <p className="break-words text-sm text-fg-secondary!">密件原因：{item.confidential_reason || "未提供密件原因。"}</p>
          <p className="text-xs text-fg-muted!">完整內容僅案件擁有者與目前承辦人可查看，案件無法公開。</p>
        </div>
      )}

      <section className="min-w-0 card p-5 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0"><p className="text-xs text-fg-muted!">目前階段</p><p className="break-words font-medium">{item.status_label}</p></div>
          <div className="min-w-0"><p className="text-xs text-fg-muted!">負責機關</p><p className="break-words font-medium">{item.current_org_name}</p></div>
          <div className="min-w-0"><p className="text-xs text-fg-muted!">承辦人</p><p className="break-words font-medium">{item.assigned_to_name || "尚未分案"}</p></div>
          <div className="min-w-0"><p className="text-xs text-fg-muted!">最後更新</p><p className="break-words font-medium">{fmt(item.updated_at)}</p></div>
        </div>
        <p className="break-words rounded-lg bg-hover! p-3 text-sm text-fg-muted!">
          {item.status_public_message} 下一步：{item.next_action}
        </p>
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="min-w-0 card p-5 space-y-4">
          <h2 className="font-semibold">陳情內容</h2>
          <p className="break-words whitespace-pre-wrap text-sm leading-7 text-fg-primary!">{item.content}</p>
          {item.public_reply && (
            <div className="rounded-lg border border-success-border! bg-success-soft! p-4">
              <p className="mb-2 font-medium text-success!">承辦回覆</p>
              <p className="break-words whitespace-pre-wrap text-sm">{item.public_reply}</p>
            </div>
          )}
          {item.rejection_reason && (
            <div className="rounded-lg border border-danger-border! bg-danger-soft! p-4">
              <p className="mb-2 font-medium text-danger!">不受理原因</p>
              <p className="break-words whitespace-pre-wrap text-sm">{item.rejection_reason}</p>
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-5">
          <section className="min-w-0 card p-5 space-y-3">
            <h2 className="font-semibold">附件（{item.attachments.length}）</h2>
            <PetitionAttachmentList caseId={item.id} attachments={item.attachments} />
          </section>

          {item.can_supplement && (
            <section className="min-w-0 card p-5 space-y-3">
              <h2 className="font-semibold">補充資料</h2>
              {item.supplement_request && <p className="break-words text-sm text-danger!">{item.supplement_request}</p>}
              <textarea className="input w-full min-h-28" value={supplement} onChange={(e) => setSupplement(e.target.value)} placeholder="請補充承辦機關要求的資料" />
              <AnimatedFileUpload
                key={supplementUploadKey}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                multiple
                maxFiles={10}
                disabled={submittingSupplement}
                label="加入補件附件"
                hint="最多 10 個，會和補充內容一起送出"
                onFiles={(files) => setSupplementFiles((current) => [...current, ...files].slice(0, 10))}
                onRemove={(removed) => {
                  setSupplementFiles((current) => current.filter((file) => file !== removed));
                  setUploadedSupplementFiles((current) => current.filter((item) => item.file !== removed));
                }}
              />
              <button className="btn btn-primary min-h-11 w-full" disabled={!supplement.trim() || submittingSupplement} onClick={submitSupplement}>
                {submittingSupplement ? "送出中…" : "送出補件"}
              </button>
            </section>
          )}
        </aside>
      </div>

      <PetitionContentEditor item={item} onUpdated={setItem} />

      {item.can_respond_public && <PetitionPublicConsent item={item} onUpdated={setItem} />}

      <section className="min-w-0 card p-5 space-y-4">
        <h2 className="font-semibold">處理時間軸</h2>
        <div className="space-y-3">
          {item.events.map((event) => (
            <div key={event.id} className="border-l border-border! py-1 pl-4">
              <p className="break-words text-sm font-medium text-fg-primary!">{event.title}</p>
              {event.content && <p className="mt-1 break-words whitespace-pre-wrap text-sm text-fg-muted!">{event.content}</p>}
              {event.related_document_id && (
                <Link
                  href={`/documents/${event.related_document_id}`}
                  className="mt-1 inline-flex min-h-11 items-center text-xs font-medium text-accent-text! hover:underline"
                >
                  查看關聯公文
                </Link>
              )}
              <p className="mt-1 break-words text-xs text-fg-disabled!">{fmt(event.created_at)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
