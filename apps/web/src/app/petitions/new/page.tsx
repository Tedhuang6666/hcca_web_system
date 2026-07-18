"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, petitionsApi } from "@/lib/api";
import type { PetitionCreatedOut, PetitionTypeOut } from "@/lib/types";

export default function NewPetitionPage() {
  const [types, setTypes] = useState<PetitionTypeOut[]>([]);
  const [typeId, setTypeId] = useState("");
  const [isNamed, setIsNamed] = useState(true);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<PetitionCreatedOut | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    setIsLoggedIn(Boolean(localStorage.getItem("user_id")));
    setAccountName(localStorage.getItem("user_name") ?? "");
    setAccountEmail(localStorage.getItem("user_email") ?? "");
    petitionsApi.listTypes()
      .then((items) => {
        setTypes(items);
        if (items[0]) setTypeId(items[0].id);
      })
      .catch(() => toast.error("無法載入陳情類型"));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await petitionsApi.create({
        type_id: typeId,
        is_named: isNamed,
        contact_name: isLoggedIn ? null : contactName || null,
        contact_email: isLoggedIn ? null : contactEmail || null,
        title,
        content,
      });
      if (files) {
        for (const file of Array.from(files)) {
          await petitionsApi.uploadAttachment(result.id, file, { verification_code: result.verification_code });
        }
      }
      setCreated(result);
      toast.success("陳情案件已送出");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "送件失敗");
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    // fragment 不會送至伺服器或寫入 access log；頁面再以 POST body 送 token 查詢。
    const shareHref = `/petitions/share#${created.share_token}`;
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="card p-6 space-y-4">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>案件已送出</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            請妥善保存案號與驗證碼。驗證碼只會在此畫面顯示一次。
            {isLoggedIn ? " 您也可以直接在我的案件中查看。" : " 未登入案件無法直接查看及管理，回復速度也可能較慢。"}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg p-4" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>案號</p>
              <p className="text-2xl font-semibold tracking-widest" style={{ color: "var(--text-primary)" }}>{created.case_number}</p>
            </div>
            <div className="rounded-lg p-4" style={{ background: "var(--warning-dim)", border: "1px solid var(--warning-border)" }}>
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
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>我要陳情</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>選擇具名或匿名後送出，系統會依類型自動分派給負責機關。</p>
      </div>
      <form onSubmit={submit} className="card p-5 space-y-4">
        {!isLoggedIn && (
          <div className="rounded-lg p-4 text-sm" style={{ background: "var(--warning-dim)", border: "1px solid var(--warning-border)", color: "var(--text-primary)" }}>
            您目前未登入。未登入送件後無法直接查看及管理案件，必須保存案號與驗證碼才能查詢；因承辦單位較難確認聯絡身分，回復速度較慢。
          </div>
        )}
        {isLoggedIn && (
          <div className="rounded-lg p-4 text-sm" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            系統會自動使用登入紀錄送件：{accountName || "未命名使用者"} · {accountEmail || "未提供 email"}。姓名與 mail 不需手動填寫。
          </div>
        )}
        <label className="block">
          <span className="text-sm font-medium">陳情類型</span>
          <select className="input w-full mt-1" value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label="陳情身分選擇">
          <button
            type="button"
            onClick={() => setIsNamed(true)}
            aria-pressed={isNamed}
            className="rounded-lg p-4 text-left transition-all"
            style={{
              border: `1px solid ${isNamed ? "var(--primary)" : "var(--border)"}`,
              background: isNamed ? "var(--primary-dim)" : "transparent",
            }}>
            <p className="font-medium" style={{ color: "var(--text-primary)" }}>具名陳情</p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>承辦單位可看到您的姓名與聯絡方式，方便確認細節與加速回覆。</p>
          </button>
          <button
            type="button"
            onClick={() => setIsNamed(false)}
            aria-pressed={!isNamed}
            className="rounded-lg p-4 text-left transition-all"
            style={{
              border: `1px solid ${!isNamed ? "var(--primary)" : "var(--border)"}`,
              background: !isNamed ? "var(--primary-dim)" : "transparent",
            }}>
            <p className="font-medium" style={{ color: "var(--text-primary)" }}>匿名陳情</p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>承辦與管理頁不顯示您的身分資料。</p>
          </button>
        </div>
        {!isNamed && (
          <div className="rounded-lg p-4 text-sm" style={{ background: "var(--success-dim)", border: "1px solid var(--success-border)", color: "var(--text-primary)" }}>
            您的資料僅供紀錄用，不會顯示給任何管理員或承辦單位。
          </div>
        )}
        {!isLoggedIn ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <input className="input" placeholder="聯絡姓名" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            <input className="input" placeholder="聯絡 email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
          </div>
        ) : null}
        <input className="input w-full" placeholder="標題" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        <textarea className="input w-full min-h-52" placeholder="請描述事實、期待處理方式與相關時間地點" value={content} onChange={(e) => setContent(e.target.value)} required />
        <label className="block">
          <span className="text-sm font-medium">附件</span>
          <input className="input w-full mt-1" type="file" multiple onChange={(e) => setFiles(e.target.files)} />
        </label>
        <div className="flex justify-end gap-2">
          <Link className="btn btn-ghost" href="/petitions">取消</Link>
          <button className="btn btn-primary" disabled={submitting || !typeId}>{submitting ? "送出中..." : "送出陳情"}</button>
        </div>
      </form>
    </div>
  );
}
