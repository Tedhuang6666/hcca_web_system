"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, councilProposalsApi, regulationsApi } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import type {
  CouncilProposalCaseType,
  CouncilProposalEligibleMeeting,
  CouncilProposalKind,
  CouncilProposalListItem,
  CouncilProposalOut,
  RegulationListItem,
} from "@/lib/types";

type CaseTypeOption = {
  value: CouncilProposalCaseType;
  label: string;
  hint: string;
  requirement: string;
};

const CASE_TYPE_OPTIONS: CaseTypeOption[] = [
  {
    value: "regulation",
    label: "法規案",
    hint: "自治條例之制定、修正或廢止",
    requirement:
      "議案須於常務委員會集會前 3–7 日送交祕書處編入議程；大會經宣讀、廣泛討論後進行逐條表決與全案表決。",
  },
  {
    value: "finance",
    label: "財政案",
    hint: "預算、決算或結算之審查",
    requirement:
      "決算案應於執行結束後 30 日內編造、並於大會前 8 日提出；結算案應於學期末前編造、次學期首次大會前 8 日提出。由行政祕書處彙整後交常務委員會審議。",
  },
  {
    value: "recall",
    label: "罷免案",
    hint: "對正副主席提出罷免",
    requirement:
      "需經全體議員四分之一（1/4）同意方得提出；議會通過後辦理全校罷免投票，投票通過始撤職。",
  },
  {
    value: "impeachment",
    label: "彈劾案",
    hint: "對失職幹部提出彈劾",
    requirement:
      "議會得決議提出彈劾案，但不具最終裁判權，須聲請評議委員會審理，由評議委員會裁定懲處。",
  },
  {
    value: "personnel",
    label: "人事案",
    hint: "對重要人事任命行使同意權",
    requirement:
      "對評議委員、選罷會委員等任命行使同意權，或由議員互選產生；經議會同意後始得任命。",
  },
  {
    value: "resolution",
    label: "決議 / 建議案",
    hint: "對校務或施政方針提出決議或建議",
    requirement:
      "依一般議案程序提出；大會審議時其他議員可提修正、刪除等動議，經廣泛討論後交付表決。",
  },
];

const KIND_OPTIONS: { value: CouncilProposalKind; label: string; hint: string }[] = [
  { value: "enact", label: "制定案", hint: "新增自治條例、辦法或制度" },
  { value: "amend", label: "修正案", hint: "修改既有法規條文或議決事項" },
  { value: "abolish", label: "廢止案", hint: "廢止不再適用的法規" },
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

const CASE_TYPE_LABEL: Record<CouncilProposalCaseType, string> = Object.fromEntries(
  CASE_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<CouncilProposalCaseType, string>;

export default function CouncilProposalsPage() {
  const { canAny } = usePermissions();
  const isManager = canAny("council_proposal:manage", "meeting:manage");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [items, setItems] = useState<CouncilProposalListItem[]>([]);
  const [regulations, setRegulations] = useState<RegulationListItem[]>([]);
  const [created, setCreated] = useState<CouncilProposalOut | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    contact_name: "",
    contact_email: "",
    proposer_name: "",
    co_sponsors: "",
    case_type: "regulation" as CouncilProposalCaseType,
    kind: "enact" as CouncilProposalKind,
    regulation_id: "",
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
    // 法規案連結用：載入現行有效法規供選擇。
    regulationsApi
      .list({ active_only: "true", limit: "100" })
      .then((list) => setRegulations(list.filter((r) => !r.is_repealed)))
      .catch(() => null);
  }, []);

  const activeCaseType = useMemo(
    () => CASE_TYPE_OPTIONS.find((o) => o.value === form.case_type)!,
    [form.case_type],
  );
  const isRegulation = form.case_type === "regulation";
  const needsRegulationLink = isRegulation && (form.kind === "amend" || form.kind === "abolish");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (needsRegulationLink && !form.regulation_id) {
      toast.error("修正案與廢止案需連結既有法規");
      return;
    }
    setSubmitting(true);
    try {
      const result = await councilProposalsApi.create({
        contact_name: form.contact_name || null,
        contact_email: form.contact_email,
        proposer_name: form.proposer_name,
        co_sponsors: form.co_sponsors || null,
        case_type: form.case_type,
        kind: isRegulation ? form.kind : null,
        regulation_id: needsRegulationLink ? form.regulation_id : null,
        title: form.title,
        summary: form.summary,
        legal_basis: form.legal_basis || null,
        proposal_text: form.proposal_text,
        rationale: form.rationale,
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
            <span className="text-sm font-medium">案件類型</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CASE_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="rounded-lg p-3 text-left"
                  onClick={() => setForm({ ...form, case_type: option.value })}
                  style={{
                    border: `1px solid ${form.case_type === option.value ? "var(--primary)" : "var(--border)"}`,
                    background: form.case_type === option.value ? "var(--primary-dim)" : "transparent",
                  }}>
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{option.hint}</p>
                </button>
              ))}
            </div>
            <p
              className="mt-2 rounded-lg p-3 text-xs"
              style={{ background: "var(--surface-muted, var(--primary-dim))", color: "var(--text-muted)" }}>
              <span className="font-medium" style={{ color: "var(--text-primary)" }}>提案要件：</span>
              {activeCaseType.requirement}
            </p>
          </div>

          {isRegulation && (
            <div className="space-y-3 rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
              <div>
                <span className="text-sm font-medium">法規案子類型</span>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {KIND_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="rounded-lg p-3 text-left"
                      onClick={() => setForm({ ...form, kind: option.value, regulation_id: option.value === "enact" ? "" : form.regulation_id })}
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
              {needsRegulationLink && (
                <label className="block">
                  <span className="text-sm font-medium">連結法規</span>
                  <select
                    className="input mt-1 w-full"
                    value={form.regulation_id}
                    onChange={(e) => setForm({ ...form, regulation_id: e.target.value })}
                    required>
                    <option value="">— 請選擇要{form.kind === "abolish" ? "廢止" : "修正"}的法規 —</option>
                    {regulations.map((r) => (
                      <option key={r.id} value={r.id}>{r.title}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>
                    {regulations.length === 0
                      ? "目前沒有可連結的現行法規。"
                      : "送出後此提案會綁定上述法規，於議會核定後可直接帶入修法流程。"}
                  </span>
                </label>
              )}
            </div>
          )}

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
                  {item.serial_number} · {STATUS_LABEL[item.status]} · {CASE_TYPE_LABEL[item.case_type]}
                  {item.kind ? ` / ${KIND_OPTIONS.find((k) => k.value === item.kind)?.label}` : ""}
                </p>
                {item.regulation_title && (
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    連結法規：{item.regulation_title}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {isManager && <CommitteeSchedulingPanel caseTypeLabel={CASE_TYPE_LABEL} statusLabel={STATUS_LABEL} />}
    </div>
  );
}

/**
 * 常務委員會審查面板：列出尚待排程的提案，審查通過後可直接排入大會議程。
 * 僅 council_proposal:manage / meeting:manage 角色可見。
 */
function CommitteeSchedulingPanel({
  caseTypeLabel,
  statusLabel,
}: {
  caseTypeLabel: Record<CouncilProposalCaseType, string>;
  statusLabel: Record<string, string>;
}) {
  const [items, setItems] = useState<CouncilProposalListItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<CouncilProposalEligibleMeeting[]>([]);
  const [meetingId, setMeetingId] = useState("");
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [busy, setBusy] = useState(false);

  function reload() {
    councilProposalsApi.list().then(setItems).catch(() => null);
  }
  useEffect(() => {
    reload();
  }, []);

  // 尚待排入議程的提案（已送出 / 常委審查中）
  const pending = items.filter((i) => i.status === "submitted" || i.status === "committee_review");

  async function openScheduler(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setMeetingId("");
    setMeetings([]);
    setLoadingMeetings(true);
    try {
      setMeetings(await councilProposalsApi.eligibleMeetings(id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "讀取會議清單失敗");
    } finally {
      setLoadingMeetings(false);
    }
  }

  async function confirmSchedule(id: string) {
    if (!meetingId) {
      toast.error("請先選擇要排入的會議");
      return;
    }
    setBusy(true);
    try {
      await councilProposalsApi.schedule(id, { meeting_id: meetingId });
      toast.success("已排入大會議程");
      setOpenId(null);
      reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "排入議程失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold">常務委員會審查 · 排入大會議程</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
        審查通過的提案可直接帶入指定會議的議程（議程仍可編輯的會議才會出現於清單，大會優先）。
      </p>
      <div className="mt-4 space-y-2">
        {pending.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>目前沒有待排程的提案。</p>
        ) : pending.map((item) => (
          <div key={item.id} className="rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {item.serial_number} · {statusLabel[item.status]} · {caseTypeLabel[item.case_type]}
                </p>
              </div>
              <button type="button" className="btn btn-secondary shrink-0" onClick={() => openScheduler(item.id)}>
                {openId === item.id ? "收合" : "排入議程"}
              </button>
            </div>
            {openId === item.id && (
              <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                {loadingMeetings ? (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>讀取會議中…</p>
                ) : meetings.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    沒有可排入的會議；請先於議事系統建立一場議程尚可編輯的會議。
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="input" value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
                      <option value="">— 選擇會議 —</option>
                      {meetings.map((m) => (
                        <option key={m.id} value={m.id} disabled={m.already_scheduled}>
                          {m.bill_stage === "council" ? "［大會］" : m.bill_stage === "standing_committee" ? "［常委會］" : ""}
                          {m.title}{m.already_scheduled ? "（已排入）" : ""}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => confirmSchedule(item.id)}>
                      {busy ? "排入中…" : "確認排入"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
