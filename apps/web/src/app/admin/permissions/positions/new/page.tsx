"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import AdminWorkbenchTabs from "@/components/admin/AdminWorkbenchTabs";
import { ensurePermissionCatalog, PermCheckboxes } from "@/components/admin/PermissionCatalog";
import { adminApi, apiErrorMessage, orgsApi } from "@/lib/api";
import type {
  OrgRead,
  PermissionCodeInfo,
  PositionCategory,
  PositionSummary,
} from "@/lib/types";

type OrgWithPermissionDefaults = OrgRead & { default_permission_codes: string[] };

const CATEGORY_OPTIONS: { value: PositionCategory; label: string; description: string }[] = [
  { value: "council", label: "自治職位", description: "班聯會與自治組織幹部" },
  { value: "class", label: "班級職位", description: "班級幹部與班級任務" },
  { value: "system", label: "系統職位", description: "外部協作與特殊權限" },
];

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full min-h-11 rounded-lg px-3 text-sm outline-none ${props.className ?? ""}`}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
        ...props.style,
      }}
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full min-h-11 rounded-lg px-3 text-sm outline-none ${props.className ?? ""}`}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
        ...props.style,
      }}
    />
  );
}

function ArrowLeft() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ShieldPlus() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="M12 8v6M9 11h6" />
    </svg>
  );
}

export default function NewPositionPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgWithPermissionDefaults[]>([]);
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [permCodes, setPermCodes] = useState<PermissionCodeInfo[]>([]);
  const [orgId, setOrgId] = useState("");
  const [requestedOrgId, setRequestedOrgId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<PositionCategory>("council");
  const [weight, setWeight] = useState(0);
  const [parentId, setParentId] = useState("");
  const [defaultCodes, setDefaultCodes] = useState<string[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("org_id");
    setRequestedOrgId(value);
  }, []);

  useEffect(() => {
    Promise.all([
      orgsApi.list({ active_only: true, exclude_class_orgs: true }),
      adminApi.listPositions(),
      adminApi.listPermissionCodes(),
    ])
      .then(([loadedOrgs, loadedPositions, loadedPerms]) => {
        const nextOrgs = loadedOrgs as OrgWithPermissionDefaults[];
        setOrgs(nextOrgs);
        setPositions(loadedPositions);
        setPermCodes(ensurePermissionCatalog(loadedPerms));
        const firstOrgId = nextOrgs.find((org) => org.id === requestedOrgId)?.id ?? nextOrgs[0]?.id ?? "";
        setOrgId(firstOrgId);
      })
      .catch((error: unknown) => toast.error(apiErrorMessage(error, "建立職位頁面載入失敗")))
      .finally(() => setLoading(false));
  }, [requestedOrgId]);

  const selectedOrg = useMemo(() => orgs.find((org) => org.id === orgId) ?? null, [orgId, orgs]);
  const orgPositions = useMemo(
    () => positions.filter((position) => position.org_id === orgId),
    [orgId, positions],
  );
  const addedCodes = codes.filter((code) => !defaultCodes.includes(code));
  const removedCodes = defaultCodes.filter((code) => !codes.includes(code));
  const labelFor = (code: string) => permCodes.find((item) => item.code === code)?.label ?? code;

  useEffect(() => {
    const nextDefaults = selectedOrg?.default_permission_codes ?? [];
    setDefaultCodes(nextDefaults);
    setCodes(nextDefaults);
    setParentId("");
  }, [selectedOrg]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedOrg || !name.trim()) {
      toast.error(!selectedOrg ? "請先選擇組織" : "請填寫職位名稱");
      return;
    }
    setSaving(true);
    try {
      await adminApi.createPosition({
        org_id: selectedOrg.id,
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        weight: Math.max(0, weight),
        parent_id: parentId || null,
        permission_codes: codes,
      });
      toast.success(`「${name.trim()}」已建立`);
      router.push("/admin/permissions");
    } catch (error) {
      toast.error(apiErrorMessage(error, "建立職位失敗"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-full" style={{ background: "var(--bg-base)" }}>
      <AdminWorkbenchTabs />
      <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/admin/permissions"
              className="inline-flex min-h-11 items-center gap-1 text-xs font-medium no-underline"
              style={{ color: "var(--text-muted)" }}
            >
              <ArrowLeft />返回權限管理
            </Link>
            <div className="mt-4 flex items-start gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl" style={{ color: "var(--primary)", background: "var(--primary-dim)" }}>
                <ShieldPlus />
              </span>
              <div>
                <h1 className="text-xl font-semibold text-balance" style={{ color: "var(--text-primary)" }}>建立職位</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
                  先選組織，再從組織預設權限開始調整。職位建立後，持有人會取得下方顯示的最終權限。
                </p>
              </div>
            </div>
          </div>
          {selectedOrg && (
            <div className="rounded-xl px-4 py-3 sm:min-w-56" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>目前組織預設</p>
              <p className="mt-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{selectedOrg.name}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{defaultCodes.length} 個預設權限</p>
            </div>
          )}
        </div>

        {loading ? (
          <div className="rounded-xl p-6 text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>載入組織與權限設定中...</div>
        ) : (
          <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
            <div className="space-y-5">
              <section className="rounded-xl p-4 sm:p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                <div className="mb-4">
                  <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>職位基本資料</h2>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>這些欄位會影響職位在組織架構與任期管理中的呈現。</p>
                </div>
                <div className="space-y-4">
                  <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    所屬組織
                    <SelectInput value={orgId} onChange={(event) => setOrgId(event.target.value)} className="mt-1.5" required>
                      <option value="">選擇組織</option>
                      {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                    </SelectInput>
                  </label>
                  <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    職位名稱
                    <TextInput value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5" placeholder="例：網站管理員" required autoFocus />
                  </label>
                  <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    職位說明
                    <TextInput value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5" placeholder="簡述這個職位負責的工作" />
                  </label>
                  <div>
                    <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>職位分類</p>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                      {CATEGORY_OPTIONS.map((option) => {
                        const active = category === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setCategory(option.value)}
                            className="min-h-20 rounded-lg px-3 py-2 text-left transition-colors"
                            style={{
                              border: `1px solid ${active ? "var(--border-strong)" : "var(--border)"}`,
                              background: active ? "var(--primary-dim)" : "var(--bg-base)",
                              color: active ? "var(--primary)" : "var(--text-secondary)",
                            }}
                          >
                            <span className="block text-xs font-semibold">{option.label}</span>
                            <span className="mt-1 block text-[11px] leading-4" style={{ color: active ? "var(--primary)" : "var(--text-muted)" }}>{option.description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      權重
                      <TextInput type="number" min={0} value={weight} onChange={(event) => setWeight(Number(event.target.value) || 0)} className="mt-1.5" />
                      <span className="mt-1 block text-[11px] font-normal" style={{ color: "var(--text-muted)" }}>數字越大，同組織內順位越高。</span>
                    </label>
                    <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                      上級職位
                      <SelectInput value={parentId} onChange={(event) => setParentId(event.target.value)} className="mt-1.5">
                        <option value="">無上級</option>
                        {orgPositions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
                      </SelectInput>
                    </label>
                  </div>
                </div>
              </section>

              <section className="rounded-xl p-4 sm:p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>權限覆寫摘要</h2>
                    <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>組織預設會先套用到職位；下方權限清單的勾選結果就是這個職位最後會取得的權限。</p>
                  </div>
                  <button type="button" onClick={() => setCodes(defaultCodes)} className="min-h-11 flex-shrink-0 rounded-lg px-3 text-xs font-medium" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>重設預設</button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <SummaryCell label="最終權限" value={codes.length} />
                  <SummaryCell label="新增" value={addedCodes.length} tone="positive" />
                  <SummaryCell label="移除" value={removedCodes.length} tone="warning" />
                </div>
                {(addedCodes.length > 0 || removedCodes.length > 0) && (
                  <div className="mt-3 space-y-2 text-xs">
                    {addedCodes.length > 0 && <OverrideRow label="職位新增" codes={addedCodes} labelFor={labelFor} tone="positive" />}
                    {removedCodes.length > 0 && <OverrideRow label="職位移除" codes={removedCodes} labelFor={labelFor} tone="warning" />}
                  </div>
                )}
              </section>
            </div>

            <section className="rounded-xl p-4 sm:p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>職位權限</h2>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>勾選或取消勾選即可覆寫組織預設，不需要手動記住權限代碼。</p>
                </div>
                <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: "var(--primary)", background: "var(--primary-dim)" }}>{codes.length} 個</span>
              </div>
              <PermCheckboxes selected={codes} onChange={setCodes} permCodes={permCodes} />
            </section>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end lg:col-span-2">
              <Link href="/admin/permissions" className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium no-underline" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>取消</Link>
              <button type="submit" disabled={saving || !selectedOrg} className="inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ color: "var(--primary-contrast, white)", background: "var(--primary)" }}>
                {saving ? "建立中..." : "建立職位"}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

function SummaryCell({ label, value, tone = "normal" }: { label: string; value: number; tone?: "normal" | "positive" | "warning" }) {
  const color = tone === "positive" ? "#15803d" : tone === "warning" ? "#b45309" : "var(--text-primary)";
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg-base)", border: "1px solid var(--border)" }}>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-0.5 text-lg font-semibold" style={{ color }}>{value}</p>
    </div>
  );
}

function OverrideRow({ label, codes, labelFor, tone }: { label: string; codes: string[]; labelFor: (code: string) => string; tone: "positive" | "warning" }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 flex-shrink-0 pt-1 font-medium" style={{ color: tone === "positive" ? "#15803d" : "#b45309" }}>{label}</span>
      <div className="flex flex-wrap gap-1">
        {codes.map((code) => <span key={code} className="rounded-full px-2 py-1 text-[11px]" title={code} style={{ color: tone === "positive" ? "#15803d" : "#b45309", background: tone === "positive" ? "rgba(21,128,61,0.1)" : "rgba(180,83,9,0.1)" }}>{labelFor(code)}</span>)}
      </div>
    </div>
  );
}
