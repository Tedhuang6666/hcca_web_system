"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import NavIcon from "@/components/layout/NavIcon";
import { adminApi, apiErrorMessage, navigationProfilesApi } from "@/lib/api";
import {
  isSection,
  NAV_ITEMS_BY_ID,
  navProfileFromApi,
  type NavItem,
} from "@/lib/navigation";
import type {
  NavigationProfileCreate,
  NavigationProfileOut,
  NavigationProfileSection,
  PositionSummary,
} from "@/lib/types";

type Draft = NavigationProfileCreate;

const EMPTY_DRAFT: Draft = {
  key: "",
  label: "",
  description: "",
  audience: "",
  priority: 100,
  is_active: true,
  match_any_permissions: [],
  match_any_prefixes: [],
  exclude_permissions: [],
  exclude_prefixes: [],
  desktop_sections: [{ id: "main", heading: "主要", items: ["dashboard"], collapsible: false, default_collapsed: false }],
  mobile_order: ["dashboard"],
  position_ids: [],
};

export default function NavigationProfilesPage() {
  const [profiles, setProfiles] = useState<NavigationProfileOut[]>([]);
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("new");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);

  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;
  const preview = useMemo(() => navProfileFromApi(draftToProfile(draft, selected)), [draft, selected]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRows, positionRows] = await Promise.all([
        navigationProfilesApi.list(true),
        adminApi.listPositions(),
      ]);
      setProfiles(profileRows);
      setPositions(positionRows);
      if (selectedId !== "new") {
        const current = profileRows.find((profile) => profile.id === selectedId);
        if (current) setDraft(profileToDraft(current));
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, "讀取視角設定失敗"));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  const selectProfile = (profile: NavigationProfileOut | null) => {
    if (!profile) {
      setSelectedId("new");
      setDraft(EMPTY_DRAFT);
      return;
    }
    setSelectedId(profile.id);
    setDraft(profileToDraft(profile));
  };

  const save = async () => {
    if (!draft.key.trim() || !draft.label.trim()) {
      toast.error("請填寫 key 與名稱");
      return;
    }
    try {
      const payload = normalizeDraft(draft);
      if (selected) {
        await navigationProfilesApi.update(selected.id, payload);
        toast.success("視角已更新");
      } else {
        const created = await navigationProfilesApi.create(payload);
        setSelectedId(created.id);
        toast.success("視角已建立");
      }
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "儲存視角失敗"));
    }
  };

  const remove = async () => {
    if (!selected || selected.is_system) return;
    if (!window.confirm(`刪除「${selected.label}」？`)) return;
    try {
      await navigationProfilesApi.delete(selected.id);
      toast.success("視角已刪除");
      setSelectedId("new");
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "刪除視角失敗"));
    }
  };

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <ShieldCheck size={14} aria-hidden />
            角色視角 / 可編輯導覽設定
          </div>
          <h1 className="text-2xl font-bold">視角管理</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
            新增或調整登入後介面視角，並用指定職位或權限規則決定套用對象。
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => selectProfile(null)}>
          <Plus size={16} aria-hidden />
          新增視角
        </button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-2">
          <button
            type="button"
            onClick={() => selectProfile(null)}
            className="w-full rounded-md border px-4 py-3 text-left"
            style={{
              background: selectedId === "new" ? "var(--primary-dim)" : "var(--bg-surface)",
              borderColor: selectedId === "new" ? "var(--primary)" : "var(--border)",
            }}>
            <div className="font-semibold">新增視角</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">建立自訂角色視角</div>
          </button>
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => selectProfile(profile)}
              className="w-full rounded-md border px-4 py-3 text-left"
              style={{
                background: selectedId === profile.id ? "var(--primary-dim)" : "var(--bg-surface)",
                borderColor: selectedId === profile.id ? "var(--primary)" : "var(--border)",
              }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{profile.label}</span>
                {!profile.is_active && <span className="text-xs text-[var(--warning)]">停用</span>}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {profile.key} · 優先 {profile.priority}
              </div>
            </button>
          ))}
        </aside>

        <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <Editor
            draft={draft}
            setDraft={setDraft}
            positions={positions}
            selected={selected}
            loading={loading}
            onSave={save}
            onDelete={remove}
          />
          <Preview items={preview.desktopSections.flatMap((entry) => isSection(entry) ? entry.items : [entry])} />
        </section>
      </div>
    </main>
  );
}

function Editor({
  draft,
  setDraft,
  positions,
  selected,
  loading,
  onSave,
  onDelete,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  positions: PositionSummary[];
  selected: NavigationProfileOut | null;
  loading: boolean;
  onSave: () => void;
  onDelete: () => void;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <section className="card p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Key">
          <input
            className="input"
            value={draft.key}
            disabled={Boolean(selected?.is_system)}
            onChange={(event) => set("key", event.target.value)}
            placeholder="teacher"
          />
        </Field>
        <Field label="名稱">
          <input className="input" value={draft.label} onChange={(event) => set("label", event.target.value)} />
        </Field>
        <Field label="適用對象">
          <input className="input" value={draft.audience ?? ""} onChange={(event) => set("audience", event.target.value)} />
        </Field>
        <Field label="優先序">
          <input
            className="input"
            type="number"
            value={draft.priority}
            onChange={(event) => set("priority", Number(event.target.value) || 0)}
          />
        </Field>
      </div>

      <Field label="說明">
        <textarea className="input min-h-20" value={draft.description ?? ""} onChange={(event) => set("description", event.target.value)} />
      </Field>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="符合任一權限">
          <textarea className="input min-h-20" value={(draft.match_any_permissions ?? []).join("\n")} onChange={(event) => set("match_any_permissions", lines(event.target.value))} />
        </Field>
        <Field label="符合任一權限前綴">
          <textarea className="input min-h-20" value={(draft.match_any_prefixes ?? []).join("\n")} onChange={(event) => set("match_any_prefixes", lines(event.target.value))} />
        </Field>
        <Field label="排除權限">
          <textarea className="input min-h-20" value={(draft.exclude_permissions ?? []).join("\n")} onChange={(event) => set("exclude_permissions", lines(event.target.value))} />
        </Field>
        <Field label="排除權限前綴">
          <textarea className="input min-h-20" value={(draft.exclude_prefixes ?? []).join("\n")} onChange={(event) => set("exclude_prefixes", lines(event.target.value))} />
        </Field>
      </div>

      <Field label="指定職位">
        <select
          className="input min-h-32"
          multiple
          value={draft.position_ids}
          onChange={(event) => set("position_ids", Array.from(event.target.selectedOptions).map((option) => option.value))}
        >
          {positions.map((position) => (
            <option key={position.id} value={position.id}>
              {position.org_name} / {position.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="左側欄分組">
          <textarea
            className="input min-h-40 font-mono text-xs"
            value={sectionsToText(draft.desktop_sections ?? [])}
            onChange={(event) => set("desktop_sections", parseSections(event.target.value))}
          />
        </Field>
        <Field label="手機項目順序">
          <textarea className="input min-h-40 font-mono text-xs" value={(draft.mobile_order ?? []).join("\n")} onChange={(event) => set("mobile_order", lines(event.target.value))} />
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.is_active} onChange={(event) => set("is_active", event.target.checked)} />
          啟用此視角
        </label>
        <div className="flex gap-2">
          {selected && !selected.is_system && (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              <Trash2 size={16} aria-hidden />
              刪除
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={loading} onClick={onSave}>
            <Save size={16} aria-hidden />
            儲存
          </button>
        </div>
      </div>
    </section>
  );
}

function Preview({ items }: { items: NavItem[] }) {
  return (
    <section className="card overflow-hidden">
      <header className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="font-semibold">導覽預覽</h2>
      </header>
      <div className="divide-y divide-[var(--border)]">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 px-5 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--bg-muted)] text-[var(--text-muted)]">
              <NavIcon iconKey={item.iconKey} size={16} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.label}</div>
              <div className="truncate text-xs text-[var(--text-muted)]">{item.href}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function profileToDraft(profile: NavigationProfileOut): Draft {
  return {
    key: profile.key,
    label: profile.label,
    description: profile.description ?? "",
    audience: profile.audience ?? "",
    priority: profile.priority,
    is_active: profile.is_active,
    match_any_permissions: profile.match_any_permissions ?? [],
    match_any_prefixes: profile.match_any_prefixes ?? [],
    exclude_permissions: profile.exclude_permissions ?? [],
    exclude_prefixes: profile.exclude_prefixes ?? [],
    desktop_sections: profile.desktop_sections ?? [],
    mobile_order: profile.mobile_order ?? [],
    position_ids: profile.position_ids ?? [],
  };
}

function draftToProfile(draft: Draft, selected: NavigationProfileOut | null): NavigationProfileOut {
  return {
    id: selected?.id ?? "preview",
    is_system: selected?.is_system ?? false,
    created_at: selected?.created_at ?? "",
    updated_at: selected?.updated_at ?? "",
    ...draft,
  };
}

function normalizeDraft(draft: Draft): Draft {
  return {
    ...draft,
    key: draft.key.trim(),
    label: draft.label.trim(),
    match_any_permissions: unique(draft.match_any_permissions ?? []),
    match_any_prefixes: unique(draft.match_any_prefixes ?? []),
    exclude_permissions: unique(draft.exclude_permissions ?? []),
    exclude_prefixes: unique(draft.exclude_prefixes ?? []),
    mobile_order: unique(draft.mobile_order ?? []).filter((id) => NAV_ITEMS_BY_ID[id]),
    desktop_sections: (draft.desktop_sections ?? []).map((section) => ({
      ...section,
      items: unique(section.items ?? []).filter((id) => NAV_ITEMS_BY_ID[id]),
    })),
    position_ids: unique(draft.position_ids ?? []),
  };
}

function lines(value: string) {
  return unique(value.split(/\n|,/).map((line) => line.trim()).filter(Boolean));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function sectionsToText(sections: NavigationProfileSection[]) {
  return sections.map((section) => `${section.heading}: ${(section.items ?? []).join(", ")}`).join("\n");
}

function parseSections(value: string): NavigationProfileSection[] {
  const sections: NavigationProfileSection[] = [];
  value.split("\n").forEach((line, index) => {
    const [headingRaw, itemsRaw = ""] = line.split(":");
    const heading = headingRaw.trim();
    if (!heading) return;
    const items = lines(itemsRaw).filter((id) => NAV_ITEMS_BY_ID[id]);
    sections.push({
      id: heading.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || `section-${index}`,
      heading,
      items,
      collapsible: false,
      default_collapsed: false,
    });
  });
  return sections.length > 0 ? sections : (EMPTY_DRAFT.desktop_sections ?? []);
}
