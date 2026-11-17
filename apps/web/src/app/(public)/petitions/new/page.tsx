"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, petitionsApi, usersApi } from "@/lib/api";
import type { PetitionCreatedOut, PetitionTypeOut } from "@/lib/types";
import DraftStatus from "@/components/ui/DraftStatus";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";

type PetitionDraft = {
  typeId: string;
  title: string;
  content: string;
};

type AttachmentUpload = { file: File; status: "uploading" | "failed" | "done" };

export default function NewPetitionPage() {
  const [types, setTypes] = useState<PetitionTypeOut[]>([]);
  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<PetitionCreatedOut | null>(null);
  const [uploads, setUploads] = useState<AttachmentUpload[]>([]);
  const [submitError, setSubmitError] = useState("");
  const [typesError, setTypesError] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "unauthenticated">("checking");
  const [draftScope, setDraftScope] = useState("user");

  useEffect(() => {
    let cancelled = false;
    void usersApi.me()
      .then((user) => {
        if (cancelled) return;
        setAccountName(user.display_name);
        setAccountEmail(user.email);
        setDraftScope(`user:${user.id}`);
        setAuthState("authenticated");
      })
      .catch(() => {
        if (!cancelled) setAuthState("unauthenticated");
      });
    petitionsApi.listTypes()
      .then((items) => {
        setTypes(items);
        if (items[0]) setTypeId(items[0].id);
      })
      .catch(() => setTypesError("無法載入陳情類型，請重新整理頁面後再試。"));
    return () => { cancelled = true; };
  }, []);

  const restoreDraft = useCallback((draft: PetitionDraft) => {
    setTypeId(draft.typeId);
    setTitle(draft.title);
    setContent(draft.content);
    toast.info("已復原未送出的陳情草稿");
  }, []);

  const { clearDraft, flushDraft, lastSavedAt } = useDraftAutosave<PetitionDraft>({
    key: `petitions:new:${draftScope}`,
    value: { typeId, title, content },
    onRestore: restoreDraft,
    enabled: authState === "authenticated",
    isEmpty: useCallback((draft: PetitionDraft) => (
      !draft.title.trim() && !draft.content.trim()
    ), []),
  });
  const uploadFile = async (caseId: string, file: File, index: number) => {
    setUploads(current => current.map((item, i) => i === index ? { ...item, status: "uploading" } : item));
    try {
      await petitionsApi.uploadAttachment(caseId, file);
      setUploads(current => current.map((item, i) => i === index ? { ...item, status: "done" } : item));
    } catch {
      setUploads(current => current.map((item, i) => i === index ? { ...item, status: "failed" } : item));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authState !== "authenticated" || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    let result: PetitionCreatedOut;
    try {
      result = await petitionsApi.create({
        type_id: typeId,
        title,
        content,
      });
    } catch (err) {
      flushDraft();
      setSubmitting(false);
      if (err instanceof ApiError && err.status === 401) {
        window.location.assign("/login?next=%2Fpetitions%2Fnew");
        return;
      }
      setSubmitError(err instanceof ApiError ? err.message : "送件失敗，請稍後再試。");
      return;
    }
    // 案件已建立：先清草稿並顯示收件結果，附件失敗不得讓使用者以為沒送出而重送。
    clearDraft();
    setUploads(files.map(file => ({ file, status: "uploading" })));
    setCreated(result);
    setSubmitting(false);
    for (const [index, file] of files.entries()) {
      await uploadFile(result.id, file, index);
    }
  };

  if (created) {
    return (
      <div className="petition-receipt-page max-w-2xl mx-auto space-y-5">
        <article className="petition-receipt card p-6 space-y-4">
          <div className="petition-receipt-seal" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 4.2 4.2L19 6.8" />
            </svg>
            <span>已收件</span>
          </div>
          <div className="petition-receipt-heading">
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>案件已送出</h1>
          </div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            可從「我的案件」查看進度。
          </p>
          <div className="petition-receipt-codes">
            <div className="petition-receipt-code rounded-lg p-4" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>案號</p>
              <p className="text-2xl font-semibold tracking-widest" style={{ color: "var(--text-primary)" }}>{created.case_number}</p>
            </div>
          </div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{created.status_public_message}</p>
          {uploads.length > 0 && (
            <section aria-label="附件上傳狀態" aria-live="polite">
              <ul className="space-y-2">
                {uploads.map((upload, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2 break-all text-sm">
                    <span>{upload.file.name}</span>
                    <span>{upload.status === "uploading" ? "上傳中" : upload.status === "done" ? "已上傳" : "上傳失敗"}</span>
                    {upload.status === "failed" && (
                      <button type="button" className="btn btn-ghost" onClick={() => void uploadFile(created.id, upload.file, index)}>重試上傳 {upload.file.name}</button>
                    )}
                  </li>
                ))}
              </ul>
              {uploads.some(upload => upload.status === "uploading") && <p role="status">附件上傳中，請留在此頁。</p>}
            </section>
          )}
          <div className="flex gap-2 flex-wrap">
            <Link className="btn btn-primary" href={`/petitions/${created.id}`}>查看案件進度</Link>
            <Link className="btn btn-ghost" href="/petitions">回我的案件</Link>
          </div>
        </article>
      </div>
    );
  }

  if (authState === "checking") {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center" role="status">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>正在確認登入狀態…</p>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <div className="mx-auto max-w-2xl space-y-5 py-10">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>我要陳情</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            登入後以具名方式送出。
          </p>
        </div>
        <Link className="btn btn-primary" href="/login?next=%2Fpetitions%2Fnew">登入</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>我要陳情</h1>
        <DraftStatus lastSavedAt={lastSavedAt} className="mt-2" />
      </div>
      <form onSubmit={submit} className="petition-submission-form card p-5 space-y-4">
        <div className="rounded-lg p-4 text-sm" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
          系統會以目前登入帳號送件：{accountName || "未命名使用者"} · {accountEmail || "未提供 email"}。
        </div>
        <label className="block">
          <span className="text-sm font-medium">陳情類型</span>
          <select className="input w-full mt-1" value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {typesError && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{typesError}</p>}
        <label className="block">
          <span className="text-sm font-medium">標題</span>
          <input className="input w-full mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">陳情內容</span>
          <textarea className="input w-full min-h-52 mt-1" placeholder="請描述事實、期待處理方式與相關時間地點" value={content} onChange={(e) => setContent(e.target.value)} required />
        </label>
        <AnimatedFileUpload
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          multiple
          maxFiles={10}
          label="拖曳陳情附件到這裡"
          hint="可貼上圖片"
          onFiles={(selected) => setFiles((current) => [...current, ...selected].slice(0, 10))}
          onRemove={(removed) => setFiles((current) => current.filter((file) => file !== removed))}
        />
        {submitError && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{submitError}</p>}
        <div className="flex justify-end gap-2">
          <Link className="btn btn-ghost" href="/petitions">取消</Link>
          <button
            className="petition-submit-button btn btn-primary"
            disabled={submitting || !typeId}
            aria-busy={submitting}
          >
            {submitting ? "送出中..." : "送出陳情"}
          </button>
        </div>
      </form>
    </div>
  );
}
