"use client";

import { useMemo, useState } from "react";
import { Monitor, Phone, ShieldCheck, SlidersHorizontal } from "lucide-react";
import NavIcon from "@/components/layout/NavIcon";
import { usePermissions } from "@/hooks/usePermissions";
import {
  isSection,
  NAV_ITEMS_BY_ID,
  NAVIGATION_PROFILES,
  resolveNavigationProfile,
  type NavigationProfile,
} from "@/lib/navigation";

const SAMPLE_PERMISSIONS: Record<NavigationProfile, string[]> = {
  default: ["document:create", "regulation:publish", "audit:view"],
  teacher: ["class:shop_collect", "exam:manage", "survey:review"],
  mealVendor: ["meal:manage"],
};

export default function NavigationProfilesPage() {
  const { isAdmin, permissions } = usePermissions();
  const [selected, setSelected] = useState<NavigationProfile>("teacher");

  const activeProfile = NAVIGATION_PROFILES[selected];
  const currentProfile = useMemo(
    () => resolveNavigationProfile(permissions, isAdmin),
    [isAdmin, permissions],
  );

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card p-8 text-center">
          <ShieldCheck className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold">需要管理員權限</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <SlidersHorizontal size={14} aria-hidden />
            角色視角 / 導覽設定檔
          </div>
          <h1 className="text-2xl font-bold">視角管理</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">
            視角決定登入後的側邊欄、手機底欄與預設工作台入口；實際操作權限仍由 RBAC 與 API 授權控管。
          </p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm">
          你目前預覽為：
          <span className="ml-1 font-semibold text-[var(--primary)]">
            {NAVIGATION_PROFILES[currentProfile].label}
          </span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-2">
          {(Object.keys(NAVIGATION_PROFILES) as NavigationProfile[]).map((profileId) => {
            const profile = NAVIGATION_PROFILES[profileId];
            const active = selected === profileId;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => setSelected(profile.id)}
                className="w-full rounded-md border px-4 py-3 text-left transition-colors"
                style={{
                  background: active ? "var(--primary-dim)" : "var(--bg-surface)",
                  borderColor: active ? "var(--primary)" : "var(--border)",
                }}
              >
                <div className="font-semibold text-[var(--text-primary)]">{profile.label}</div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">{profile.audience}</div>
              </button>
            );
          })}
        </aside>

        <section className="space-y-4">
          <div className="card p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{activeProfile.label}</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{activeProfile.description}</p>
              </div>
              <div className="rounded-md bg-[var(--bg-muted)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                適用：{activeProfile.audience}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <RulePanel profileId={selected} />
            <SamplePanel profileId={selected} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <PreviewPanel
              title="左側欄預覽"
              icon={<Monitor size={16} aria-hidden />}
              items={activeProfile.desktopSections.flatMap((entry) =>
                isSection(entry) ? entry.items : [entry],
              )}
            />
            <PreviewPanel
              title="手機底欄預覽"
              icon={<Phone size={16} aria-hidden />}
              items={activeProfile.mobileOrder
                .map((id) => NAV_ITEMS_BY_ID[id])
                .filter((item): item is NonNullable<typeof item> => Boolean(item))}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function RulePanel({ profileId }: { profileId: NavigationProfile }) {
  const profile = NAVIGATION_PROFILES[profileId];
  const hasRules =
    (profile.matchAnyPrefixes?.length ?? 0) > 0
    || (profile.matchAnyPermissions?.length ?? 0) > 0
    || (profile.excludePrefixes?.length ?? 0) > 0;

  return (
    <section className="card p-5">
      <h3 className="font-semibold">套用規則</h3>
      {!hasRules ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">預設視角，未符合其他專屬視角時套用。</p>
      ) : (
        <div className="mt-3 space-y-3">
          <ChipGroup label="符合任一權限前綴" values={profile.matchAnyPrefixes ?? []} />
          <ChipGroup label="符合任一完整權限" values={profile.matchAnyPermissions ?? []} />
          <ChipGroup label="排除權限前綴" values={profile.excludePrefixes ?? []} tone="warning" />
        </div>
      )}
    </section>
  );
}

function SamplePanel({ profileId }: { profileId: NavigationProfile }) {
  const sample = SAMPLE_PERMISSIONS[profileId];
  const resolved = resolveNavigationProfile(new Set(sample), false);
  return (
    <section className="card p-5">
      <h3 className="font-semibold">範例權限</h3>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {sample.map((code) => (
          <code key={code} className="rounded bg-[var(--bg-muted)] px-2 py-1 text-xs">
            {code}
          </code>
        ))}
      </div>
      <p className="mt-3 text-sm text-[var(--text-muted)]">
        判定結果：
        <span className="font-semibold text-[var(--primary)]">
          {NAVIGATION_PROFILES[resolved].label}
        </span>
      </p>
    </section>
  );
}

function PreviewPanel({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ id: string; label: string; iconKey: string; href: string }>;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
        {icon}
        <h3 className="font-semibold">{title}</h3>
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

function ChipGroup({
  label,
  values,
  tone = "default",
}: {
  label: string;
  values: string[];
  tone?: "default" | "warning";
}) {
  if (values.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-[var(--text-muted)]">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <code
            key={value}
            className="rounded px-2 py-1 text-xs"
            style={{
              background: tone === "warning" ? "var(--warning-dim)" : "var(--bg-muted)",
              color: tone === "warning" ? "var(--warning)" : "var(--text-secondary)",
            }}
          >
            {value}
          </code>
        ))}
      </div>
    </div>
  );
}
