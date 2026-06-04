"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SeatInput, SeatOut, SeatStatus, ZoneOut } from "@/lib/types";
import { seatingApi, ApiError } from "@/lib/api";

/**
 * 自由拖拉座位圖編輯器。
 *
 * 座位以畫布絕對座標 (x,y) 擺放，可框選/拖移/批次設定類型・票價・狀態，
 * 並支援「快速產生一排」。儲存時整批覆蓋（PUT /seating/zones/{id}/seats）。
 */

const GRID = 16; // 對齊格點（px）
const SEAT = 34; // 座位顯示尺寸（px）

type EditSeat = SeatInput & { key: string };

const STATUS_LABEL: Record<SeatStatus, string> = {
  available: "可選",
  disabled: "走道",
  blocked: "封鎖",
};

const SEAT_TYPES = [
  { value: "normal", label: "一般" },
  { value: "vip", label: "VIP" },
  { value: "wheelchair", label: "無障礙" },
];

function seatColor(s: EditSeat, selected: boolean): React.CSSProperties {
  if (selected) return { background: "var(--primary)", color: "#1a1a2e", borderColor: "var(--primary)" };
  if (s.status === "disabled") return { background: "transparent", color: "var(--text-muted)", borderStyle: "dashed", borderColor: "var(--border)" };
  if (s.status === "blocked") return { background: "var(--bg-elevated)", color: "var(--text-muted)", borderColor: "var(--danger, #c0392b)" };
  if (s.seat_type === "vip") return { background: "rgba(212,175,55,0.18)", color: "var(--text-primary)", borderColor: "var(--primary)" };
  return { background: "var(--bg-elevated)", color: "var(--text-primary)", borderColor: "var(--border)" };
}

function toEdit(seats: SeatOut[]): EditSeat[] {
  return seats.map((s) => ({
    key: s.id,
    id: s.id,
    label: s.label,
    block: s.block,
    row_label: s.row_label,
    x: s.x,
    y: s.y,
    seat_type: s.seat_type,
    price_delta: s.price_delta,
    status: s.status,
  }));
}

export default function SeatMapEditor({
  zone,
  onSaved,
}: {
  zone: ZoneOut;
  onSaved?: (z: ZoneOut) => void;
}) {
  const layout = (zone.layout || {}) as { width?: number; height?: number };
  const [width, setWidth] = useState<number>(layout.width || 760);
  const [height, setHeight] = useState<number>(layout.height || 460);
  const [seats, setSeats] = useState<EditSeat[]>(() => toEdit(zone.seats));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ key: string; startX: number; startY: number; origins: Map<string, { x: number; y: number }> } | null>(null);
  const seatCounter = useRef(0);

  const mutate = useCallback((fn: (prev: EditSeat[]) => EditSeat[]) => {
    setSeats(fn);
    setDirty(true);
  }, []);

  const snap = (n: number) => Math.max(0, Math.round(n / GRID) * GRID);

  // ── 新增 / 批次產生 ─────────────────────────────────────────────────────────
  const addSeat = () => {
    const key = `new-${seatCounter.current++}`;
    mutate((prev) => [
      ...prev,
      { key, id: null, label: `S${prev.length + 1}`, block: null, row_label: null, x: snap(width / 2), y: snap(height / 2), seat_type: "normal", price_delta: 0, status: "available" },
    ]);
    setSelected(new Set([key]));
  };

  const addRow = () => {
    const prefix = window.prompt("排代號（例如 A）", "A");
    if (prefix === null) return;
    const count = Number(window.prompt("此排座位數", "10"));
    if (!Number.isFinite(count) || count <= 0) return;
    const startY = snap(40 + seats.length * 0);
    const baseY = seats.length ? snap(Math.max(...seats.map((s) => s.y)) + SEAT + GRID) : snap(60);
    const added: EditSeat[] = [];
    for (let i = 0; i < count; i++) {
      added.push({
        key: `new-${seatCounter.current++}`,
        id: null,
        label: `${prefix}${i + 1}`,
        block: null,
        row_label: prefix,
        x: snap(40 + i * (SEAT + 6)),
        y: baseY || startY,
        seat_type: "normal",
        price_delta: 0,
        status: "available",
      });
    }
    mutate((prev) => [...prev, ...added]);
    setSelected(new Set(added.map((s) => s.key)));
  };

  // ── 選取 ────────────────────────────────────────────────────────────────────
  const toggleSelect = (key: string, additive: boolean) => {
    setSelected((prev) => {
      const next = new Set(additive ? prev : []);
      if (prev.has(key) && additive) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── 拖移 ─────────────────────────────────────────────────────────────────────
  const onSeatPointerDown = (e: React.PointerEvent, key: string) => {
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!selected.has(key)) toggleSelect(key, additive);
    const active = selected.has(key) || true;
    const keys = active && selected.size && selected.has(key) ? selected : new Set([key]);
    const origins = new Map<string, { x: number; y: number }>();
    seats.forEach((s) => { if (keys.has(s.key)) origins.set(s.key, { x: s.x, y: s.y }); });
    dragState.current = { key, startX: e.clientX, startY: e.clientY, origins };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    mutate((prev) =>
      prev.map((s) => {
        const o = ds.origins.get(s.key);
        if (!o) return s;
        return { ...s, x: snap(o.x + dx), y: snap(o.y + dy) };
      }),
    );
  };

  const onCanvasPointerUp = () => { dragState.current = null; };

  // ── 批次屬性 ─────────────────────────────────────────────────────────────────
  const selectedSeats = useMemo(() => seats.filter((s) => selected.has(s.key)), [seats, selected]);
  const applyToSelected = (patch: Partial<EditSeat>) => {
    if (!selected.size) return;
    mutate((prev) => prev.map((s) => (selected.has(s.key) ? { ...s, ...patch } : s)));
  };
  const deleteSelected = () => {
    if (!selected.size) return;
    mutate((prev) => prev.filter((s) => !selected.has(s.key)));
    setSelected(new Set());
  };
  const relabelSelected = () => {
    const v = window.prompt("套用代號（多選時自動加序號，如 A → A1 A2 …）", selectedSeats[0]?.label ?? "");
    if (v === null) return;
    const list = selectedSeats;
    mutate((prev) =>
      prev.map((s) => {
        const idx = list.findIndex((x) => x.key === s.key);
        if (idx < 0) return s;
        return { ...s, label: list.length > 1 ? `${v}${idx + 1}` : v };
      }),
    );
  };

  // ── 儲存 ─────────────────────────────────────────────────────────────────────
  const save = async () => {
    const labels = seats.map((s) => s.label.trim());
    if (labels.some((l) => !l)) { toast.error("有座位未填代號"); return; }
    if (new Set(labels).size !== labels.length) { toast.error("座位代號重複"); return; }
    setSaving(true);
    try {
      const payload = {
        layout: { ...(zone.layout || {}), width, height },
        seats: seats.map((s): SeatInput => ({
          id: s.id, label: s.label, block: s.block, row_label: s.row_label,
          x: s.x, y: s.y, seat_type: s.seat_type, price_delta: s.price_delta, status: s.status,
        })),
      };
      const updated = await seatingApi.saveSeats(zone.id, payload);
      setSeats(toEdit(updated.seats));
      setDirty(false);
      setSelected(new Set());
      toast.success(`已儲存 ${updated.seats.length} 個座位`);
      onSaved?.(updated);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 工具列 */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={addSeat}>＋ 單一座位</button>
        <button type="button" className="btn btn-ghost text-xs" onClick={addRow}>＋ 快速產生一排</button>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          已選 {selected.size} / 共 {seats.length}
        </span>
        <div className="flex-1" />
        <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
          畫布
          <input type="number" value={width} min={200} step={20}
            onChange={(e) => { setWidth(Number(e.target.value) || 200); setDirty(true); }}
            className="input w-20 text-xs" />
          ×
          <input type="number" value={height} min={200} step={20}
            onChange={(e) => { setHeight(Number(e.target.value) || 200); setDirty(true); }}
            className="input w-20 text-xs" />
        </label>
        <button type="button" className="btn btn-primary text-xs" onClick={save} disabled={saving || !dirty}>
          {saving ? "儲存中…" : dirty ? "儲存座位圖" : "已儲存"}
        </button>
      </div>

      {/* 選取屬性列 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg p-2"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost text-xs" onClick={relabelSelected}>設定代號</button>
          <select className="input text-xs" value={selectedSeats[0]?.seat_type ?? "normal"}
            onChange={(e) => applyToSelected({ seat_type: e.target.value })}>
            {SEAT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="input text-xs" value={selectedSeats[0]?.status ?? "available"}
            onChange={(e) => applyToSelected({ status: e.target.value as SeatStatus })}>
            {(["available", "disabled", "blocked"] as SeatStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            加價
            <input type="number" className="input w-20 text-xs" value={selectedSeats[0]?.price_delta ?? 0}
              onChange={(e) => applyToSelected({ price_delta: Number(e.target.value) || 0 })} />
          </label>
          <input className="input w-28 text-xs" placeholder="區塊名稱" value={selectedSeats[0]?.block ?? ""}
            onChange={(e) => applyToSelected({ block: e.target.value || null })} />
          <button type="button" className="btn btn-ghost text-xs" style={{ color: "var(--danger, #c0392b)" }}
            onClick={deleteSelected}>刪除所選</button>
        </div>
      )}

      {/* 畫布 */}
      <div className="overflow-auto rounded-lg" style={{ border: "1px solid var(--border)", maxHeight: 560 }}>
        <div
          ref={canvasRef}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerDown={() => setSelected(new Set())}
          className="relative"
          style={{
            width,
            height,
            background:
              "var(--bg-base) repeating-linear-gradient(0deg, transparent, transparent 15px, rgba(127,127,127,0.08) 15px, rgba(127,127,127,0.08) 16px), repeating-linear-gradient(90deg, transparent, transparent 15px, rgba(127,127,127,0.08) 15px, rgba(127,127,127,0.08) 16px)",
          }}
        >
          {/* 舞台/螢幕標示 */}
          <div className="absolute left-1/2 -translate-x-1/2 rounded text-center text-xs"
            style={{ top: 6, width: Math.min(width - 40, 260), padding: "4px 0", background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            舞台 / 螢幕
          </div>
          {seats.map((s) => (
            <button
              key={s.key}
              type="button"
              onPointerDown={(e) => onSeatPointerDown(e, s.key)}
              title={`${s.label}${s.price_delta ? ` (+${s.price_delta})` : ""}`}
              className="absolute flex items-center justify-center rounded text-[10px] font-medium select-none touch-none"
              style={{
                left: s.x,
                top: s.y,
                width: SEAT,
                height: SEAT,
                border: "1px solid",
                cursor: "grab",
                ...seatColor(s, selected.has(s.key)),
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        點選座位可選取（按住 Shift/Ctrl 多選），拖曳移動；空白處點一下取消選取。走道座位設為「走道」即不可被劃。
      </p>
    </div>
  );
}
