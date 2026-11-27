"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle,
  Lock,
  Plus,
  RefreshCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import {
  policiesApi,
  type PolicyDocumentListItem,
  type PolicyDocumentOut,
  type PolicyKind,
  apiErrorMessage } from "@/lib/api";

const KIND_LABEL: Record<PolicyKind, string> = {
  privacy: "隱私權政策",
  terms: "服務條款",
  cookie: "Cookie 政策",
  accessibility: "無障礙聲明",
  security: "資安政策",
};

export default function PoliciesPage() {
  const { can } = usePermissions();

  if (!can("policy:admin")) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <section
          className="rounded-lg border p-8 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            需要政策管理權限
          </h1>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">政策版本</h1>
      </header>
      <DocumentsTab />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 政策版本 Tab
// ─────────────────────────────────────────────────────────────────

function DocumentsTab() {
  const confirm = useConfirm();
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
      toast.error(apiErrorMessage(e, "讀取失敗"));
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
      toast.error(apiErrorMessage(e, "讀取詳情失敗"));
    }
  };

  const activate = async (item: PolicyDocumentListItem) => {
    if (!(await confirm({
      title: `啟用「${KIND_LABEL[item.kind]} v${item.version}」？`,
      description: "同類別的其他版本會自動失效。",
      confirmLabel: "啟用版本",
      danger: true,
    }))) return;
    setBusy(true);
    try {
      await policiesApi.activate(item.id);
      toast.success("已啟用此版本");
      await load();
      if (selected?.id === item.id) await openDetail(item);
    } catch (e) {
      toast.error(apiErrorMessage(e, "啟用失敗"));
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
                    <span className="inline-flex items-center gap-0.5 rounded bg-[var(--success-dim)] px-1 py-0.5 text-xs text-[var(--success)]">
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(doc.title);
    setContent(doc.content_md);
    setSummary(doc.summary_md ?? "");
    setEffectiveAt(doc.effective_at.slice(0, 16));
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
        requires_explicit_consent: false,
      });
      toast.success("已儲存");
      await onSaved();
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
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
        </div>
        <label className="text-xs">
          <span className="text-[var(--text-secondary)]">摘要（Markdown，選填）</span>
          <textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={doc.is_active}
            className="input mt-1 font-mono text-xs"
          />
        </label>
        <label className="text-xs">
          <span className="text-[var(--text-secondary)]">內文（Markdown）</span>
          <textarea
            rows={16}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={doc.is_active}
            className="input mt-1 font-mono text-xs"
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
        requires_explicit_consent: false,
      });
      toast.success("已新增（未啟用）");
      onCreated();
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立失敗"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="新增政策版本" onClose={onClose} size="2xl" mobileFullscreen={false}>
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs">
            <span className="text-[var(--text-secondary)]">類型</span>
            <select
              data-autofocus=""
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
            className="input mt-1 font-mono text-xs"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <button type="button" className="btn btn-ghost w-full sm:w-auto" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary w-full sm:w-auto"
          onClick={onCreate}
          disabled={busy}>
          <Plus size={14} aria-hidden />
          建立（不啟用）
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        建立後為草稿；啟用時自動停用同類別舊版本。
      </p>
    </Modal>
  );
}
