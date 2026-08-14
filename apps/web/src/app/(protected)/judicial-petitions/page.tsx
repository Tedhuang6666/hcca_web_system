"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, judicialPetitionsApi } from "@/lib/api";
import type {
  JudicialPetitionListItem,
  JudicialPetitionOut,
  JudicialPetitionType,
} from "@/lib/types";

const TYPE_OPTIONS: { value: JudicialPetitionType; label: string }[] = [
  { value: "constitutional_norm_review", label: "法規範違憲審查" },
  { value: "org_dispute", label: "機關爭議" },
  { value: "election_dispute", label: "選舉爭議" },
  { value: "disciplinary_appeal", label: "懲戒申訴" },
  { value: "other", label: "其他評議事項" },
];

const STATUS_LABEL: Record<string, string> = {
  submitted: "已送出",
  docketing_review: "收案審查",
  accepted: "已受理",
  in_review: "審理中",
  decided: "已裁決",
  dismissed: "不受理",
  withdrawn: "撤回",
};

export default function JudicialPetitionsPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [items, setItems] = useState<JudicialPetitionListItem[]>([]);
  const [created, setCreated] = useState<JudicialPetitionOut | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    petitioner_name: "",
    petitioner_email: "",
    representative: "",
    respondent: "",
    petition_type: "constitutional_norm_review" as JudicialPetitionType,
    title: "",
    challenged_norm: "",
    constitutional_provisions: "",
    petition_claim: "",
    facts_and_reasons: "",
    evidence: "",
    attachments_description: "",
  });

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setIsLoggedIn(Boolean(userId));
    setForm((prev) => ({
      ...prev,
      petitioner_name: localStorage.getItem("user_name") ?? "",
      petitioner_email: localStorage.getItem("user_email") ?? "",
    }));
    if (userId) judicialPetitionsApi.my().then(setItems).catch(() => null);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await judicialPetitionsApi.create({
        ...form,
        representative: form.representative || null,
        respondent: form.respondent || null,
        evidence: form.evidence || null,
        attachments_description: form.attachments_description || null,
      });
      setCreated(result);
      if (isLoggedIn) setItems((prev) => [result, ...prev]);
      toast.success("評議聲請已送出");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "送出評議聲請失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          評議委員會訴訟
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          法規範違憲審查欄位採憲法法庭聲請格式：聲請人、相對人、受挑戰法規範、憲法依據、聲請事項、事實及理由、證據。
        </p>
      </div>

      {created && (
        <div className="rounded-lg p-4" style={{ border: "1px solid var(--success-border)", background: "var(--success-dim)" }}>
          <p className="text-sm font-medium">已建立 {created.docket_number}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            目前狀態：{STATUS_LABEL[created.status]}。評議委員會會先進行收案審查。
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <form onSubmit={submit} className="card space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">聲請人</span>
              <input className="input mt-1 w-full" value={form.petitioner_name} onChange={(e) => setForm({ ...form, petitioner_name: e.target.value })} required />
            </label>
            <label className="block">
              <span className="text-sm font-medium">聯絡 email</span>
              <input className="input mt-1 w-full" type="email" value={form.petitioner_email} onChange={(e) => setForm({ ...form, petitioner_email: e.target.value })} required />
            </label>
            <label className="block">
              <span className="text-sm font-medium">代理人 / 代表人</span>
              <input className="input mt-1 w-full" value={form.representative} onChange={(e) => setForm({ ...form, representative: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">相對人 / 關係機關</span>
              <input className="input mt-1 w-full" value={form.respondent} onChange={(e) => setForm({ ...form, respondent: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">聲請類型</span>
            <select className="input mt-1 w-full" value={form.petition_type} onChange={(e) => setForm({ ...form, petition_type: e.target.value as JudicialPetitionType })}>
              {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <input className="input w-full" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="聲請案由" required maxLength={200} />
          <textarea className="input min-h-28 w-full" value={form.challenged_norm} onChange={(e) => setForm({ ...form, challenged_norm: e.target.value })} placeholder="受挑戰之法規範、決議或處分" required />
          <textarea className="input min-h-28 w-full" value={form.constitutional_provisions} onChange={(e) => setForm({ ...form, constitutional_provisions: e.target.value })} placeholder="憲法、章程或上位規範依據" required />
          <textarea className="input min-h-36 w-full" value={form.petition_claim} onChange={(e) => setForm({ ...form, petition_claim: e.target.value })} placeholder="聲請事項" required />
          <textarea className="input min-h-52 w-full" value={form.facts_and_reasons} onChange={(e) => setForm({ ...form, facts_and_reasons: e.target.value })} placeholder="事實及理由" required />
          <textarea className="input min-h-28 w-full" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} placeholder="證據清單（選填）" />
          <textarea className="input min-h-24 w-full" value={form.attachments_description} onChange={(e) => setForm({ ...form, attachments_description: e.target.value })} placeholder="附件說明（選填）" />
          <div className="flex justify-end">
            <button className="btn btn-primary" disabled={submitting}>{submitting ? "送出中..." : "送出評議聲請"}</button>
          </div>
        </form>

        <section className="card p-5">
          <h2 className="text-base font-semibold">我的評議聲請</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            收案、受理與裁決狀態會在此更新。
          </p>
          <div className="mt-4 space-y-2">
            {items.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {isLoggedIn ? "目前沒有送出的評議聲請。" : "登入後可查看自己的聲請紀錄。"}
              </p>
            ) : items.map((item) => (
              <div key={item.id} className="rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {item.docket_number} · {STATUS_LABEL[item.status]} · {TYPE_OPTIONS.find((t) => t.value === item.petition_type)?.label}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
