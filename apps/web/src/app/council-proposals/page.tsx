"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, councilProposalsApi } from "@/lib/api";
import type {
  CouncilProposalKind,
  CouncilProposalListItem,
  CouncilProposalOut,
} from "@/lib/types";

const KIND_OPTIONS: { value: CouncilProposalKind; label: string; hint: string }[] = [
  { value: "enact", label: "制定案", hint: "新增自治規章、辦法或制度" },
  { value: "amend", label: "修正案", hint: "修改既有規範、制度或議決事項" },
  { value: "abolish", label: "廢止案", hint: "廢止不再適用的規範或制度" },
];

const STATUS_LABEL: Record<string, string> = {
  submitted: "已送出",
  committee_review: "常委審查",
  scheduled: "已排入議程",
  council_review: "議會審議",
  passed: "通過",
  rejected: "退回",
  withdrawn: "撤回",
};

export default function CouncilProposalsPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [items, setItems] = useState<CouncilProposalListItem[]>([]);
  const [created, setCreated] = useState<CouncilProposalOut | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    contact_name: "",
    contact_email: "",
    proposer_name: "",
    co_sponsors: "",
    kind: "enact" as CouncilProposalKind,
    title: "",
    summary: "",
    legal_basis: "",
    proposal_text: "",
    rationale: "",
    expected_effect: "",
  });

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    setIsLoggedIn(Boolean(userId));
    setForm((prev) => ({
      ...prev,
      contact_name: localStorage.getItem("user_name") ?? "",
      contact_email: localStorage.getItem("user_email") ?? "",
      proposer_name: localStorage.getItem("user_name") ?? "",
    }));
    if (userId) councilProposalsApi.my().then(setItems).catch(() => null);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await councilProposalsApi.create({
        ...form,
        contact_name: form.contact_name || null,
        co_sponsors: form.co_sponsors || null,
        legal_basis: form.legal_basis || null,
        expected_effect: form.expected_effect || null,
      });
      setCreated(result);
      if (isLoggedIn) setItems((prev) => [result, ...prev]);
      toast.success("議會提案已送出");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "送出議會提案失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          議會提案
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          送出的提案會先進入常務委員會審查；常委通過後，才會排入議會議程。
        </p>
      </div>

      {created && (
        <div className="rounded-lg p-4" style={{ border: "1px solid var(--success-border)", background: "var(--success-dim)" }}>
          <p className="text-sm font-medium">已建立 {created.serial_number}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            目前狀態：{STATUS_LABEL[created.status]}。常委會審查後會更新是否排入議程。
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <form onSubmit={submit} className="card space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">提案人</span>
              <input className="input mt-1 w-full" value={form.proposer_name} onChange={(e) => setForm({ ...form, proposer_name: e.target.value })} required />
            </label>
            <label className="block">
              <span className="text-sm font-medium">聯絡 email</span>
              <input className="input mt-1 w-full" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} required />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">連署 / 附議人</span>
            <textarea className="input mt-1 min-h-20 w-full" value={form.co_sponsors} onChange={(e) => setForm({ ...form, co_sponsors: e.target.value })} placeholder="可列姓名、班級、職稱或其他識別資訊" />
          </label>
          <div>
            <span className="text-sm font-medium">議案種類</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {KIND_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="rounded-lg p-3 text-left"
                  onClick={() => setForm({ ...form, kind: option.value })}
                  style={{
                    border: `1px solid ${form.kind === option.value ? "var(--primary)" : "var(--border)"}`,
                    background: form.kind === option.value ? "var(--primary-dim)" : "transparent",
                  }}>
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{option.hint}</p>
                </button>
              ))}
            </div>
          </div>
          <input className="input w-full" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="案由 / 提案標題" required maxLength={200} />
          <textarea className="input min-h-24 w-full" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="提案摘要" required />
          <textarea className="input min-h-20 w-full" value={form.legal_basis} onChange={(e) => setForm({ ...form, legal_basis: e.target.value })} placeholder="法源依據或相關現行規定（選填）" />
          <textarea className="input min-h-44 w-full" value={form.proposal_text} onChange={(e) => setForm({ ...form, proposal_text: e.target.value })} placeholder="提案本文 / 條文 / 決議文字" required />
          <textarea className="input min-h-36 w-full" value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} placeholder="提案理由" required />
          <textarea className="input min-h-24 w-full" value={form.expected_effect} onChange={(e) => setForm({ ...form, expected_effect: e.target.value })} placeholder="預期效益或影響（選填）" />
          <div className="flex justify-end">
            <button className="btn btn-primary" disabled={submitting}>{submitting ? "送出中..." : "送出議會提案"}</button>
          </div>
        </form>

        <section className="card p-5">
          <h2 className="text-base font-semibold">我的議會提案</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            常委通過後會顯示為已排入議程。
          </p>
          <div className="mt-4 space-y-2">
            {items.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {isLoggedIn ? "目前沒有送出的議會提案。" : "登入後可查看自己的提案紀錄。"}
              </p>
            ) : items.map((item) => (
              <div key={item.id} className="rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {item.serial_number} · {STATUS_LABEL[item.status]} · {KIND_OPTIONS.find((k) => k.value === item.kind)?.label}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
