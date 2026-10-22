"use client";

import NumberInput from "@/components/ui/NumberInput";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { seatingApi, shopApi, apiErrorMessage } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Modal from "@/components/ui/Modal";
import MultiCombobox from "@/components/ui/MultiCombobox";
import { ModeTabs, useOrgOptions, usePositionOptions, useUserSearch } from "@/components/ui/targeting";
import type { ComboboxOption } from "@/components/ui/Combobox";
import SeatMapEditor from "@/components/seating/SeatMapEditor";
import type { SeatBookingOut, ProductOut, WaveInput, WaveOut, ZoneListItem, ZoneOut } from "@/lib/types";

type Tab = "seats" | "waves" | "assignments";
type AudienceMode = "all" | "org" | "position" | "user";

// 把後端 audience JSON 轉成編輯狀態
function audienceMode(a: Record<string, unknown>): AudienceMode {
  if (!a || a.include_all) return "all";
  if (Array.isArray(a.user_ids) && a.user_ids.length) return "user";
  if (Array.isArray(a.position_ids) && a.position_ids.length) return "position";
  if (Array.isArray(a.org_ids) && a.org_ids.length) return "org";
  return "all";
}

function AudiencePicker({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [mode, setMode] = useState<AudienceMode>(() => audienceMode(value));
  const [orgId, setOrgId] = useState("");
  const orgOptions = useOrgOptions();
  const posOptions = usePositionOptions(orgId);
  const { results: userResults, search } = useUserSearch();
  const [picked, setPicked] = useState<ComboboxOption[]>([]);

  const emit = (m: AudienceMode, opts: ComboboxOption[]) => {
    if (m === "all") return onChange({ include_all: true });
    const ids = opts.map((o) => o.value);
    if (m === "org") return onChange({ org_ids: ids });
    if (m === "position") return onChange({ position_ids: ids });
    return onChange({ user_ids: ids });
  };

  return (
    <div className="space-y-2">
      <ModeTabs<AudienceMode>
        modes={[
          { key: "all", label: "所有人" },
          { key: "org", label: "指定組織" },
          { key: "position", label: "指定職位" },
          { key: "user", label: "指定成員" },
        ]}
        value={mode}
        onChange={(m) => { setMode(m); setPicked([]); emit(m, []); }}
      />
      {mode === "position" && (
        <select className="input text-xs" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">先選組織以載入職位…</option>
          {orgOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {mode === "org" && (
        <MultiCombobox selected={picked} options={orgOptions}
          onChange={(s) => { setPicked(s); emit("org", s); }} placeholder="選擇組織" />
      )}
      {mode === "position" && orgId && (
        <MultiCombobox selected={picked} options={posOptions}
          onChange={(s) => { setPicked(s); emit("position", s); }} placeholder="選擇職位" />
      )}
      {mode === "user" && (
        <MultiCombobox selected={picked} options={userResults} onSearch={search}
          onChange={(s) => { setPicked(s); emit("user", s); }} placeholder="搜尋成員（≥2 字）" />
      )}
      {mode === "all" && <p className="text-xs" style={{ color: "var(--text-muted)" }}>此時段開放給所有人。</p>}
    </div>
  );
}

function WaveEditor({ zone, onSaved }: { zone: ZoneOut; onSaved: (z: ZoneOut) => void }) {
  const [waves, setWaves] = useState<WaveInput[]>(() =>
    [...zone.waves].sort((a, b) => a.sort_order - b.sort_order).map((w: WaveOut) => ({
      id: w.id, name: w.name, starts_at: w.starts_at, audience: w.audience || {}, sort_order: w.sort_order,
    })),
  );
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<WaveInput>) =>
    setWaves((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  const add = () =>
    setWaves((prev) => [...prev, { id: null, name: `第 ${prev.length + 1} 波`, starts_at: null, audience: { include_all: true }, sort_order: prev.length }]);
  const remove = (i: number) => setWaves((prev) => prev.filter((_, idx) => idx !== i).map((w, idx) => ({ ...w, sort_order: idx })));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= waves.length) return;
    setWaves((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((w, idx) => ({ ...w, sort_order: idx }));
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await seatingApi.saveWaves(zone.id, { waves });
      toast.success("已儲存分批開放時段");
      onSaved(updated);
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
    } finally {
      setSaving(false);
    }
  };

  const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        依序設定各批次的開放時間與對象，先開放的批次先選位。未設任何批次＝開放後所有人皆可立即劃位。
      </p>
      {waves.map((w, i) => (
        <div key={w.id ?? `new-${i}`} className="rounded-lg p-3 space-y-2"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>#{i + 1}</span>
            <input className="input text-sm flex-1" value={w.name}
              onChange={(e) => update(i, { name: e.target.value })} placeholder="批次名稱" />
            <button type="button" className="btn btn-ghost text-xs" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => move(i, 1)} disabled={i === waves.length - 1}>↓</button>
            <button type="button" className="btn btn-ghost text-xs" style={{ color: "var(--danger,#c0392b)" }} onClick={() => remove(i)}>移除</button>
          </div>
          <label className="text-xs block" style={{ color: "var(--text-muted)" }}>
            開放時間
            <input type="datetime-local" className="input text-sm block mt-1" value={toLocalInput(w.starts_at ?? null)}
              onChange={(e) => update(i, { starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </label>
          <AudiencePicker value={w.audience ?? {}} onChange={(a) => update(i, { audience: a })} />
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={add}>＋ 新增批次</button>
        <button type="button" className="btn btn-primary text-xs" onClick={save} disabled={saving}>
          {saving ? "儲存中…" : "儲存時段"}
        </button>
      </div>
    </div>
  );
}

function AssignmentsPanel({ zone }: { zone: ZoneOut }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<SeatBookingOut[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    seatingApi.zoneAssignments(zone.id).then((r) => setRows(r)).catch(() => setRows([])).finally(() => setLoading(false));
  }, [zone.id]);
  useEffect(load, [load]);

  const release = async (id: string) => {
    if (!(await confirm({
      title: "釋放此劃位？",
      description: "座位會回到可選狀態，並可能被其他人重新選取。",
      confirmLabel: "釋放座位",
      danger: true,
    }))) return;
    try {
      await seatingApi.releaseAssignment(id);
      toast.success("已釋放");
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "釋放失敗"));
    }
  };

  if (loading) return <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!rows.length) return <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無劃位紀錄。</p>;
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <span className="font-mono font-semibold" style={{ color: "var(--primary)" }}>{r.seat_label}</span>
          <span>{r.user_name ?? r.user_id.slice(0, 8)}</span>
          {r.assigned_by_id && <span className="text-xs" style={{ color: "var(--text-muted)" }}>（代劃）</span>}
          <div className="flex-1" />
          <button type="button" className="btn btn-ghost text-xs" style={{ color: "var(--danger,#c0392b)" }}
            onClick={() => release(r.id)}>釋放</button>
        </div>
      ))}
    </div>
  );
}

export default function ProductSeatingPage() {
  const confirm = useConfirm();
  const { productId } = useParams<{ productId: string }>();
  const { can } = usePermissions();
  const allowed = can("seating:manage");

  const [product, setProduct] = useState<ProductOut | null>(null);
  const [zones, setZones] = useState<ZoneListItem[]>([]);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [zonesError, setZonesError] = useState(false);
  const [productError, setProductError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeZone, setActiveZone] = useState<ZoneOut | null>(null);
  const [tab, setTab] = useState<Tab>("seats");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", starts_at: "", seating_opens_at: "", hold_minutes: 10 });

  const loadZones = useCallback(() => {
    setZonesLoading(true);
    setZonesError(false);
    return seatingApi.listZones(productId).then(setZones)
      .catch(() => setZonesError(true))
      .finally(() => setZonesLoading(false));
  }, [productId]);

  const loadProduct = useCallback(() => {
    setProductError(false);
    shopApi.getProduct(productId).then(setProduct).catch(() => setProductError(true));
  }, [productId]);

  useEffect(() => {
    if (!allowed) return;
    loadProduct();
    loadZones();
  }, [allowed, loadProduct, loadZones]);

  const openZone = async (zoneId: string) => {
    try {
      const z = await seatingApi.getZone(zoneId);
      setActiveZone(z);
      setTab("seats");
    } catch (e) {
      toast.error(apiErrorMessage(e, "讀取場次失敗"));
    }
  };

  const createZone = async () => {
    if (creating) return;
    if (!form.name.trim()) { toast.error("請填場次名稱"); return; }
    setCreating(true);
    try {
      const z = await seatingApi.createZone({
        product_id: productId,
        name: form.name.trim(),
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        seating_opens_at: form.seating_opens_at ? new Date(form.seating_opens_at).toISOString() : null,
        hold_minutes: form.hold_minutes,
        sort_order: zones.length,
      });
      setShowCreate(false);
      setForm({ name: "", starts_at: "", seating_opens_at: "", hold_minutes: 10 });
      loadZones();
      openZone(z.id);
      toast.success("已建立場次");
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立失敗"));
    } finally {
      setCreating(false);
    }
  };

  const deleteZone = async (zoneId: string) => {
    if (!(await confirm({
      title: "刪除此場次？",
      description: "場次與相關劃位設定將被移除，無法復原。",
      confirmLabel: "刪除場次",
      danger: true,
    }))) return;
    try {
      await seatingApi.deleteZone(zoneId);
      if (activeZone?.id === zoneId) setActiveZone(null);
      loadZones();
      toast.success("已刪除");
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };

  const onZoneSaved = (z: ZoneOut) => { setActiveZone(z); loadZones(); };

  const tabs = useMemo(() => ([
    { key: "seats" as Tab, label: "座位圖" },
    { key: "waves" as Tab, label: "分批開放時段" },
    { key: "assignments" as Tab, label: "已劃位" },
  ]), []);

  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p style={{ color: "var(--text-muted)" }}>目前帳號無法管理劃位，請聯繫管理員確認是否已授權。</p>
        <Link href="/shop/admin" className="btn btn-ghost text-sm mt-3">← 返回商品管理</Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/shop/admin" className="btn btn-ghost min-h-11 text-sm">返回商品管理</Link>
        <div>
          <h1 className="text-lg font-bold">劃位管理</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{product?.name ?? (productError ? "商品資料未載入" : "正在載入商品…")}</p>
        </div>
        <div className="flex-1" />
        <button type="button" className="btn btn-primary min-h-11 text-sm" onClick={() => setShowCreate(true)}>新增場次</button>
      </div>

      {productError && <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
        無法載入商品資料。<button type="button" className="btn btn-ghost min-h-11" onClick={loadProduct}>重新載入商品</button>
      </div>}
      {zonesError && <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
        無法載入場次，請重新載入後再操作。<button type="button" className="btn btn-ghost min-h-11" onClick={loadZones}>重新載入場次</button>
      </div>}
      {zonesLoading && <p role="status" className="text-sm">正在載入場次…</p>}

      {/* 場次清單 */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="場次清單">
        {!zonesError && !zonesLoading && <>
        {zones.map((z) => (
          <div key={z.id}
            className="flex items-start gap-2 rounded-xl p-3 transition-colors"
            style={{
              background: activeZone?.id === z.id ? "var(--bg-elevated)" : "var(--bg-base)",
              border: `1px solid ${activeZone?.id === z.id ? "var(--primary)" : "var(--border)"}`,
            }}>
            <button type="button" onClick={() => openZone(z.id)} aria-pressed={activeZone?.id === z.id} aria-label={`開啟場次：${z.name}`}
              className="min-h-11 min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--primary)]">
              <span className="block break-words text-sm font-semibold">{z.name}</span>
            {z.starts_at && (
              <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>
                {new Date(z.starts_at).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}
              </span>
            )}
              <span className="mt-1 block text-xs" style={{ color: "var(--text-secondary)" }}>
                共 {z.seat_count} 席 · 可選 {z.available_count} 席 · 已劃 {z.assigned_count} 席
              </span>
            </button>
            <button type="button" className="min-h-11 min-w-11 shrink-0 text-xs" style={{ color: "var(--danger)" }}
              aria-label={`刪除場次：${z.name}`} onClick={() => deleteZone(z.id)}>刪除</button>
          </div>
        ))}
        {!zones.length && (
          <p className="text-sm col-span-full" style={{ color: "var(--text-muted)" }}>尚無場次，按「新增場次」建立第一張座位圖。</p>
        )}
        </>}
      </div>

      {/* 場次編輯 */}
      {activeZone && !zonesError && (
        <div className="rounded-xl p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
          <nav className="module-tabs-scroll max-w-full overflow-x-auto" aria-label="座位管理分頁">
            <div className="module-tabs-list">
            {tabs.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
                className={`module-tab-link cursor-pointer${tab === t.key ? " is-active" : ""}`}>
                <span>{t.label}</span>
              </button>
            ))}
            </div>
          </nav>
          {tab === "seats" && (
            <div key="seats" className="tab-panel-transition">
              <SeatMapEditor zone={activeZone} onSaved={onZoneSaved} />
            </div>
          )}
          {tab === "waves" && (
            <div key="waves" className="tab-panel-transition">
              <WaveEditor zone={activeZone} onSaved={onZoneSaved} />
            </div>
          )}
          {tab === "assignments" && (
            <div key="assignments" className="tab-panel-transition">
              <AssignmentsPanel zone={activeZone} />
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <Modal title="新增場次" size="md" onClose={() => { if (!creating) setShowCreate(false); }}
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" disabled={creating} className="btn btn-ghost min-h-11 text-sm" onClick={() => setShowCreate(false)}>取消</button>
              <button type="button" disabled={creating} className="btn btn-primary min-h-11 text-sm" onClick={createZone}>{creating ? "建立中…" : "建立場次"}</button>
            </div>
          }>
          <div className="space-y-3">
            <label className="block text-sm">場次名稱
              <input className="input mt-1 w-full" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 19:00 場 / 一樓" />
            </label>
            <label className="block text-sm">開演時間（選填）
              <input type="datetime-local" className="input mt-1 w-full" value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
            </label>
            <label className="block text-sm">自助劃位開放時間（選填）
              <input type="datetime-local" className="input mt-1 w-full" value={form.seating_opens_at}
                onChange={(e) => setForm({ ...form, seating_opens_at: e.target.value })} />
            </label>
            <label className="block text-sm">選位暫時保留時間（分鐘）
              <NumberInput type="number" min={1} max={120} className="input mt-1 w-full" value={form.hold_minutes}
                onChange={(e) => setForm({ ...form, hold_minutes: Number(e.target.value) || 10 })} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
