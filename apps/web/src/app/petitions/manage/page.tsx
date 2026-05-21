"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, orgsApi, petitionsApi } from "@/lib/api";
import type { PetitionCaseListItem, PetitionCaseOut, PetitionStatsOut, PetitionStatus } from "@/lib/types";
import { PetitionStatusBadge } from "@/components/ui/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";

type QueueKey = "all" | "pending" | "mine" | "active" | "needs_info" | "done";
type ActionKey = "assign" | "handle" | "transfer" | "reject_close" | "attachments";

const STATUS_OPTIONS: { value: PetitionStatus; label: string }[] = [
  { value: "submitted", label: "已收件" },
  { value: "assigned", label: "已分案" },
  { value: "in_progress", label: "承辦中" },
  { value: "needs_info", label: "等待補件" },
  { value: "transferred", label: "已轉派" },
  { value: "resolved", label: "已回覆" },
  { value: "closed", label: "已結案" },
  { value: "rejected", label: "不受理" },
];

const FLOW: PetitionStatus[] = ["submitted", "assigned", "in_progress", "needs_info", "resolved", "closed"];

function fmt(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function queueStatus(queue: QueueKey): PetitionStatus | undefined {
  if (queue === "pending") return "submitted";
  if (queue === "active") return "in_progress";
  if (queue === "needs_info") return "needs_info";
  if (queue === "done") return "resolved";
  return undefined;
}

export default function PetitionManagePage() {
  const [items, setItems] = useState<PetitionCaseListItem[]>([]);
  const [selected, setSelected] = useState<PetitionCaseOut | null>(null);
  const [stats, setStats] = useState<PetitionStatsOut | null>(null);
  const [queue, setQueue] = useState<QueueKey>("all");
  const [status, setStatus] = useState<PetitionStatus | "">("");
  const [keyword, setKeyword] = useState("");
  const [users, setUsers] = useState<{ id: string; display_name: string; email: string }[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [activeAction, setActiveAction] = useState<ActionKey>("assign");
  const [assignee, setAssignee] = useState("");
  const [targetOrg, setTargetOrg] = useState("");
  const [publicText, setPublicText] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const { can } = usePermissions();

  const effectiveStatus = status || queueStatus(queue);
  const assignedToMe = queue === "mine";

  const load = useCallback(async () => {
    const [list, s] = await Promise.all([
      petitionsApi.manage({
        status: effectiveStatus,
        keyword: keyword || undefined,
        assigned_to_me: assignedToMe || undefined,
      }),
      petitionsApi.stats().catch(() => null),
    ]);
    setItems(list);
    if (s) setStats(s);
  }, [assignedToMe, effectiveStatus, keyword]);

  useEffect(() => { load().catch(() => toast.error("載入陳情工作台失敗")); }, [load]);
  useEffect(() => { orgsApi.list({ active_only: true }).then(setOrgs).catch(() => null); }, []);

  const resetForm = () => {
    setPublicText("");
    setInternalNote("");
    setTargetOrg("");
    setFile(null);
  };

  const open = async (id: string) => {
    try {
      const detail = await petitionsApi.get(id);
      setSelected(detail);
      resetForm();
      const assignable = await petitionsApi.assignableUsers(id).catch(() => []);
      setUsers(assignable);
      setAssignee(detail.assigned_to_id || assignable[0]?.id || "");
      if (detail.status === "submitted" || !detail.assigned_to_id) setActiveAction("assign");
      else if (detail.status === "resolved" || detail.status === "closed") setActiveAction("reject_close");
      else setActiveAction("handle");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "載入案件失敗");
    }
  };

  const refreshSelected = async (updated: PetitionCaseOut) => {
    if (file) {
      await petitionsApi.uploadAttachment(updated.id, file, { visibility: "internal" });
    }
    setSelected(await petitionsApi.get(updated.id));
    await load();
    resetForm();
  };

  const run = async (action: string) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      let updated: PetitionCaseOut;
      if (action === "assign") {
        updated = await petitionsApi.assign(selected.id, {
          assigned_to_id: assignee,
          internal_note: internalNote || null,
        });
      } else if (action === "progress") {
        updated = await petitionsApi.updateStatus(selected.id, {
          status: "in_progress",
          public_message: publicText || "案件已進入承辦處理。",
          internal_note: internalNote || null,
        });
      } else if (action === "needs_info") {
        updated = await petitionsApi.updateStatus(selected.id, {
          status: "needs_info",
          public_message: publicText,
          internal_note: internalNote || null,
        });
      } else if (action === "reply") {
        updated = await petitionsApi.reply(selected.id, {
          public_content: publicText,
          internal_note: internalNote || null,
          resolve: true,
        });
      } else if (action === "transfer") {
        updated = await petitionsApi.transfer(selected.id, {
          to_org_id: targetOrg,
          reason: publicText,
        });
      } else if (action === "reject") {
        updated = await petitionsApi.updateStatus(selected.id, {
          status: "rejected",
          public_message: publicText,
          internal_note: internalNote || null,
        });
      } else if (action === "close") {
        updated = await petitionsApi.updateStatus(selected.id, {
          status: "closed",
          public_message: publicText || "案件已結案。",
          internal_note: internalNote || null,
        });
      } else {
        updated = await petitionsApi.addNote(selected.id, internalNote || publicText);
      }
      await refreshSelected(updated);
      toast.success("案件已更新");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "操作失敗");
    } finally {
      setBusy(false);
    }
  };

  const queueCards = useMemo(
    () => [
      { key: "all" as const, label: "全部", value: stats?.total ?? items.length },
      { key: "pending" as const, label: "待分案", value: stats?.pending_assignment ?? 0 },
      { key: "mine" as const, label: "我承辦", value: stats?.my_assigned ?? 0 },
      { key: "active" as const, label: "處理中", value: stats?.in_progress ?? 0 },
      { key: "needs_info" as const, label: "補件中", value: stats?.needs_info ?? 0 },
      { key: "done" as const, label: "已回覆", value: stats?.resolved ?? 0 },
    ],
    [items.length, stats],
  );

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>陳情工作台</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            依序完成收件、分派、承辦、補件、跨機關轉派、駁回與結案
          </p>
        </div>
        {can("petition:type_manage") && (
          <Link href="/petitions/admin/types" className="btn btn-ghost">陳情類型</Link>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {queueCards.map((card) => (
          <button
            key={card.key}
            onClick={() => { setQueue(card.key); setStatus(""); }}
            className="card card-hover p-4 text-left"
            style={{
              borderColor: queue === card.key ? "var(--primary)" : "var(--border)",
              background: queue === card.key ? "var(--primary-dim)" : "var(--card-bg)",
            }}>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{card.label}</p>
            <p className="text-2xl font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{card.value}</p>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[0.9fr_1.25fr] gap-5">
        <section className="card p-5 space-y-4">
          <div className="grid sm:grid-cols-[1fr_auto] gap-2">
            <input
              className="input w-full"
              placeholder="搜尋案號或標題"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button className="btn btn-ghost" onClick={() => load()}>搜尋</button>
          </div>
          <select
            className="input w-full"
            value={status}
            onChange={(e) => { setStatus(e.target.value as PetitionStatus | ""); setQueue("all"); }}>
            <option value="">依佇列篩選</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <div className="space-y-2 max-h-[72vh] overflow-auto">
            {items.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>目前沒有符合條件的案件。</p>
            ) : items.map((item) => (
              <button
                key={item.id}
                onClick={() => open(item.id)}
                className="w-full text-left rounded-lg p-3"
                style={{
                  border: "1px solid var(--border)",
                  background: selected?.id === item.id ? "var(--primary-dim)" : "transparent",
                }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate" style={{ color: "var(--text-primary)" }}>{item.title}</p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      #{item.case_number} · {item.current_org_name} · {item.assigned_to_name || "未分案"}
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-disabled)" }}>{fmt(item.updated_at)} · {item.next_action}</p>
                  </div>
                  <PetitionStatusBadge status={item.status} />
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="card p-5 space-y-5">
          {!selected ? (
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>
              請從左側選擇案件。建議先處理「待分案」與「我承辦」，再看跨機關轉派或補件中的案件。
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>#{selected.case_number} · {selected.type_name}</p>
                  <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{selected.title}</h2>
                  <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                    {selected.current_org_name} · {selected.assigned_to_name || "尚未分派承辦人"} · 更新 {fmt(selected.updated_at)}
                  </p>
                </div>
                <PetitionStatusBadge status={selected.status} />
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {FLOW.map((step, index) => {
                  const currentIndex = FLOW.indexOf(selected.status);
                  const active = selected.status === step;
                  const done = currentIndex > index;
                  return (
                    <div key={step} className="rounded-lg px-2 py-2 text-center text-xs" style={{
                      background: active ? "var(--primary-dim)" : done ? "var(--success-dim)" : "var(--bg-hover)",
                      border: `1px solid ${active ? "var(--primary)" : done ? "var(--success-border)" : "var(--border)"}`,
                      color: "var(--text-primary)",
                    }}>
                      {STATUS_OPTIONS.find((s) => s.value === step)?.label}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg p-4 space-y-2" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                <p className="text-sm font-medium">案件內容</p>
                <p className="whitespace-pre-wrap text-sm leading-7" style={{ color: "var(--text-muted)" }}>{selected.content}</p>
              </div>

              {selected.submitter ? (
                <div className="rounded-lg p-3 text-sm" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                  提交者：{selected.submitter.display_name || selected.submitter.contact_name || "未提供"} · {selected.submitter.email || selected.submitter.contact_email || "無聯絡資訊"}
                </div>
              ) : (
                <div className="rounded-lg p-3 text-sm" style={{ background: "var(--primary-dim)", border: "1px solid var(--info-border)", color: "var(--text-muted)" }}>
                  此案為匿名陳情，提交者資料不顯示給管理員或承辦單位。
                </div>
              )}

              <div className="flex flex-wrap gap-2" role="tablist" aria-label="案件處理動作">
                {[
                  ["assign", "分派承辦"],
                  ["handle", "處理/回覆"],
                  ["transfer", "跨機關轉派"],
                  ["reject_close", "駁回/結案"],
                  ["attachments", "附件/備註"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={activeAction === key ? "btn btn-primary" : "btn btn-ghost"}
                    onClick={() => setActiveAction(key as ActionKey)}>
                    {label}
                  </button>
                ))}
              </div>

              {activeAction === "assign" && (
                <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
                  <div>
                    <h3 className="font-medium">分派給機關內部承辦人</h3>
                    <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>只會列出目前負責機關內有效任期的成員。</p>
                  </div>
                  <select className="input w-full" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    {users.length === 0 && <option value="">無可分派成員</option>}
                    {users.map((u) => <option key={u.id} value={u.id}>{u.display_name} · {u.email}</option>)}
                  </select>
                  <textarea className="input w-full min-h-20" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="分派備註（內部可見，選填）" />
                  <button className="btn btn-primary" disabled={!assignee || busy} onClick={() => run("assign")}>確認分派</button>
                </div>
              )}

              {activeAction === "handle" && (
                <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
                  <div>
                    <h3 className="font-medium">處理、要求補件或正式回覆</h3>
                    <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>公開內容會顯示給陳情人；內部備註只給幹部看。</p>
                  </div>
                  <textarea className="input w-full min-h-32" value={publicText} onChange={(e) => setPublicText(e.target.value)} placeholder="公開說明、補件原因或正式回覆" />
                  <textarea className="input w-full min-h-20" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="內部備註（選填）" />
                  <input className="input w-full" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-ghost" disabled={busy} onClick={() => run("progress")}>標記處理中</button>
                    <button className="btn btn-ghost" disabled={!publicText.trim() || busy} onClick={() => run("needs_info")}>退回補件</button>
                    <button className="btn btn-primary" disabled={!publicText.trim() || busy} onClick={() => run("reply")}>正式回覆並完成</button>
                  </div>
                </div>
              )}

              {activeAction === "transfer" && (
                <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
                  <div>
                    <h3 className="font-medium">跨機關分案 / 轉派</h3>
                    <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>轉派後案件會移到目標機關工作台，原承辦人會被清空，目標機關可重新分派。</p>
                  </div>
                  <select className="input w-full" value={targetOrg} onChange={(e) => setTargetOrg(e.target.value)}>
                    <option value="">選擇目標機關</option>
                    {orgs.filter((o) => o.id !== selected.current_org_id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <textarea className="input w-full min-h-28" value={publicText} onChange={(e) => setPublicText(e.target.value)} placeholder="轉派理由（會寫入公開處理事件）" />
                  <button className="btn btn-primary" disabled={!targetOrg || !publicText.trim() || busy} onClick={() => run("transfer")}>確認跨機關轉派</button>
                </div>
              )}

              {activeAction === "reject_close" && (
                <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
                  <div>
                    <h3 className="font-medium">駁回、不受理或結案</h3>
                    <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>駁回/不受理必須填公開原因；結案可填結案說明。</p>
                  </div>
                  <textarea className="input w-full min-h-28" value={publicText} onChange={(e) => setPublicText(e.target.value)} placeholder="公開原因或結案說明" />
                  <textarea className="input w-full min-h-20" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="內部備註（選填）" />
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-ghost" disabled={!publicText.trim() || busy} onClick={() => run("reject")}>駁回 / 不受理</button>
                    <button className="btn btn-primary" disabled={busy} onClick={() => run("close")}>結案</button>
                  </div>
                </div>
              )}

              {activeAction === "attachments" && (
                <div className="rounded-lg p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
                  <h3 className="font-medium">附件與內部備註</h3>
                  <input className="input w-full" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <textarea className="input w-full min-h-24" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="新增內部備註" />
                  <button className="btn btn-primary" disabled={(!file && !internalNote.trim()) || busy} onClick={() => run("note")}>儲存附件/備註</button>
                  <div className="space-y-2">
                    {selected.attachments.length === 0 ? (
                      <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無附件。</p>
                    ) : selected.attachments.map((att) => (
                      <a key={att.id} className="block rounded-lg p-3 text-sm" style={{ border: "1px solid var(--border)", textDecoration: "none" }} href={petitionsApi.attachmentDownloadUrl(selected.id, att.id)} target="_blank">
                        {att.display_name || att.filename} · {att.visibility === "internal" ? "內部" : "公開"}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                <h3 className="font-medium">處理事件</h3>
                {selected.events.map((event) => (
                  <div key={event.id} className="text-sm pl-3 py-1" style={{ borderLeft: "2px solid var(--border)" }}>
                    <p className="font-medium">{event.title}</p>
                    {event.content && <p className="whitespace-pre-wrap mt-1" style={{ color: "var(--text-muted)" }}>{event.content}</p>}
                    <p className="text-xs mt-1" style={{ color: "var(--text-disabled)" }}>{fmt(event.created_at)} · {event.visibility === "internal" ? "內部" : "公開"}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {stats?.by_org?.length ? (
        <section className="card p-5 space-y-3 overflow-x-auto">
          <h2 className="font-semibold">各機關處理統計</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>機關</th><th>總數</th><th>完成</th><th>處理中</th><th>補件</th><th>駁回</th><th>平均首回覆</th><th>平均結案</th>
              </tr>
            </thead>
            <tbody>
              {stats.by_org.map((org) => (
                <tr key={org.org_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-2">{org.org_name}</td>
                  <td>{org.total}</td>
                  <td>{org.completed}</td>
                  <td>{org.in_progress}</td>
                  <td>{org.needs_info}</td>
                  <td>{org.rejected}</td>
                  <td>{org.average_first_response_hours?.toFixed(1) ?? "-"} 小時</td>
                  <td>{org.average_completion_hours?.toFixed(1) ?? "-"} 小時</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
