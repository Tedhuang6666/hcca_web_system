"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  FileText,
  Inbox,
  Lock,
  Plus,
  RefreshCcw,
  Save,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  ApiError,
  policiesApi,
  type PolicyDocumentListItem,
  type PolicyDocumentOut,
  type PolicyKind,
  type PrivacyRequestOut,
  type PrivacyRequestStatus,
} from "@/lib/api";

const KIND_LABEL: Record<PolicyKind, string> = {
  privacy: "隱私權政策",
  terms: "服務條款",
  cookie: "Cookie 政策",
  accessibility: "無障礙聲明",
  security: "資安政策",
};

const STATUS_LABEL: Record<PrivacyRequestStatus, string> = {
  received: "已收件",
  in_review: "處理中",
  fulfilled: "已完成",
  rejected: "已拒絕",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<PrivacyRequestStatus, string> = {
  received: "var(--warning)",
  in_review: "var(--primary)",
  fulfilled: "var(--success)",
  rejected: "var(--danger)",
  cancelled: "var(--text-muted)",
};

type Tab = "documents" | "privacy_requests";

export default function PoliciesPage() {
  const { isAdmin } = usePermissions();
  const [tab, setTab] = useState<Tab>("documents");

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section
          className="rounded-lg border p-8 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            需要超級管理員權限
          </h1>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-4">
        <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
          <ScrollText size={14} aria-hidden />
          政策版本管理
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">政策與個資請求</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          管理隱私權 / ToS / Cookie 等政策版本（新增 → 啟用 → 舊版自動 deactivate），
          以及處理當事人個資權利請求（GDPR / 個資法）。
        </p>
      </header>

      <nav className="mb-4 flex gap-1 border-b border-[var(--border)]">
        <TabButton active={tab === "documents"} onClick={() => setTab("documents")}>
          <FileText size={14} aria-hidden /> 政策版本
        </TabButton>
        <TabButton
          active={tab === "privacy_requests"}
          onClick={() => setTab("privacy_requests")}>
          <Inbox size={14} aria-hidden /> 個資權利請求
        </TabButton>
      </nav>

      {tab === "documents" ? <DocumentsTab /> : <PrivacyRequestsTab />}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-3 py-2 text-sm transition ${
        active ? "border-b-2" : "opacity-60 hover:opacity-100"
      }`}
      style={{
        color: active ? "var(--primary)" : "var(--text-secondary)",
        borderBottomColor: active ? "var(--primary)" : "transparent",
      }}>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// 政策版本 Tab
// ─────────────────────────────────────────────────────────────────

function DocumentsTab() {
  const [filter, setFilter] = useState<PolicyKind | "">("");
  const [items, setItems] = useState<PolicyDocumentListItem[]>([]);
  const [selected, setSelected] = useState<PolicyDocumentOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await policiesApi.list(filter || undefined);
      setItems(rows);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "讀取失敗");
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (item: PolicyDocumentListItem) => {
    try {
      const d = await policiesApi.detail(item.kind, item.version);
      setSelected(d);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "讀取詳情失敗");
    }
  };

  const activate = async (item: PolicyDocumentListItem) => {
    if (
      !window.confirm(
        `啟用「${KIND_LABEL[item.kind]} v${item.version}」？\n同類別其他版本會自動失效。`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await policiesApi.activate(item.id);
      toast.success("已啟用此版本");
      await load();
      if (selected?.id === item.id) await openDetail(item);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "啟用失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[20rem_1fr]">
      <aside className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as PolicyKind | "")}
            className="input flex-1">
            <option value="">全部類型</option>
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost" onClick={load}>
            <RefreshCcw size={14} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={() => setShowCreate(true)}>
          <Plus size={14} aria-hidden />
          新增政策版本
        </button>
        <div className="space-y-1">
          {items.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">無資料。</p>
          ) : (
            items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => openDetail(it)}
                className="w-full rounded-lg border p-2 text-left text-xs transition"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: selected?.id === it.id ? "var(--primary)" : "var(--border)",
                }}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {KIND_LABEL[it.kind]}
                  </span>
                  {it.is_active && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-[var(--success-dim)] px-1 py-0.5 text-[10px] text-[var(--success)]">
                      <CheckCircle size={10} aria-hidden />
                      生效
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[var(--text-muted)]">
                  v{it.version} · {new Date(it.effective_at).toLocaleDateString()}
                </div>
                <div className="mt-0.5 truncate text-[var(--text-secondary)]">{it.title}</div>
              </button>
            ))
          )}
        </div>
      </aside>

      <section
        className="rounded-lg border bg-[var(--bg-surface)] p-4"
        style={{ borderColor: "var(--border)" }}>
        {!selected ? (
          <p className="text-sm text-[var(--text-muted)]">
            從左側挑一個版本查看 / 編輯，或新增。
          </p>
        ) : (
          <DocumentEditor
            doc={selected}
            onSaved={async () => {
              await openDetail(selected);
              await load();
            }}
            onActivate={() => activate(selected)}
            busy={busy}
          />
        )}
      </section>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={load} />
      )}
    </div>
  );
}

function DocumentEditor({
  doc,
  onSaved,
  onActivate,
  busy,
}: {
  doc: PolicyDocumentOut;
  onSaved: () => Promise<void>;
  onActivate: () => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content_md);
  const [summary, setSummary] = useState(doc.summary_md ?? "");
  const [effectiveAt, setEffectiveAt] = useState(
    doc.effective_at.slice(0, 16),
  );
  const [requiresConsent, setRequiresConsent] = useState(doc.requires_explicit_consent);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(doc.title);
    setContent(doc.content_md);
    setSummary(doc.summary_md ?? "");
    setEffectiveAt(doc.effective_at.slice(0, 16));
    setRequiresConsent(doc.requires_explicit_consent);
  }, [doc]);

  const onSave = async () => {
    if (doc.is_active) {
      toast.error("已生效版本不可編輯，請新增新版本");
      return;
    }
    setSaving(true);
    try {
      await policiesApi.update(doc.id, {
        title,
        content_md: content,
        summary_md: summary || null,
        effective_at: new Date(effectiveAt).toISOString(),
        requires_explicit_consent: requiresConsent,
      });
      toast.success("已儲存");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-[var(--text-secondary)]">
            {KIND_LABEL[doc.kind]} · v{doc.version}
          </div>
          {doc.is_active ? (
            <div className="mt-1 inline-flex items-center gap-1 rounded bg-[var(--success-dim)] px-2 py-0.5 text-xs text-[var(--success)]">
              <CheckCircle size={12} aria-hidden />
              目前生效中
            </div>
          ) : (
            <div className="mt-1 inline-flex rounded bg-[var(--bg-base)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
              草稿 / 歷史
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {!doc.is_active && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onSave}
                disabled={saving}>
                <Save size={14} aria-hidden />
                儲存
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onActivate}
                disabled={busy}>
                <CheckCircle size={14} aria-hidden />
                啟用此版本
              </button>
            </>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={doc.is_active}
        />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label className="text-xs">
            <span className="text-[var(--text-secondary)]">生效時間</span>
            <input
              type="datetime-local"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
              disabled={doc.is_active}
              className="input mt-1"
            />
          </label>
          <label className="flex items-end gap-2 text-xs">
            <input
              type="checkbox"
              checked={requiresConsent}
              onChange={(e) => setRequiresConsent(e.target.checked)}
              disabled={doc.is_active}
            />
            <span>需明示同意（顯示同意按鈕）</span>
          </label>
        </div>
        <label className="text-xs">
          <span className="text-[var(--text-secondary)]">摘要（Markdown，選填）</span>
          <textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={doc.is_active}
            className="input mt-1 font-mono text-[11px]"
          />
        </label>
        <label className="text-xs">
          <span className="text-[var(--text-secondary)]">內文（Markdown）</span>
          <textarea
            rows={16}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={doc.is_active}
            className="input mt-1 font-mono text-[11px]"
          />
        </label>
      </div>
    </div>
  );
}

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<PolicyKind>("privacy");
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    if (!version.trim() || !title.trim() || !content.trim() || !effectiveAt) {
      toast.error("version / title / content / effective_at 必填");
      return;
    }
    setBusy(true);
    try {
      await policiesApi.create({
        kind,
        version: version.trim(),
        title: title.trim(),
        content_md: content,
        effective_at: new Date(effectiveAt).toISOString(),
        requires_explicit_consent: true,
      });
      toast.success("已新增（未啟用）");
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--bg-overlay)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true">
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border p-5"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold text-[var(--text-primary)]">
          新增政策版本
        </h3>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="text-[var(--text-secondary)]">類型</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as PolicyKind)}
                className="input mt-1">
                {Object.entries(KIND_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="text-[var(--text-secondary)]">版本（例：2026-06-01 或 1.2）</span>
              <input
                className="input mt-1 font-mono"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </label>
          </div>
          <label className="text-xs">
            <span className="text-[var(--text-secondary)]">標題</span>
            <input
              className="input mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="text-xs">
            <span className="text-[var(--text-secondary)]">生效時間</span>
            <input
              type="datetime-local"
              className="input mt-1"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
            />
          </label>
          <label className="text-xs">
            <span className="text-[var(--text-secondary)]">內文（Markdown）</span>
            <textarea
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="input mt-1 font-mono text-[11px]"
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onCreate}
            disabled={busy}>
            <Plus size={14} aria-hidden />
            建立（不啟用）
          </button>
        </div>
        <p className="mt-2 text-[10px] text-[var(--text-muted)]">
          建立後預設為「草稿」。確認無誤再到列表按「啟用此版本」，會自動 deactivate 同類別其他版本。
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 個資權利請求 Tab
// ─────────────────────────────────────────────────────────────────

function PrivacyRequestsTab() {
  const [rows, setRows] = useState<PrivacyRequestOut[]>([]);
  const [active, setActive] = useState<PrivacyRequestOut | null>(null);
  const [respMsg, setRespMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const items = await policiesApi.listPrivacyRequests();
      setRows(items);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "讀取失敗");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, [rows]);

  const updateStatus = async (newStatus: PrivacyRequestStatus) => {
    if (!active) return;
    setBusy(true);
    try {
      await policiesApi.updatePrivacyRequest(active.id, {
        status: newStatus,
        response_message: respMsg.trim() || null,
      });
      toast.success(`已更新狀態為 ${STATUS_LABEL[newStatus]}`);
      setRespMsg("");
      setActive(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {Object.entries(STATUS_LABEL).map(([k, l]) => (
          <span
            key={k}
            className="rounded border px-2 py-0.5"
            style={{
              borderColor: "var(--border)",
              color: STATUS_COLOR[k as PrivacyRequestStatus],
            }}>
            {l}：{counts[k] ?? 0}
          </span>
        ))}
        <button type="button" className="btn-sm btn-ghost ml-auto" onClick={load}>
          <RefreshCcw size={12} aria-hidden />
          重新整理
        </button>
      </div>

      <section
        className="overflow-hidden rounded-lg border bg-[var(--bg-surface)]"
        style={{ borderColor: "var(--border)" }}>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">無請求。</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[var(--text-secondary)]">
              <tr className="border-b border-[var(--border)] bg-[var(--bg-base)]">
                <th className="px-3 py-2 text-left">收件時間</th>
                <th className="px-3 py-2 text-left">類型</th>
                <th className="px-3 py-2 text-left">主旨</th>
                <th className="px-3 py-2 text-left">狀態</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)]">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">{r.request_type}</td>
                  <td className="px-3 py-2">{r.subject}</td>
                  <td
                    className="px-3 py-2"
                    style={{ color: STATUS_COLOR[r.status] }}>
                    {STATUS_LABEL[r.status]}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setActive(r);
                        setRespMsg(r.response_message ?? "");
                      }}
                      className="btn-sm btn-ghost">
                      處理
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "var(--bg-overlay)" }}
          onClick={() => setActive(null)}
          role="dialog"
          aria-modal="true">
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border p-5"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-base font-semibold text-[var(--text-primary)]">
              {active.subject}
            </h3>
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              {STATUS_LABEL[active.status]} · {active.request_type} ·{" "}
              {new Date(active.created_at).toLocaleString()}
            </p>
            <div className="mb-3 rounded bg-[var(--bg-base)] p-2 text-xs whitespace-pre-wrap">
              {active.description}
            </div>
            {active.response_message && (
              <div className="mb-3 text-xs">
                <div className="text-[var(--text-secondary)]">前次回覆：</div>
                <div className="rounded bg-[var(--bg-base)] p-2 whitespace-pre-wrap">
                  {active.response_message}
                </div>
              </div>
            )}
            <label className="text-xs">
              <span className="text-[var(--text-secondary)]">回覆訊息（會寄給當事人）</span>
              <textarea
                rows={4}
                value={respMsg}
                onChange={(e) => setRespMsg(e.target.value)}
                className="input mt-1"
              />
            </label>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setActive(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => updateStatus("in_review")}>
                標為處理中
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => updateStatus("fulfilled")}>
                標為完成
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => updateStatus("rejected")}>
                拒絕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
