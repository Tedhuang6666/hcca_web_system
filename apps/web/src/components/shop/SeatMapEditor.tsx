"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { DecorationKind, LayoutDecoration, SeatInput, SeatOut, SeatStatus, ZoneOut } from "@/lib/types";
import { seatingApi, apiErrorMessage } from "@/lib/api";

const GRID = 16;
const SEAT = 34;

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

const DECO_TYPES: { value: DecorationKind; label: string; defaultW: number; defaultH: number; defaultLabel: string }[] = [
  { value: "screen", label: "螢幕 / 舞台", defaultW: 260, defaultH: 32, defaultLabel: "螢幕 / 舞台" },
  { value: "door",   label: "出入口 / 門",  defaultW: 56,  defaultH: 32, defaultLabel: "入口" },
  { value: "aisle_h",label: "橫走道",       defaultW: 320, defaultH: 20, defaultLabel: "走道" },
  { value: "aisle_v",label: "縱走道",       defaultW: 20,  defaultH: 200, defaultLabel: "走道" },
  { value: "label",  label: "文字標籤",     defaultW: 120, defaultH: 28, defaultLabel: "區域名稱" },
  { value: "box",    label: "區塊框",       defaultW: 160, defaultH: 100, defaultLabel: "VIP 區" },
];

function seatColor(s: EditSeat, selected: boolean): React.CSSProperties {
  if (selected) return { background: "var(--primary)", color: "#1a1a2e", borderColor: "var(--primary)" };
  if (s.status === "disabled") return { background: "transparent", color: "var(--text-muted)", borderStyle: "dashed", borderColor: "var(--border)" };
  if (s.status === "blocked") return { background: "var(--bg-elevated)", color: "var(--text-muted)", borderColor: "var(--danger, #c0392b)" };
  if (s.seat_type === "vip") return { background: "rgba(212,175,55,0.18)", color: "var(--text-primary)", borderColor: "var(--primary)" };
  return { background: "var(--bg-elevated)", color: "var(--text-primary)", borderColor: "var(--border)" };
}

function decoStyle(d: LayoutDecoration, selected: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    left: d.x,
    top: d.y,
    width: d.width,
    height: d.height,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 500,
    userSelect: "none",
    cursor: "grab",
    boxSizing: "border-box",
    outline: selected ? "2px solid var(--primary)" : undefined,
    outlineOffset: selected ? 2 : undefined,
    zIndex: 1,
  };
  switch (d.type) {
    case "screen":
      return { ...base, background: "var(--bg-elevated)", border: "2px solid var(--border)", color: "var(--text-secondary)", borderRadius: 4 };
    case "door":
      return { ...base, background: "rgba(39,174,96,0.12)", border: "1px dashed #27ae60", color: "#27ae60", borderRadius: 4 };
    case "aisle_h":
      return { ...base, background: "rgba(127,127,127,0.08)", borderTop: "1px dashed var(--border)", borderBottom: "1px dashed var(--border)", color: "var(--text-muted)" };
    case "aisle_v":
      return { ...base, background: "rgba(127,127,127,0.08)", borderLeft: "1px dashed var(--border)", borderRight: "1px dashed var(--border)", color: "var(--text-muted)", fontSize: 10, writingMode: "vertical-rl" };
    case "label":
      return { ...base, background: "transparent", border: "none", color: "var(--text-muted)", fontWeight: 600, textAlign: "center" };
    case "box":
      return { ...base, background: "rgba(127,127,127,0.06)", border: "1px dashed var(--border)", color: "var(--text-secondary)", borderRadius: 6, alignItems: "flex-start", justifyContent: "flex-start", padding: "4px 6px" };
  }
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

function parseDeco(layout: Record<string, unknown>): LayoutDecoration[] {
  const raw = layout.decorations;
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is LayoutDecoration =>
    d && typeof d === "object" && typeof d.id === "string" && typeof d.type === "string"
  );
}

type DragTarget =
  | { target: "seat"; origins: Map<string, { x: number; y: number }> }
  | { target: "deco"; id: string; ox: number; oy: number };

export default function SeatMapEditor({
  zone,
  onSaved,
}: {
  zone: ZoneOut;
  onSaved?: (z: ZoneOut) => void;
}) {
  const layout = (zone.layout || {}) as Record<string, unknown>;
  const [width, setWidth] = useState<number>((layout.width as number) || 760);
  const [height, setHeight] = useState<number>((layout.height as number) || 460);
  const [seats, setSeats] = useState<EditSeat[]>(() => toEdit(zone.seats));
  const [decorations, setDecorations] = useState<LayoutDecoration[]>(() => parseDeco(layout));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedDeco, setSelectedDeco] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showDecoMenu, setShowDecoMenu] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; info: DragTarget } | null>(null);
  const seatCounter = useRef(0);
  const decoCounter = useRef(0);

  const mutateSeats = useCallback((fn: (prev: EditSeat[]) => EditSeat[]) => { setSeats(fn); setDirty(true); }, []);
  const mutateDeco = useCallback((fn: (prev: LayoutDecoration[]) => LayoutDecoration[]) => { setDecorations(fn); setDirty(true); }, []);

  const snap = (n: number) => Math.max(0, Math.round(n / GRID) * GRID);

  // ── 座位 新增 ──────────────────────────────────────────────────────────────
  const addSeat = () => {
    const key = `new-${seatCounter.current++}`;
    mutateSeats((prev) => [
      ...prev,
      { key, id: null, label: `S${prev.length + 1}`, block: null, row_label: null, x: snap(width / 2), y: snap(height / 2), seat_type: "normal", price_delta: 0, status: "available" },
    ]);
    setSelected(new Set([key]));
    setSelectedDeco(null);
  };

  const addRow = () => {
    const prefix = window.prompt("排代號（例如 A）", "A");
    if (prefix === null) return;
    const count = Number(window.prompt("此排座位數", "10"));
    if (!Number.isFinite(count) || count <= 0) return;
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
        y: baseY,
        seat_type: "normal",
        price_delta: 0,
        status: "available",
      });
    }
    mutateSeats((prev) => [...prev, ...added]);
    setSelected(new Set(added.map((s) => s.key)));
    setSelectedDeco(null);
  };

  // ── 裝飾元素 新增 ──────────────────────────────────────────────────────────
  const addDeco = (kind: DecorationKind) => {
    const meta = DECO_TYPES.find((t) => t.value === kind)!;
    const id = `deco-${decoCounter.current++}`;
    const newDeco: LayoutDecoration = {
      id,
      type: kind,
      x: snap((width - meta.defaultW) / 2),
      y: snap(kind === "screen" ? 6 : height / 2 - meta.defaultH / 2),
      width: meta.defaultW,
      height: meta.defaultH,
      label: meta.defaultLabel,
    };
    mutateDeco((prev) => [...prev, newDeco]);
    setSelectedDeco(id);
    setSelected(new Set());
    setShowDecoMenu(false);
  };

  // ── 座位 選取 ──────────────────────────────────────────────────────────────
  const toggleSelect = (key: string, additive: boolean) => {
    setSelectedDeco(null);
    setSelected((prev) => {
      const next = new Set(additive ? prev : []);
      if (prev.has(key) && additive) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── 拖移：座位 ─────────────────────────────────────────────────────────────
  const onSeatPointerDown = (e: React.PointerEvent, key: string) => {
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!selected.has(key)) toggleSelect(key, additive);
    const keys = selected.has(key) && selected.size ? selected : new Set([key]);
    const origins = new Map<string, { x: number; y: number }>();
    seats.forEach((s) => { if (keys.has(s.key)) origins.set(s.key, { x: s.x, y: s.y }); });
    dragState.current = { startX: e.clientX, startY: e.clientY, info: { target: "seat", origins } };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  // ── 拖移：裝飾元素 ─────────────────────────────────────────────────────────
  const onDecoPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setSelectedDeco(id);
    setSelected(new Set());
    const d = decorations.find((x) => x.id === id)!;
    dragState.current = { startX: e.clientX, startY: e.clientY, info: { target: "deco", id, ox: d.x, oy: d.y } };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (ds.info.target === "seat") {
      const { origins } = ds.info;
      mutateSeats((prev) =>
        prev.map((s) => {
          const o = origins.get(s.key);
          if (!o) return s;
          return { ...s, x: snap(o.x + dx), y: snap(o.y + dy) };
        }),
      );
    } else {
      const { id, ox, oy } = ds.info;
      mutateDeco((prev) =>
        prev.map((d) => d.id === id ? { ...d, x: snap(ox + dx), y: snap(oy + dy) } : d)
      );
    }
  };

  const onCanvasPointerUp = () => { dragState.current = null; };

  // ── 座位 批次屬性 ──────────────────────────────────────────────────────────
  const selectedSeats = useMemo(() => seats.filter((s) => selected.has(s.key)), [seats, selected]);
  const applyToSelected = (patch: Partial<EditSeat>) => {
    if (!selected.size) return;
    mutateSeats((prev) => prev.map((s) => (selected.has(s.key) ? { ...s, ...patch } : s)));
  };
  const deleteSelected = () => {
    if (!selected.size) return;
    mutateSeats((prev) => prev.filter((s) => !selected.has(s.key)));
    setSelected(new Set());
  };
  const relabelSelected = () => {
    const v = window.prompt("套用代號（多選時自動加序號，如 A → A1 A2 …）", selectedSeats[0]?.label ?? "");
    if (v === null) return;
    const list = selectedSeats;
    mutateSeats((prev) =>
      prev.map((s) => {
        const idx = list.findIndex((x) => x.key === s.key);
        if (idx < 0) return s;
        return { ...s, label: list.length > 1 ? `${v}${idx + 1}` : v };
      }),
    );
  };

  // ── 裝飾元素 屬性 ──────────────────────────────────────────────────────────
  const activeDeco = decorations.find((d) => d.id === selectedDeco) ?? null;
  const patchDeco = (patch: Partial<LayoutDecoration>) => {
    if (!selectedDeco) return;
    mutateDeco((prev) => prev.map((d) => d.id === selectedDeco ? { ...d, ...patch } : d));
  };
  const deleteDeco = () => {
    if (!selectedDeco) return;
    mutateDeco((prev) => prev.filter((d) => d.id !== selectedDeco));
    setSelectedDeco(null);
  };

  // ── 儲存 ──────────────────────────────────────────────────────────────────
  const save = async () => {
    const labels = seats.map((s) => s.label.trim());
    if (labels.some((l) => !l)) { toast.error("有座位未填代號"); return; }
    if (new Set(labels).size !== labels.length) { toast.error("座位代號重複"); return; }
    setSaving(true);
    try {
      const payload = {
        layout: { ...layout, width, height, decorations },
        seats: seats.map((s): SeatInput => ({
          id: s.id, label: s.label, block: s.block, row_label: s.row_label,
          x: s.x, y: s.y, seat_type: s.seat_type, price_delta: s.price_delta, status: s.status,
        })),
      };
      const updated = await seatingApi.saveSeats(zone.id, payload);
      setSeats(toEdit(updated.seats));
      setDecorations(parseDeco((updated.layout || {}) as Record<string, unknown>));
      setDirty(false);
      setSelected(new Set());
      toast.success(`已儲存 ${updated.seats.length} 個座位`);
      onSaved?.(updated);
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
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

        {/* 裝飾元素下拉 */}
        <div className="relative">
          <button type="button" className="btn btn-ghost text-xs" onClick={() => setShowDecoMenu((v) => !v)}>
            ＋ 裝飾元素 ▾
          </button>
          {showDecoMenu && (
            <div className="absolute left-0 top-full mt-1 z-20 rounded-lg py-1 min-w-[140px]"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", boxShadow: "0 4px 16px rgba(0,0,0,0.18)" }}>
              {DECO_TYPES.map((t) => (
                <button key={t.value} type="button"
                  className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-80"
                  style={{ color: "var(--text-primary)" }}
                  onClick={() => addDeco(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          已選 {selected.size} / 共 {seats.length} 座位｜{decorations.length} 裝飾
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

      {/* 座位屬性列 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg p-2"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>座位</span>
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

      {/* 裝飾元素屬性列 */}
      {activeDeco && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg p-2"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--primary)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
            {DECO_TYPES.find((t) => t.value === activeDeco.type)?.label ?? "裝飾元素"}
          </span>
          <select className="input text-xs" value={activeDeco.type}
            onChange={(e) => patchDeco({ type: e.target.value as DecorationKind })}>
            {DECO_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input className="input w-36 text-xs" placeholder="標籤文字" value={activeDeco.label}
            onChange={(e) => patchDeco({ label: e.target.value })} />
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            寬
            <input type="number" className="input w-16 text-xs" min={10} step={GRID} value={activeDeco.width}
              onChange={(e) => patchDeco({ width: Number(e.target.value) || 10 })} />
          </label>
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            高
            <input type="number" className="input w-16 text-xs" min={10} step={GRID} value={activeDeco.height}
              onChange={(e) => patchDeco({ height: Number(e.target.value) || 10 })} />
          </label>
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            X
            <input type="number" className="input w-16 text-xs" step={GRID} value={activeDeco.x}
              onChange={(e) => patchDeco({ x: snap(Number(e.target.value)) })} />
          </label>
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            Y
            <input type="number" className="input w-16 text-xs" step={GRID} value={activeDeco.y}
              onChange={(e) => patchDeco({ y: snap(Number(e.target.value)) })} />
          </label>
          <button type="button" className="btn btn-ghost text-xs" style={{ color: "var(--danger, #c0392b)" }}
            onClick={deleteDeco}>刪除</button>
        </div>
      )}

      {/* 畫布 */}
      <div className="overflow-auto rounded-lg" style={{ border: "1px solid var(--border)", maxHeight: 560 }}>
        <div
          ref={canvasRef}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerDown={() => { setSelected(new Set()); setSelectedDeco(null); setShowDecoMenu(false); }}
          className="relative"
          style={{
            width,
            height,
            background:
              "var(--bg-base) repeating-linear-gradient(0deg, transparent, transparent 15px, rgba(127,127,127,0.08) 15px, rgba(127,127,127,0.08) 16px), repeating-linear-gradient(90deg, transparent, transparent 15px, rgba(127,127,127,0.08) 15px, rgba(127,127,127,0.08) 16px)",
          }}
        >
          {/* 裝飾元素（在座位下層，以免遮住點擊） */}
          {decorations.map((d) => (
            <div
              key={d.id}
              onPointerDown={(e) => onDecoPointerDown(e, d.id)}
              style={decoStyle(d, selectedDeco === d.id)}
              title={`${DECO_TYPES.find((t) => t.value === d.type)?.label}：${d.label}`}
            >
              {d.label}
            </div>
          ))}

          {/* 座位 */}
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
                zIndex: 2,
                ...seatColor(s, selected.has(s.key)),
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        座位：點選可選取（Shift/Ctrl 多選），拖曳移動；空白處點一下取消選取。走道座位設為「走道」即不可被劃。
        裝飾元素：點選後可拖曳移動，或在屬性列調整尺寸與標籤。
      </p>
    </div>
  );
}
