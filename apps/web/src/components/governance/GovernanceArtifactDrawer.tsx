"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import Drawer from "@/components/ui/Drawer";
import { usePermissions } from "@/hooks/usePermissions";
import { governanceApi } from "@/lib/api";
import type {
  EntityRelationOut,
  GovernanceModuleCapabilityOut,
  GovernanceResourceSearchOut,
  MatterOut,
  MatterSpawnKind,
  MatterSpawnResult,
} from "@/lib/types";

type DrawerMode = "create" | "link";

export default function GovernanceArtifactDrawer({
  open,
  mode,
  matter,
  onClose,
  onLinked,
  onSpawned,
}: {
  open: boolean;
  mode: DrawerMode;
  matter: MatterOut;
  onClose: () => void;
  onLinked: (relation: EntityRelationOut) => void;
  onSpawned: (result: MatterSpawnResult) => void;
}) {
  const router = useRouter();
  const { canAny, isAdmin } = usePermissions();
  const [capabilities, setCapabilities] = useState<GovernanceModuleCapabilityOut[]>([]);
  const [selected, setSelected] = useState<GovernanceModuleCapabilityOut | null>(null);
  const [title, setTitle] = useState(matter.title);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GovernanceResourceSearchOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentKeys, setRecentKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!open || capabilities.length > 0) return;
    governanceApi.moduleCapabilities().then(setCapabilities).catch(() => {
      toast.error("無法載入模組清單");
    });
  }, [capabilities.length, open]);

  useEffect(() => {
    if (!open) return;
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem("governance.recent-modules") || "[]",
      );
      setRecentKeys(Array.isArray(parsed) ? parsed.slice(0, 6) : []);
    } catch {
      setRecentKeys([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setResults([]);
      setQuery("");
      setTitle(matter.title);
    }
  }, [matter.title, open]);

  const visible = useMemo(
    () =>
      capabilities.filter((item) => {
        if (mode === "create" && item.create_mode === "link") return false;
        if (mode === "link" && !item.searchable) return false;
        return (
          isAdmin ||
          item.permission_codes.length === 0 ||
          canAny(...item.permission_codes)
        );
      }),
    [canAny, capabilities, isAdmin, mode],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, GovernanceModuleCapabilityOut[]>();
    const recent = recentKeys
      .map((key) => visible.find((item) => item.key === key))
      .filter((item): item is GovernanceModuleCapabilityOut => Boolean(item));
    if (recent.length > 0) groups.set("最近使用", recent);
    for (const item of visible) {
      if (recentKeys.includes(item.key)) continue;
      const rows = groups.get(item.category) ?? [];
      rows.push(item);
      groups.set(item.category, rows);
    }
    return groups;
  }, [recentKeys, visible]);

  const guidedHrefFor = (item: GovernanceModuleCapabilityOut) =>
    `${item.href}${item.href.includes("?") ? "&" : "?"}${new URLSearchParams({
      governance_matter_id: matter.id,
      ...(matter.slug ? { governance_matter_slug: matter.slug } : {}),
      title: matter.title,
      ...(matter.org_id ? { org_id: matter.org_id } : {}),
    }).toString()}`;

  const selectModule = (item: GovernanceModuleCapabilityOut) => {
    const nextRecent = [item.key, ...recentKeys.filter((key) => key !== item.key)].slice(0, 6);
    setRecentKeys(nextRecent);
    window.localStorage.setItem("governance.recent-modules", JSON.stringify(nextRecent));
    if (mode === "create" && item.create_mode === "guided") {
      router.push(guidedHrefFor(item));
      onClose();
      return;
    }
    setSelected(item);
    if (mode === "link") void search(item);
  };

  const quickCreate = async () => {
    if (!selected || selected.create_mode !== "quick" || !title.trim()) return;
    setLoading(true);
    try {
      const result = await governanceApi.spawn(matter.id, {
        kind: selected.key as MatterSpawnKind,
        title: title.trim(),
      });
      onSpawned(result);
      toast.success(`已建立並連動：${result.title}`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立失敗");
    } finally {
      setLoading(false);
    }
  };

  const search = async (module: GovernanceModuleCapabilityOut = selected!) => {
    if (!module) return;
    setLoading(true);
    try {
      setResults(await governanceApi.searchResources(module.key, query.trim()));
    } catch {
      toast.error("搜尋資源失敗");
    } finally {
      setLoading(false);
    }
  };

  const linkResource = async (resource: GovernanceResourceSearchOut) => {
    setLoading(true);
    try {
      const relation = await governanceApi.createRelation(matter.id, {
        case_id: null,
        source_type: "matter",
        source_id: matter.id,
        target_type: resource.kind,
        target_id: resource.id,
        relation: "includes",
        title: resource.title,
        href: resource.href,
        note: "從事情中心搜尋並連接",
        meta: { linked_from: "governance_workspace" },
      });
      onLinked(relation);
      toast.success(`已連接：${resource.title}`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立關聯失敗");
    } finally {
      setLoading(false);
    }
  };

  const guidedHref = selected ? guidedHrefFor(selected) : "";

  return (
    <Drawer
      open={open}
      title={mode === "create" ? "建立新項目" : "連接既有項目"}
      onClose={onClose}
      side="auto"
      width="560px"
      sheetHeight="92vh"
    >
      {!selected ? (
        <div className="space-y-5">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {mode === "create"
              ? "選擇模組。任務可直接建立，其他項目會帶入事情資料前往原本的完整表單。"
              : "選擇資料類型後，以名稱搜尋並連接既有項目。"}
          </p>
          {[...grouped.entries()].map(([category, items]) => (
            <section key={category}>
              <h3 className="mb-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                {category}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {items.map((item) => {
                  const disabled = item.requires_org && !matter.org_id;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => selectModule(item)}
                      className="min-h-20 rounded-lg p-3 text-left transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                      style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
                      title={disabled ? "請先為事情設定負責組織" : undefined}
                    >
                      <span className="flex items-center justify-between gap-2">
                        {mode === "create" ? <Plus size={16} /> : <Link2 size={16} />}
                        <ArrowRight size={13} style={{ color: "var(--text-muted)" }} />
                      </span>
                      <span className="mt-2 block text-sm font-medium">{item.label}</span>
                      <span className="mt-1 block text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {disabled
                          ? "需要負責組織"
                          : item.create_mode === "quick"
                            ? "快速建立"
                            : item.create_mode === "guided"
                              ? "完整表單"
                              : "搜尋連接"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            className="text-sm font-medium"
            style={{ color: "var(--primary)" }}
            onClick={() => {
              setSelected(null);
              setResults([]);
            }}
          >
            返回模組清單
          </button>
          <div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>已選擇</p>
            <h3 className="mt-1 text-lg font-semibold">{selected.label}</h3>
          </div>

          {mode === "create" && selected.create_mode === "quick" && (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">項目名稱</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="input min-h-11 w-full"
                  autoFocus
                />
              </label>
              <button
                type="button"
                className="btn btn-primary min-h-11 w-full"
                disabled={loading || !title.trim()}
                onClick={() => void quickCreate()}
              >
                {loading && <Loader2 size={15} className="animate-spin" />}
                建立並連動
              </button>
            </div>
          )}

          {mode === "create" && selected.create_mode === "guided" && (
            <div className="rounded-lg p-4" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                此模組需要更多設定。系統會帶入事情名稱、組織與回連識別碼。
              </p>
              <Link href={guidedHref} className="btn btn-primary mt-4 min-h-11 w-full">
                前往完整表單 <ExternalLink size={14} />
              </Link>
            </div>
          )}

          {mode === "link" && (
            <>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void search();
                }}
              >
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="input min-h-11 min-w-0 flex-1"
                  placeholder={`搜尋${selected.label}`}
                  autoFocus
                />
                <button type="submit" className="btn btn-secondary min-h-11" disabled={loading}>
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                  搜尋
                </button>
              </form>
              <div className="space-y-2">
                {results.map((resource) => (
                  <button
                    key={`${resource.kind}-${resource.id}`}
                    type="button"
                    className="flex min-h-16 w-full items-center justify-between gap-3 rounded-lg p-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ border: "1px solid var(--border)" }}
                    disabled={loading}
                    onClick={() => void linkResource(resource)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{resource.title}</span>
                      <span className="mt-1 block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                        {resource.status || resource.summary || selected.label}
                      </span>
                    </span>
                    <Link2 size={15} className="flex-shrink-0" />
                  </button>
                ))}
                {!loading && results.length === 0 && (
                  <p className="rounded-lg p-6 text-center text-sm" style={{ color: "var(--text-muted)", background: "var(--bg-hover)" }}>
                    尚無結果，輸入關鍵字搜尋。
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
