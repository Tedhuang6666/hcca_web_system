"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, petitionsApi } from "@/lib/api";
import type { PetitionCreatedOut, PetitionTypeOut } from "@/lib/types";
import DraftStatus from "@/components/ui/DraftStatus";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import { useDraftAutosave } from "@/hooks/useDraftAutosave";

type PetitionDraft = {
  typeId: string;
  title: string;
  content: string;
};

export default function NewPetitionPage() {
  const [types, setTypes] = useState<PetitionTypeOut[]>([]);
  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<PetitionCreatedOut | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [draftScope, setDraftScope] = useState("user");

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setAccountName(localStorage.getItem("user_name") ?? "");
    setAccountEmail(localStorage.getItem("user_email") ?? "");
    setDraftScope(userId ? `user:${userId}` : "user");
    setAuthReady(true);
    petitionsApi.listTypes()
      .then((items) => {
        setTypes(items);
        if (items[0]) setTypeId(items[0].id);
      })
      .catch(() => toast.error("無法載入陳情類型"));
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
    enabled: authReady,
    isEmpty: useCallback((draft: PetitionDraft) => (
      !draft.title.trim() && !draft.content.trim()
    ), []),
  });
  const completedSections = [
    Boolean(typeId),
    true,
    Boolean(title.trim()),
    Boolean(content.trim()),
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await petitionsApi.create({
        type_id: typeId,
        title,
        content,
      });
      for (const file of files) {
          await petitionsApi.uploadAttachment(result.id, file, { verification_code: result.verification_code });
      }
      clearDraft();
      setCreated(result);
      toast.success("陳情案件已送出");
    } catch (err) {
      flushDraft();
      toast.error(err instanceof ApiError ? err.message : "送件失敗");
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    // fragment 不會送至伺服器或寫入 access log；頁面再以 POST body 送 token 查詢。
    const shareHref = `/petitions/share#${created.share_token}`;
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
            請妥善保存案號與驗證碼。驗證碼只會在此畫面顯示一次。
            您也可以直接在我的案件中查看。
          </p>
          <div className="petition-receipt-codes grid sm:grid-cols-2 gap-3">
            <div className="petition-receipt-code rounded-lg p-4" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>案號</p>
              <p className="text-2xl font-semibold tracking-widest" style={{ color: "var(--text-primary)" }}>{created.case_number}</p>
            </div>
            <div className="petition-receipt-code petition-receipt-code--verification rounded-lg p-4" style={{ background: "var(--warning-dim)", border: "1px solid var(--warning-border)" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>驗證碼</p>
              <p className="text-2xl font-semibold tracking-widest" style={{ color: "var(--warning)" }}>{created.verification_code}</p>
            </div>
          </div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{created.status_public_message}</p>
          <div className="flex gap-2 flex-wrap">
            <Link className="btn btn-primary" href={shareHref}>查看案件進度</Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                const url = `${window.location.origin}${shareHref}`;
                await navigator.clipboard.writeText(url);
                toast.success("分享連結已複製");
              }}
            >
              複製分享連結
            </button>
            <Link className="btn btn-ghost" href="/petitions">回陳情系統</Link>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>我要陳情</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>登入帳號後以具名方式送出，系統會依類型自動分派給負責機關。</p>
        <DraftStatus lastSavedAt={lastSavedAt} className="mt-2" />
      </div>
      <form onSubmit={submit} className="petition-submission-form card p-5 space-y-4">
        <ol className="petition-progress" aria-label="陳情填寫進度">
          {["選擇類型", "聯絡資料", "填寫內容", "確認送出"].map((label, index) => (
            <li key={label} data-complete={completedSections[index] || undefined}>
              <span className="petition-progress-dot" aria-hidden="true" />
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <div className="rounded-lg p-4 text-sm" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
          系統會以目前登入帳號送件：{accountName || "未命名使用者"} · {accountEmail || "未提供 email"}。
        </div>
        <label className="block">
          <span className="text-sm font-medium">陳情類型</span>
          <select className="input w-full mt-1" value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <input className="input w-full" placeholder="標題" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        <textarea className="input w-full min-h-52" placeholder="請描述事實、期待處理方式與相關時間地點" value={content} onChange={(e) => setContent(e.target.value)} required />
        <AnimatedFileUpload
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
          multiple
          maxFiles={10}
          label="拖曳陳情附件到這裡"
          hint="可點擊選檔，或貼上圖片；送出陳情時會一併上傳"
          onFiles={setFiles}
          onRemove={(removed) => setFiles((current) => current.filter((file) => file !== removed))}
        />
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
