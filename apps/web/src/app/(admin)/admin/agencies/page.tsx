"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Lock, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Field, Select, TextArea, TextInput, Toggle } from "@/components/site/PublicSiteAdminFields";
import { confirmAction } from "@/components/ui/ConfirmDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { agenciesApi, apiErrorMessage, orgsApi } from "@/lib/api";
import {
  BODY_LABEL,
  BRANCH_KINDS,
  BRANCH_META,
  BRANCH_ORDER,
  KIND_META,
  KIND_STATUSES,
  OUTCOME_LABEL,
  STATUS_LABEL,
  formatTwDate,
  type AgencyEntryKind,
  type AgencyEntryStatus,
} from "@/lib/agency-meta";
import type { AgencyBranch, AgencyEntryCreate, AgencyEntryOut, AgencyManageOut } from "@/lib/types";

type OrgOption = { id: string; name: string };

const surface = { background: "var(--bg-surface)", borderColor: "var(--border)" };
const nullable = (value: string) => (value.trim() ? value : null);

function emptyEntry(kind: AgencyEntryKind): AgencyEntryCreate {
  return {
    kind, title: "", reference_no: null, status: null, summary: null, body_md: null,
    outcome_md: null, occurred_on: null, link_url: null, show_on_calendar: kind === "event",
    is_published: false, sort_order: 0,
  };
}

export default function AgencyAdminPage() {
  const { canAny, isReady } = usePermissions();
  const allowed = canAny("agency:manage", "site:manage");
  const [agencies, setAgencies] = useState<AgencyManageOut[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const active = agencies.find((agency) => agency.id === activeId) ?? null;
  const isSiteAdmin = canAny("site:manage");

  const load = useCallback(async (selectId?: string) => {
    setLoading(true); setError("");
    try {
      const rows = await agenciesApi.manageable();
      setAgencies(rows);
      setActiveId((current) => selectId ?? (rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ""));
    } catch (cause) {
      setError(apiErrorMessage(cause, "無法載入機關專頁"));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isReady && allowed) void load(); }, [isReady, allowed, load]);
  useEffect(() => {
    if (!isSiteAdmin) return;
    orgsApi.list({ active_only: true }).then((rows) => setOrgs(rows.map(({ id, name }) => ({ id, name }))))
      .catch(() => setOrgs([]));
  }, [isSiteAdmin]);

  if (isReady && !allowed) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <section className="rounded-lg border p-8 text-center" style={surface}>
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">需要機關專頁維護權限</h1>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">機關專頁</h1>
      </header>
      {error && (
        <p role="alert" className="mb-4 rounded-lg border px-4 py-3 text-sm text-[var(--danger)]" style={surface}>
          {error} <button type="button" className="underline" onClick={() => void load()}>重試</button>
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
        <aside className="space-y-3">
          {loading && agencies.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]" role="status">載入中…</p>
          ) : agencies.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">沒有可維護的機關</p>
          ) : (
            <nav className="space-y-1" aria-label="機關">
              {agencies.map((agency) => (
                <button
                  key={agency.id}
                  type="button"
                  onClick={() => setActiveId(agency.id)}
                  aria-current={agency.id === activeId ? "page" : undefined}
                  className="flex w-full flex-col rounded-lg border px-3 py-2 text-left"
                  style={{
                    ...surface,
                    borderColor: agency.id === activeId ? "var(--primary)" : "var(--border)",
                  }}
                >
                  <span className="text-xs text-[var(--text-muted)]">
                    {BRANCH_META[agency.branch].label}{agency.is_published ? "" : "・未發布"}
                  </span>
                  <span className="font-medium text-[var(--text-primary)]">{agency.name}</span>
                </button>
              ))}
            </nav>
          )}
          {isSiteAdmin && <CreateAgencyForm orgs={orgs} onCreated={(id) => void load(id)} />}
        </aside>
        <main className="min-w-0 space-y-4">
          {active && (
            <>
              <ProfileForm key={active.id} agency={active} orgs={orgs} onSaved={() => void load(active.id)} onDeleted={() => void load()} />
              <EntriesPanel key={`entries-${active.id}`} agency={active} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function CreateAgencyForm({ orgs, onCreated }: { orgs: OrgOption[]; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", branch: "executive" as AgencyBranch, org_id: "" });

  if (!open) {
    return (
      <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden /> 新增機關
      </button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await agenciesApi.create({
        name: form.name, slug: form.slug, branch: form.branch, org_id: form.org_id || null,
        tagline: null, intro_md: "", sort_order: BRANCH_ORDER.indexOf(form.branch),
      });
      toast.success("已建立機關專頁");
      setOpen(false);
      setForm({ name: "", slug: "", branch: "executive", org_id: "" });
      onCreated(created.id);
    } catch (cause) {
      toast.error(apiErrorMessage(cause, "建立失敗"));
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-3" style={surface}>
      <Field label="類型">
        <Select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value as AgencyBranch })}>
          {BRANCH_ORDER.map((branch) => <option key={branch} value={branch}>{BRANCH_META[branch].label}・{BRANCH_META[branch].role}</option>)}
        </Select>
      </Field>
      <Field label="名稱">
        <TextInput required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="網址代稱">
        <TextInput required pattern="[a-z0-9][a-z0-9\-]*" maxLength={40} value={form.slug} placeholder="council"
          onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
      </Field>
      <OrgSelect orgs={orgs} value={form.org_id} onChange={(org_id) => setForm({ ...form, org_id })} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>建立</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>取消</button>
      </div>
    </form>
  );
}

function OrgSelect({ orgs, value, onChange }: { orgs: OrgOption[]; value: string; onChange: (value: string) => void }) {
  return (
    <Field label="維護組織">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">（未指定，僅網站管理員可維護）</option>
        {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
      </Select>
    </Field>
  );
}

function ProfileForm({ agency, orgs, onSaved, onDeleted }: {
  agency: AgencyManageOut; orgs: OrgOption[]; onSaved: () => void; onDeleted: () => void;
}) {
  const [form, setForm] = useState({
    name: agency.name,
    tagline: agency.tagline ?? "",
    intro_md: agency.intro_md,
    mandate_md: agency.mandate_md ?? "",
    contact_md: agency.contact_md ?? "",
    is_published: agency.is_published,
    slug: agency.slug,
    org_id: agency.org_id ?? "",
    sort_order: agency.sort_order,
  });
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const content = {
        name: form.name, tagline: nullable(form.tagline), intro_md: form.intro_md,
        mandate_md: nullable(form.mandate_md), contact_md: nullable(form.contact_md), is_published: form.is_published,
      };
      if (agency.can_admin) {
        await agenciesApi.adminUpdate(agency.id, {
          ...content, slug: form.slug, org_id: form.org_id || null, sort_order: form.sort_order,
        });
      } else {
        await agenciesApi.update(agency.id, content);
      }
      toast.success("已儲存");
      onSaved();
    } catch (cause) {
      toast.error(apiErrorMessage(cause, "儲存失敗"));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: `刪除「${agency.name}」？`, description: "專頁與所有公開項目會一併刪除，無法復原。",
      confirmLabel: "刪除", danger: true,
    });
    if (!ok) return;
    try {
      await agenciesApi.remove(agency.id);
      toast.success("已刪除");
      onDeleted();
    } catch (cause) { toast.error(apiErrorMessage(cause, "刪除失敗")); }
  };

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border p-4" style={surface} aria-label="機關介紹">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {agency.name}
          {agency.org_name && <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">{agency.org_name}</span>}
        </h2>
        {agency.is_published && (
          <Link href={`/agencies/${encodeURIComponent(agency.slug)}`} target="_blank" className="inline-flex items-center gap-1 text-sm text-[var(--primary-text)]">
            查看公開頁 <ExternalLink size={14} aria-hidden />
          </Link>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="名稱"><TextInput required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="標語"><TextInput maxLength={200} value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></Field>
      </div>
      <Field label="介紹（Markdown）"><TextArea value={form.intro_md} onChange={(e) => setForm({ ...form, intro_md: e.target.value })} /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={agency.branch === "judicial" ? "職權與中立（Markdown）" : "職權與法源（Markdown）"}>
          <TextArea value={form.mandate_md} onChange={(e) => setForm({ ...form, mandate_md: e.target.value })} />
        </Field>
        <Field label="聯絡方式（Markdown）"><TextArea value={form.contact_md} onChange={(e) => setForm({ ...form, contact_md: e.target.value })} /></Field>
      </div>
      {agency.can_admin && (
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="網址代稱">
            <TextInput required pattern="[a-z0-9][a-z0-9\-]*" maxLength={40} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
          </Field>
          <OrgSelect orgs={orgs.some((org) => org.id === form.org_id) || !form.org_id ? orgs : [...orgs, { id: form.org_id, name: agency.org_name ?? form.org_id }]}
            value={form.org_id} onChange={(org_id) => setForm({ ...form, org_id })} />
          <Field label="排序"><TextInput type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })} /></Field>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toggle label="公開" checked={form.is_published} onChange={(is_published) => setForm({ ...form, is_published })} />
        <div className="flex gap-2">
          {agency.can_admin && (
            <button type="button" className="btn-secondary text-[var(--danger)]" onClick={() => void remove()}>
              <Trash2 size={16} aria-hidden /> 刪除機關
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={busy}><Save size={16} aria-hidden /> 儲存</button>
        </div>
      </div>
    </form>
  );
}

function EntriesPanel({ agency }: { agency: AgencyManageOut }) {
  const kinds = BRANCH_KINDS[agency.branch];
  const [kind, setKind] = useState<AgencyEntryKind>(kinds[0]);
  const [entries, setEntries] = useState<AgencyEntryOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AgencyEntryOut | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setEntries(await agenciesApi.entries(agency.id)); }
    catch (cause) { setError(apiErrorMessage(cause, "無法載入項目")); }
    finally { setLoading(false); }
  }, [agency.id]);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) map.set(entry.kind, (map.get(entry.kind) ?? 0) + 1);
    return map;
  }, [entries]);
  const visible = entries.filter((entry) => entry.kind === kind);

  const remove = async (entry: AgencyEntryOut) => {
    const ok = await confirmAction({ title: `刪除「${entry.title}」？`, confirmLabel: "刪除", danger: true });
    if (!ok) return;
    try {
      await agenciesApi.deleteEntry(agency.id, entry.id);
      setEntries((rows) => rows.filter((row) => row.id !== entry.id));
      toast.success("已刪除");
    } catch (cause) { toast.error(apiErrorMessage(cause, "刪除失敗")); }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4" style={surface} aria-labelledby="agency-entries-title">
      <h2 id="agency-entries-title" className="text-lg font-semibold text-[var(--text-primary)]">公開項目</h2>
      <div role="tablist" aria-label="項目類型" className="flex flex-wrap gap-1">
        {kinds.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={item === kind}
            onClick={() => { setKind(item); setEditing(null); }}
            className="rounded-full border px-3 py-1 text-sm"
            style={{
              borderColor: item === kind ? "var(--primary)" : "var(--border)",
              color: item === kind ? "var(--primary-text)" : "var(--text-secondary)",
            }}>
            {KIND_META[item].label}<span className="ml-1 text-[var(--text-muted)]">{counts.get(item) ?? 0}</span>
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
      {editing ? (
        <EntryForm
          key={editing === "new" ? `new-${kind}` : editing.id}
          agencyId={agency.id}
          initial={editing === "new" ? emptyEntry(kind) : editing}
          entryId={editing === "new" ? null : editing.id}
          onDone={(saved) => {
            if (saved) setEntries((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
            setEditing(null);
          }}
        />
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setEditing("new")}>
          <Plus size={16} aria-hidden /> 新增{KIND_META[kind].label}
        </button>
      )}
      {loading ? (
        <p className="text-sm text-[var(--text-muted)]" role="status">載入中…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">尚無{KIND_META[kind].label}</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {visible.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--text-primary)]">{entry.title}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {[
                    entry.is_published ? "已公開" : "未公開",
                    entry.occurred_on && formatTwDate(entry.occurred_on),
                    entry.status && STATUS_LABEL[entry.status],
                    entry.show_on_calendar && "行事曆",
                  ].filter(Boolean).join("・")}
                </p>
              </div>
              <div className="flex gap-1">
                <button type="button" className="btn-secondary" onClick={() => setEditing(entry)} aria-label={`編輯「${entry.title}」`}>
                  <Pencil size={14} aria-hidden />
                </button>
                <button type="button" className="btn-secondary text-[var(--danger)]" onClick={() => void remove(entry)} aria-label={`刪除「${entry.title}」`}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EntryForm({ agencyId, initial, entryId, onDone }: {
  agencyId: string;
  initial: AgencyEntryCreate | AgencyEntryOut;
  entryId: string | null;
  onDone: (saved: AgencyEntryOut | null) => void;
}) {
  const [form, setForm] = useState({
    title: initial.title,
    reference_no: initial.reference_no ?? "",
    status: (initial.status ?? "") as AgencyEntryStatus | "",
    summary: initial.summary ?? "",
    body_md: initial.body_md ?? "",
    outcome_md: initial.outcome_md ?? "",
    occurred_on: initial.occurred_on ?? "",
    link_url: initial.link_url ?? "",
    show_on_calendar: initial.show_on_calendar ?? false,
    is_published: initial.is_published ?? false,
    sort_order: initial.sort_order ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const statuses = KIND_STATUSES[initial.kind];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const body = {
      title: form.title,
      reference_no: nullable(form.reference_no),
      status: form.status || null,
      summary: nullable(form.summary),
      body_md: nullable(form.body_md),
      outcome_md: nullable(form.outcome_md),
      occurred_on: form.occurred_on || null,
      link_url: nullable(form.link_url),
      show_on_calendar: form.show_on_calendar,
      is_published: form.is_published,
      sort_order: form.sort_order,
    };
    try {
      const saved = entryId
        ? await agenciesApi.updateEntry(agencyId, entryId, body)
        : await agenciesApi.createEntry(agencyId, { ...body, kind: initial.kind });
      toast.success("已儲存");
      onDone(saved);
    } catch (cause) {
      toast.error(apiErrorMessage(cause, "儲存失敗"));
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}
      aria-label={entryId ? "編輯項目" : `新增${KIND_META[initial.kind].label}`}>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
        <Field label="標題"><TextInput required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="日期"><TextInput type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="案號／字號"><TextInput maxLength={60} value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></Field>
        {statuses && (
          <Field label="狀態">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AgencyEntryStatus | "" })}>
              <option value="">（無）</option>
              {statuses.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <Field label="摘要"><TextInput value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></Field>
      <Field label={`${BODY_LABEL[initial.kind] ?? "內容"}（Markdown）`}>
        <TextArea value={form.body_md} onChange={(e) => setForm({ ...form, body_md: e.target.value })} />
      </Field>
      {OUTCOME_LABEL[initial.kind] && (
        <Field label={`${OUTCOME_LABEL[initial.kind]}（Markdown）`}>
          <TextArea value={form.outcome_md} onChange={(e) => setForm({ ...form, outcome_md: e.target.value })} />
        </Field>
      )}
      <Field label="附件或 Google 雲端連結">
        <TextInput type="url" maxLength={500} value={form.link_url} placeholder="https://docs.google.com/…"
          onChange={(e) => setForm({ ...form, link_url: e.target.value })} />
      </Field>
      <div className="flex flex-wrap items-center gap-x-6">
        <Toggle label="公開" checked={form.is_published} onChange={(is_published) => setForm({ ...form, is_published })} />
        <Toggle label="顯示於首頁行事曆" checked={form.show_on_calendar} onChange={(show_on_calendar) => setForm({ ...form, show_on_calendar })} />
      </div>
      {form.show_on_calendar && !form.occurred_on && (
        <p className="text-sm text-[var(--warning)]">需要日期才會出現在行事曆</p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}><Save size={16} aria-hidden /> 儲存</button>
        <button type="button" className="btn-secondary" onClick={() => onDone(null)}>取消</button>
      </div>
    </form>
  );
}
