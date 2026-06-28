"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { DecorationKind, LayoutDecoration, SeatInput, SeatOut, SeatStatus, ZoneOut } from "@/lib/types";
import { seatingApi, apiErrorMessage } from "@/lib/api";

const GRID = 16;
const SEAT = 32; // = 2×GRID，對齊格點後座位可完美貼合或留走道
const SNAP_DISTANCE = 10;
const DRAFT_KEY_PREFIX = "seat_editor_draft_v1_";

type ResizeHandle = "nw"|"n"|"ne"|"e"|"se"|"s"|"sw"|"w";
const RESIZE_HANDLES: { pos: ResizeHandle; cursor: string; style: React.CSSProperties }[] = [
  { pos: "nw", cursor: "nwse-resize", style: { left: -4, top: -4 } },
  { pos: "n",  cursor: "ns-resize",   style: { left: "calc(50% - 4px)", top: -4 } },
  { pos: "ne", cursor: "nesw-resize", style: { right: -4, top: -4 } },
  { pos: "e",  cursor: "ew-resize",   style: { right: -4, top: "calc(50% - 4px)" } },
  { pos: "se", cursor: "nwse-resize", style: { right: -4, bottom: -4 } },
  { pos: "s",  cursor: "ns-resize",   style: { left: "calc(50% - 4px)", bottom: -4 } },
  { pos: "sw", cursor: "nesw-resize", style: { left: -4, bottom: -4 } },
  { pos: "w",  cursor: "ew-resize",   style: { left: -4, top: "calc(50% - 4px)" } },
];

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

function seatColor(s: EditSeat, selected: boolean, colorMap: Record<string, string>): React.CSSProperties {
  if (selected) return { background: "var(--primary)", color: "#1a1a2e", borderColor: "var(--primary)" };
  if (s.status === "disabled") return { background: "transparent", color: "var(--text-muted)", borderStyle: "dashed", borderColor: "var(--border)" };
  if (s.status === "blocked") return { background: "var(--bg-elevated)", color: "var(--text-muted)", borderColor: "var(--danger, #c0392b)" };
  const c = colorMap[s.seat_type];
  if (c) return { background: `${c}2a`, color: "var(--text-primary)", borderColor: c };
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
  const c = d.color; // 自訂色（#rrggbb）
  if (c) {
    const bg = `${c}18`; // ~9% alpha
    switch (d.type) {
      case "aisle_h": return { ...base, background: bg, borderTop: `1px dashed ${c}`, borderBottom: `1px dashed ${c}`, color: c };
      case "aisle_v": return { ...base, background: bg, borderLeft: `1px dashed ${c}`, borderRight: `1px dashed ${c}`, color: c, fontSize: 10, writingMode: "vertical-rl" };
      case "label":   return { ...base, background: "transparent", border: "none", color: c, fontWeight: 600, textAlign: "center" };
      default:        return { ...base, background: bg, border: `1px dashed ${c}`, color: c, borderRadius: 4 };
    }
  }
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
  // 載入時 snap 到格點，修正歷史資料偏移
  const g = (n: number) => Math.max(0, Math.round(n / GRID) * GRID);
  return seats.map((s) => ({
    key: s.id,
    id: s.id,
    label: s.label,
    block: s.block,
    row_label: s.row_label,
    x: g(s.x),
    y: g(s.y),
    seat_type: s.seat_type,
    price_delta: s.price_delta,
    status: s.status,
  }));
}

function parseDeco(layout: Record<string, unknown>): LayoutDecoration[] {
  const raw = layout.decorations;
  if (!Array.isArray(raw)) return [];
  const g = (n: number) => Math.max(0, Math.round(n / GRID) * GRID);
  const gs = (n: number) => Math.max(GRID, Math.round(n / GRID) * GRID);
  return raw
    .filter((d): d is LayoutDecoration =>
      d && typeof d === "object" && typeof d.id === "string" && typeof d.type === "string"
    )
    .map((d) => ({ ...d, x: g(d.x), y: g(d.y), width: gs(d.width), height: gs(d.height) }));
}

type DragTarget =
  | {
      target: "move";
      seatOrigins: Map<string, { x: number; y: number }>;
      decoOrigins: Map<string, { x: number; y: number }>;
    }
  | { target: "select"; x: number; y: number; additive: boolean }
  | { target: "resize"; decoId: string; handle: ResizeHandle; originX: number; originY: number; originW: number; originH: number };

type EditorSnapshot = {
  width: number;
  height: number;
  seats: EditSeat[];
  decorations: LayoutDecoration[];
  seatTypeColors: Record<string, string>;
};

type ElementBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type GuideLine = { axis: "x" | "y"; value: number };

const cloneSeats = (items: EditSeat[]) => items.map((s) => ({ ...s }));
const cloneDecorations = (items: LayoutDecoration[]) => items.map((d) => ({ ...d }));

export default function SeatMapEditor({
  zone,
  onSaved,
}: {
  zone: ZoneOut;
  onSaved?: (z: ZoneOut) => void;
}) {
  const layout = (zone.layout || {}) as Record<string, unknown>;
  // 畫布尺寸強制對齊 SEAT=32 的倍數，讓中線落在格線上（760→768, 460→448）
  const [width, setWidth] = useState<number>(() => {
    const n = (layout.width as number) || 768;
    return Math.max(SEAT * 8, Math.round(n / SEAT) * SEAT);
  });
  const [height, setHeight] = useState<number>(() => {
    const n = (layout.height as number) || 448;
    return Math.max(SEAT * 8, Math.round(n / SEAT) * SEAT);
  });
  const [seats, setSeats] = useState<EditSeat[]>(() => toEdit(zone.seats));
  const [decorations, setDecorations] = useState<LayoutDecoration[]>(() => parseDeco(layout));
  const [seatTypeColors, setSeatTypeColors] = useState<Record<string, string>>(
    () => ((layout.seat_type_colors as Record<string, string>) || {})
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedDecos, setSelectedDecos] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showDecoMenu, setShowDecoMenu] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [guideLines, setGuideLines] = useState<GuideLine[]>([]);
  const [hasDraft, setHasDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; info: DragTarget } | null>(null);
  const seatCounter = useRef(0);
  const decoCounter = useRef(0);
  const undoStack = useRef<EditorSnapshot[]>([]);

  const snapshot = useCallback(
    (): EditorSnapshot => ({
      width,
      height,
      seats: cloneSeats(seats),
      decorations: cloneDecorations(decorations),
      seatTypeColors: { ...seatTypeColors },
    }),
    [decorations, height, seatTypeColors, seats, width],
  );

  const pushUndo = useCallback(() => {
    undoStack.current = [...undoStack.current.slice(-39), snapshot()];
  }, [snapshot]);

  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setWidth(prev.width);
    setHeight(prev.height);
    setSeats(prev.seats);
    setDecorations(prev.decorations);
    setSeatTypeColors(prev.seatTypeColors);
    setSelected(new Set());
    setSelectedDecos(new Set());
    setSelectionBox(null);
    setGuideLines([]);
    setDirty(true);
  };

  const mutateSeats = useCallback((fn: (prev: EditSeat[]) => EditSeat[]) => { setSeats(fn); setDirty(true); }, []);
  const mutateDeco = useCallback((fn: (prev: LayoutDecoration[]) => LayoutDecoration[]) => { setDecorations(fn); setDirty(true); }, []);

  // ── 草稿自動儲存（只在 dirty=true 時才存，避免把伺服器原始狀態誤存為草稿） ──
  useEffect(() => {
    if (!dirty) return;
    const key = DRAFT_KEY_PREFIX + zone.id;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ width, height, seats, decorations, seatTypeColors }));
        setDraftSavedAt(new Date());
      } catch {}
    }, 1500);
    return () => clearTimeout(t);
  }, [dirty, width, height, seats, decorations, seatTypeColors, zone.id]);

  useEffect(() => {
    const key = DRAFT_KEY_PREFIX + zone.id;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (d && (d.seats?.length || d.decorations?.length)) setHasDraft(true);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreDraft = () => {
    const raw = localStorage.getItem(DRAFT_KEY_PREFIX + zone.id);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      pushUndo();
      if (d.width)           setWidth(d.width);
      if (d.height)          setHeight(d.height);
      if (d.seats)           setSeats(d.seats);
      if (d.decorations)     setDecorations(d.decorations);
      if (d.seatTypeColors)  setSeatTypeColors(d.seatTypeColors);
      setDirty(true);
      setHasDraft(false);
      toast.success("已還原草稿");
    } catch { toast.error("草稿讀取失敗"); }
  };
  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY_PREFIX + zone.id);
    setHasDraft(false);
  };

  const snap = (n: number) => Math.max(0, Math.round(n / GRID) * GRID);
  const snapSize = (n: number) => Math.max(GRID, Math.round(n / GRID) * GRID);
  const boundsOf = (boxes: ElementBox[]) => {
    const left = Math.min(...boxes.map((b) => b.x));
    const top = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  const collectMovingBoxes = (
    seatOrigins: Map<string, { x: number; y: number }>,
    decoOrigins: Map<string, { x: number; y: number }>,
  ) => [
    ...seats
      .filter((s) => seatOrigins.has(s.key))
      .map((s): ElementBox => {
        const origin = seatOrigins.get(s.key)!;
        return { id: `seat:${s.key}`, x: origin.x, y: origin.y, width: SEAT, height: SEAT };
      }),
    ...decorations
      .filter((d) => decoOrigins.has(d.id))
      .map((d): ElementBox => {
        const origin = decoOrigins.get(d.id)!;
        return { id: `deco:${d.id}`, x: origin.x, y: origin.y, width: d.width, height: d.height };
      }),
  ];
  const collectStaticBoxes = (moving: ElementBox[]) => {
    const movingIds = new Set(moving.map((b) => b.id));
    return [
      ...seats.map((s): ElementBox => ({
        id: `seat:${s.key}`,
        x: s.x,
        y: s.y,
        width: SEAT,
        height: SEAT,
      })),
      ...decorations.map((d): ElementBox => ({
        id: `deco:${d.id}`,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
      })),
    ].filter((b) => !movingIds.has(b.id));
  };
  const smartSnap = (
    seatOrigins: Map<string, { x: number; y: number }>,
    decoOrigins: Map<string, { x: number; y: number }>,
    dx: number,
    dy: number,
  ) => {
    const moving = collectMovingBoxes(seatOrigins, decoOrigins);
    if (!moving.length) return { dx: snap(dx), dy: snap(dy), guides: [] as GuideLine[] };

    const box = boundsOf(moving);
    // 用原始位移（未格點化）計算錨點，讓元素邊緣吸附優先於格點
    const movedRaw = { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height };
    const xAnchors = [movedRaw.x, movedRaw.x + movedRaw.width / 2, movedRaw.x + movedRaw.width];
    const yAnchors = [movedRaw.y, movedRaw.y + movedRaw.height / 2, movedRaw.y + movedRaw.height];
    const targets = [{ x: 0, y: 0, width, height }, ...collectStaticBoxes(moving)];
    const xTargets = targets.flatMap((b) => [b.x, b.x + b.width / 2, b.x + b.width]);
    const yTargets = targets.flatMap((b) => [b.y, b.y + b.height / 2, b.y + b.height]);
    let bestX: { distance: number; delta: number; value: number } | null = null;
    let bestY: { distance: number; delta: number; value: number } | null = null;

    for (const anchor of xAnchors) {
      for (const target of xTargets) {
        const delta = target - anchor;
        const distance = Math.abs(delta);
        if (distance <= SNAP_DISTANCE && (!bestX || distance < bestX.distance)) {
          bestX = { distance, delta, value: target };
        }
      }
    }
    for (const anchor of yAnchors) {
      for (const target of yTargets) {
        const delta = target - anchor;
        const distance = Math.abs(delta);
        if (distance <= SNAP_DISTANCE && (!bestY || distance < bestY.distance)) {
          bestY = { distance, delta, value: target };
        }
      }
    }
    // 元素邊緣有吸附就用；否則退回格點
    const snapDx = bestX ? dx + bestX.delta : snap(dx);
    const snapDy = bestY ? dy + bestY.delta : snap(dy);
    return {
      dx: snapDx,
      dy: snapDy,
      guides: [
        ...(bestX ? [{ axis: "x" as const, value: bestX.value }] : []),
        ...(bestY ? [{ axis: "y" as const, value: bestY.value }] : []),
      ],
    };
  };
  const canvasPoint = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: snap(e.clientX - (rect?.left ?? 0)), y: snap(e.clientY - (rect?.top ?? 0)) };
  };

  // ── 座位 新增 ──────────────────────────────────────────────────────────────
  const addSeat = () => {
    pushUndo();
    const key = `new-${seatCounter.current++}`;
    mutateSeats((prev) => [
      ...prev,
      { key, id: null, label: `S${prev.length + 1}`, block: null, row_label: null, x: snap(width / 2), y: snap(height / 2), seat_type: "normal", price_delta: 0, status: "available" },
    ]);
    setSelected(new Set([key]));
    setSelectedDecos(new Set());
  };

  const addRow = () => {
    const prefix = window.prompt("排代號（例如 A）", "A");
    if (prefix === null) return;
    const count = Number(window.prompt("此排座位數", "10"));
    if (!Number.isFinite(count) || count <= 0) return;
    pushUndo();
    const baseY = seats.length ? snap(Math.max(...seats.map((s) => s.y)) + SEAT + GRID) : SEAT * 2;
    const added: EditSeat[] = [];
    for (let i = 0; i < count; i++) {
      added.push({
        key: `new-${seatCounter.current++}`,
        id: null,
        label: `${prefix}${i + 1}`,
        block: null,
        row_label: prefix,
        x: SEAT + i * SEAT,
        y: baseY,
        seat_type: "normal",
        price_delta: 0,
        status: "available",
      });
    }
    mutateSeats((prev) => [...prev, ...added]);
    setSelected(new Set(added.map((s) => s.key)));
    setSelectedDecos(new Set());
  };

  // ── 裝飾元素 新增 ──────────────────────────────────────────────────────────
  const addDeco = (kind: DecorationKind) => {
    pushUndo();
    const meta = DECO_TYPES.find((t) => t.value === kind)!;
    const id = `deco-${decoCounter.current++}`;
    const newDeco: LayoutDecoration = {
      id,
      type: kind,
      x: snap((width - meta.defaultW) / 2),
      y: snap(kind === "screen" ? 6 : height / 2 - meta.defaultH / 2),
      width: snapSize(meta.defaultW),
      height: snapSize(meta.defaultH),
      label: meta.defaultLabel,
    };
    mutateDeco((prev) => [...prev, newDeco]);
    setSelectedDecos(new Set([id]));
    setSelected(new Set());
    setShowDecoMenu(false);
  };

  // ── 座位 選取 ──────────────────────────────────────────────────────────────
  const toggleSelect = (key: string, additive: boolean) => {
    if (!additive) setSelectedDecos(new Set());
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
    const seatOrigins = new Map<string, { x: number; y: number }>();
    const decoOrigins = new Map<string, { x: number; y: number }>();
    seats.forEach((s) => { if (keys.has(s.key)) seatOrigins.set(s.key, { x: s.x, y: s.y }); });
    decorations.forEach((d) => {
      if (selectedDecos.has(d.id) && selected.has(key)) decoOrigins.set(d.id, { x: d.x, y: d.y });
    });
    pushUndo();
    dragState.current = { startX: e.clientX, startY: e.clientY, info: { target: "move", seatOrigins, decoOrigins } };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  // ── 拖移：裝飾元素 ─────────────────────────────────────────────────────────
  const onDecoPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    setSelectedDecos((prev) => {
      const next = new Set(additive ? prev : []);
      if (prev.has(id) && additive) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!additive) setSelected(new Set());
    const decoKeys = selectedDecos.has(id) ? selectedDecos : new Set([id]);
    const seatOrigins = new Map<string, { x: number; y: number }>();
    const decoOrigins = new Map<string, { x: number; y: number }>();
    decorations.forEach((d) => { if (decoKeys.has(d.id)) decoOrigins.set(d.id, { x: d.x, y: d.y }); });
    seats.forEach((s) => {
      if (selected.has(s.key) && selectedDecos.has(id)) seatOrigins.set(s.key, { x: s.x, y: s.y });
    });
    pushUndo();
    dragState.current = { startX: e.clientX, startY: e.clientY, info: { target: "move", seatOrigins, decoOrigins } };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (ds.info.target === "move") {
      const { seatOrigins, decoOrigins } = ds.info;
      const snapped = smartSnap(seatOrigins, decoOrigins, dx, dy);
      setGuideLines(snapped.guides);
      mutateSeats((prev) =>
        prev.map((s) => {
          const o = seatOrigins.get(s.key);
          if (!o) return s;
          return { ...s, x: Math.max(0, o.x + snapped.dx), y: Math.max(0, o.y + snapped.dy) };
        }),
      );
      mutateDeco((prev) =>
        prev.map((d) => {
          const o = decoOrigins.get(d.id);
          return o ? { ...d, x: Math.max(0, o.x + snapped.dx), y: Math.max(0, o.y + snapped.dy) } : d;
        })
      );
    } else if (ds.info.target === "resize") {
      const { decoId, handle, originX, originY, originW, originH } = ds.info;
      const rawDx = e.clientX - ds.startX;
      const rawDy = e.clientY - ds.startY;
      const isN = handle.includes("n");
      const isS = handle.includes("s");
      const isE = handle.includes("e");
      const isW = handle.includes("w");
      const isCorner = handle.length === 2;
      let x = originX, y = originY, w = originW, h = originH;

      if (isCorner) {
        // 等比例拉伸：以較大的縮放軸為準
        const sx = isE ? rawDx : -rawDx;
        const sy = isS ? rawDy : -rawDy;
        const aspect = originH / originW;
        if (Math.abs(sx / originW) >= Math.abs(sy / originH)) {
          w = Math.max(GRID, snapSize(originW + sx));
          h = Math.max(GRID, snapSize(w * aspect));
        } else {
          h = Math.max(GRID, snapSize(originH + sy));
          w = Math.max(GRID, snapSize(h / aspect));
        }
        if (isN) y = snap(originY + originH - h);
        if (isW) x = snap(originX + originW - w);
      } else {
        if (isE) w = snapSize(Math.max(GRID, originW + rawDx));
        if (isS) h = snapSize(Math.max(GRID, originH + rawDy));
        if (isW) { w = snapSize(Math.max(GRID, originW - rawDx)); x = snap(originX + originW - w); }
        if (isN) { h = snapSize(Math.max(GRID, originH - rawDy)); y = snap(originY + originH - h); }
      }
      mutateDeco((prev) => prev.map((d) =>
        d.id === decoId ? { ...d, x, y, width: Math.max(GRID, w), height: Math.max(GRID, h) } : d
      ));
    } else {
      const point = canvasPoint(e);
      const x1 = Math.min(ds.info.x, point.x);
      const y1 = Math.min(ds.info.y, point.y);
      const x2 = Math.max(ds.info.x, point.x);
      const y2 = Math.max(ds.info.y, point.y);
      setSelectionBox({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
    }
  };

  const onCanvasPointerUp = () => {
    const ds = dragState.current;
    if (ds?.info.target === "select" && selectionBox) {
      const info = ds.info;
      const x2 = selectionBox.x + selectionBox.width;
      const y2 = selectionBox.y + selectionBox.height;
      const pickedSeats = seats
        .filter((s) => s.x < x2 && s.x + SEAT > selectionBox.x && s.y < y2 && s.y + SEAT > selectionBox.y)
        .map((s) => s.key);
      const pickedDecos = decorations
        .filter((d) =>
          d.x < x2 && d.x + d.width > selectionBox.x && d.y < y2 && d.y + d.height > selectionBox.y
        )
        .map((d) => d.id);
      setSelected((prev) => new Set(info.additive ? [...prev, ...pickedSeats] : pickedSeats));
      setSelectedDecos((prev) => new Set(info.additive ? [...prev, ...pickedDecos] : pickedDecos));
    }
    dragState.current = null;
    setSelectionBox(null);
    setGuideLines([]);
  };

  // ── 座位 批次屬性 ──────────────────────────────────────────────────────────
  const selectedSeats = useMemo(() => seats.filter((s) => selected.has(s.key)), [seats, selected]);
  const applyToSelected = (patch: Partial<EditSeat>) => {
    if (!selected.size) return;
    pushUndo();
    mutateSeats((prev) => prev.map((s) => (selected.has(s.key) ? { ...s, ...patch } : s)));
  };
  const deleteSelected = () => {
    if (!selected.size && !selectedDecos.size) return;
    pushUndo();
    mutateSeats((prev) => prev.filter((s) => !selected.has(s.key)));
    mutateDeco((prev) => prev.filter((d) => !selectedDecos.has(d.id)));
    setSelected(new Set());
    setSelectedDecos(new Set());
  };
  const relabelSelected = () => {
    const v = window.prompt("套用代號（多選時自動加序號，如 A → A1 A2 …）", selectedSeats[0]?.label ?? "");
    if (v === null) return;
    pushUndo();
    const list = selectedSeats;
    // 去掉尾端數字後即為排代號（A1→A、VIP1→VIP、B→B）
    const rowPrefix = v.replace(/\d+$/, "") || v;
    mutateSeats((prev) =>
      prev.map((s) => {
        const idx = list.findIndex((x) => x.key === s.key);
        if (idx < 0) return s;
        const label = list.length > 1 ? `${v}${idx + 1}` : v;
        const row_label = list.length > 1 ? rowPrefix : s.row_label;
        return { ...s, label, row_label };
      }),
    );
  };

  // ── 靠攏 / 拆分走道 ───────────────────────────────────────────────────────
  const inferAxis = (list: EditSeat[]) => {
    const spanX = Math.max(...list.map((s) => s.x)) - Math.min(...list.map((s) => s.x));
    const spanY = Math.max(...list.map((s) => s.y)) - Math.min(...list.map((s) => s.y));
    return spanX >= spanY ? "x" : "y";
  };

  const packTight = () => {
    if (selected.size < 2) return;
    pushUndo();
    const list = selectedSeats;
    const axis = inferAxis(list);
    if (axis === "x") {
      const sorted = [...list].sort((a, b) => a.x - b.x || a.y - b.y);
      const startX = sorted[0].x;
      mutateSeats((prev) =>
        prev.map((s) => {
          const idx = sorted.findIndex((x) => x.key === s.key);
          return idx < 0 ? s : { ...s, x: startX + idx * SEAT };
        }),
      );
    } else {
      const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
      const startY = sorted[0].y;
      mutateSeats((prev) =>
        prev.map((s) => {
          const idx = sorted.findIndex((x) => x.key === s.key);
          return idx < 0 ? s : { ...s, y: startY + idx * SEAT };
        }),
      );
    }
  };

  const insertAisle = () => {
    if (selected.size < 2) return;
    pushUndo();
    const list = selectedSeats;
    const axis = inferAxis(list);
    if (axis === "x") {
      const sorted = [...list].sort((a, b) => a.x - b.x || a.y - b.y);
      const half = Math.ceil(sorted.length / 2);
      const secondKeys = new Set(sorted.slice(half).map((s) => s.key));
      mutateSeats((prev) => prev.map((s) => (secondKeys.has(s.key) ? { ...s, x: s.x + SEAT } : s)));
    } else {
      const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
      const half = Math.ceil(sorted.length / 2);
      const secondKeys = new Set(sorted.slice(half).map((s) => s.key));
      mutateSeats((prev) => prev.map((s) => (secondKeys.has(s.key) ? { ...s, y: s.y + SEAT } : s)));
    }
  };

  // ── 方向鍵微移 ────────────────────────────────────────────────────────────
  const onCanvasKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if (!selected.size && !selectedDecos.size) return;
    // Shift+方向鍵 = 1px 精細移動；一般方向鍵 = 16px 格點移動
    const step = e.shiftKey ? 1 : GRID;
    const dirs: Record<string, { dx: number; dy: number }> = {
      ArrowLeft:  { dx: -step, dy: 0 },
      ArrowRight: { dx:  step, dy: 0 },
      ArrowUp:    { dx: 0, dy: -step },
      ArrowDown:  { dx: 0, dy:  step },
    };
    const dir = dirs[e.key];
    if (!dir) return;
    e.preventDefault();
    pushUndo();
    mutateSeats((prev) =>
      prev.map((s) =>
        selected.has(s.key)
          ? { ...s, x: Math.max(0, s.x + dir.dx), y: Math.max(0, s.y + dir.dy) }
          : s,
      ),
    );
    mutateDeco((prev) =>
      prev.map((d) =>
        selectedDecos.has(d.id)
          ? { ...d, x: Math.max(0, d.x + dir.dx), y: Math.max(0, d.y + dir.dy) }
          : d,
      ),
    );
  };

  // ── 裝飾元素 屬性 ──────────────────────────────────────────────────────────
  const activeDecoId = selectedDecos.size === 1 ? [...selectedDecos][0] : null;
  const activeDeco = decorations.find((d) => d.id === activeDecoId) ?? null;
  const patchDeco = (patch: Partial<LayoutDecoration>) => {
    if (!activeDecoId) return;
    pushUndo();
    mutateDeco((prev) => prev.map((d) => d.id === activeDecoId ? { ...d, ...patch } : d));
  };
  const deleteDeco = () => {
    if (!selectedDecos.size) return;
    pushUndo();
    mutateDeco((prev) => prev.filter((d) => !selectedDecos.has(d.id)));
    setSelectedDecos(new Set());
  };

  const alignSelectedSeats = (mode: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") => {
    if (selected.size < 2) return;
    pushUndo();
    const xs = selectedSeats.map((s) => s.x);
    const ys = selectedSeats.map((s) => s.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs) + SEAT;
    const bottom = Math.max(...ys) + SEAT;
    const centerX = snap((left + right - SEAT) / 2);
    const centerY = snap((top + bottom - SEAT) / 2);
    mutateSeats((prev) =>
      prev.map((s) => {
        if (!selected.has(s.key)) return s;
        if (mode === "left") return { ...s, x: left };
        if (mode === "centerX") return { ...s, x: centerX };
        if (mode === "right") return { ...s, x: right - SEAT };
        if (mode === "top") return { ...s, y: top };
        if (mode === "centerY") return { ...s, y: centerY };
        return { ...s, y: bottom - SEAT };
      }),
    );
  };

  // ── 複製 ──────────────────────────────────────────────────────────────────
  const duplicateSelected = () => {
    if (!selected.size && !selectedDecos.size) return;
    pushUndo();
    const offset = SEAT;
    const newKeys: string[] = [];
    const newIds: string[] = [];
    const addedSeats: EditSeat[] = [];
    const addedDecos: LayoutDecoration[] = [];
    seats.forEach((s) => {
      if (!selected.has(s.key)) return;
      const key = `new-${seatCounter.current++}`;
      newKeys.push(key);
      addedSeats.push({ ...s, key, id: null, x: s.x + offset, y: s.y + offset });
    });
    decorations.forEach((d) => {
      if (!selectedDecos.has(d.id)) return;
      const id = `deco-${decoCounter.current++}`;
      newIds.push(id);
      addedDecos.push({ ...d, id, x: d.x + offset, y: d.y + offset });
    });
    if (addedSeats.length) mutateSeats((prev) => [...prev, ...addedSeats]);
    if (addedDecos.length) mutateDeco((prev) => [...prev, ...addedDecos]);
    setSelected(new Set(newKeys));
    setSelectedDecos(new Set(newIds));
  };

  // ── 混合對齊（座位 + 裝飾一起） ──────────────────────────────────────────
  const alignAll = (mode: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") => {
    if (!selected.size && !selectedDecos.size) return;
    pushUndo();
    const allBoxes = [
      ...seats.filter((s) => selected.has(s.key)).map((s) => ({ id: `seat:${s.key}`, x: s.x, y: s.y, w: SEAT, h: SEAT })),
      ...decorations.filter((d) => selectedDecos.has(d.id)).map((d) => ({ id: `deco:${d.id}`, x: d.x, y: d.y, w: d.width, h: d.height })),
    ];
    if (allBoxes.length < 2) return;
    const left   = Math.min(...allBoxes.map((b) => b.x));
    const top    = Math.min(...allBoxes.map((b) => b.y));
    const right  = Math.max(...allBoxes.map((b) => b.x + b.w));
    const bottom = Math.max(...allBoxes.map((b) => b.y + b.h));
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const tx = (b: { x: number; w: number }) => {
      if (mode === "left")    return snap(left);
      if (mode === "right")   return snap(right - b.w);
      if (mode === "centerX") return snap(cx - b.w / 2);
      return b.x;
    };
    const ty = (b: { y: number; h: number }) => {
      if (mode === "top")     return snap(top);
      if (mode === "bottom")  return snap(bottom - b.h);
      if (mode === "centerY") return snap(cy - b.h / 2);
      return b.y;
    };
    mutateSeats((prev) => prev.map((s) => {
      if (!selected.has(s.key)) return s;
      return { ...s, x: tx({ x: s.x, w: SEAT }), y: ty({ y: s.y, h: SEAT }) };
    }));
    mutateDeco((prev) => prev.map((d) => {
      if (!selectedDecos.has(d.id)) return d;
      return { ...d, x: tx({ x: d.x, w: d.width }), y: ty({ y: d.y, h: d.height }) };
    }));
  };

  // ── 置中至畫布 ────────────────────────────────────────────────────────────
  const alignToCanvas = (mode: "centerX" | "centerY") => {
    if (!selected.size && !selectedDecos.size) return;
    pushUndo();
    const allBoxes = [
      ...seats.filter((s) => selected.has(s.key)).map((s) => ({ x: s.x, y: s.y, w: SEAT, h: SEAT })),
      ...decorations.filter((d) => selectedDecos.has(d.id)).map((d) => ({ x: d.x, y: d.y, w: d.width, h: d.height })),
    ];
    if (!allBoxes.length) return;
    const left   = Math.min(...allBoxes.map((b) => b.x));
    const top    = Math.min(...allBoxes.map((b) => b.y));
    const right  = Math.max(...allBoxes.map((b) => b.x + b.w));
    const bottom = Math.max(...allBoxes.map((b) => b.y + b.h));
    const dx = mode === "centerX" ? snap(width / 2 - (left + right) / 2) : 0;
    const dy = mode === "centerY" ? snap(height / 2 - (top + bottom) / 2) : 0;
    mutateSeats((prev) => prev.map((s) =>
      selected.has(s.key) ? { ...s, x: Math.max(0, s.x + dx), y: Math.max(0, s.y + dy) } : s
    ));
    mutateDeco((prev) => prev.map((d) =>
      selectedDecos.has(d.id) ? { ...d, x: Math.max(0, d.x + dx), y: Math.max(0, d.y + dy) } : d
    ));
  };

  const hasGroupSelection = selected.size + selectedDecos.size > 1;

  // ── 儲存 ──────────────────────────────────────────────────────────────────
  const save = async () => {
    const labels = seats.map((s) => s.label.trim());
    if (labels.some((l) => !l)) { toast.error("有座位未填代號"); return; }
    if (new Set(labels).size !== labels.length) { toast.error("座位代號重複"); return; }
    setSaving(true);
    try {
      const payload = {
        layout: { ...layout, width, height, decorations, seat_type_colors: seatTypeColors },
        seats: seats.map((s): SeatInput => ({
          id: s.id, label: s.label, block: s.block, row_label: s.row_label,
          x: s.x, y: s.y, seat_type: s.seat_type, price_delta: s.price_delta, status: s.status,
        })),
      };
      const updated = await seatingApi.saveSeats(zone.id, payload);
      setSeats(toEdit(updated.seats));
      const ul = (updated.layout || {}) as Record<string, unknown>;
      setDecorations(parseDeco(ul));
      setSeatTypeColors((ul.seat_type_colors as Record<string, string>) || {});
      localStorage.removeItem(DRAFT_KEY_PREFIX + zone.id);
      setDirty(false);
      setHasDraft(false);
      setDraftSavedAt(null);
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
    // onMouseDown 在 input/select/canvas 以外的地方一律 preventDefault，防止點按鈕讓 canvas 失去焦點
    <div
      className="space-y-3"
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
        if (canvasRef.current?.contains(t)) return;
        if (document.activeElement === canvasRef.current) e.preventDefault();
      }}
    >
      {/* 草稿提示 */}
      {hasDraft && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: "rgba(212,175,55,0.12)", border: "1px solid var(--primary)" }}>
          <span style={{ color: "var(--primary)" }}>發現未儲存的草稿，是否還原？</span>
          <button type="button" className="btn btn-ghost text-xs" onClick={restoreDraft}>還原草稿</button>
          <button type="button" className="btn btn-ghost text-xs" style={{ color: "var(--text-muted)" }} onClick={discardDraft}>捨棄</button>
        </div>
      )}
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
          已選 {selected.size} / 共 {seats.length} 座位｜已選 {selectedDecos.size} / 共 {decorations.length} 裝飾
        </span>
        <div className="flex-1" />
        <button type="button" className="btn btn-ghost text-xs" onClick={undo} disabled={!undoStack.current.length} title="撤銷上一步（Ctrl/⌘+Z）">
          ↶ 撤銷
        </button>
        {/* 畫布大小步進器 */}
        <div className="flex items-center gap-0.5 text-xs select-none" style={{ color: "var(--text-muted)" }}>
          <span className="mr-1">畫布</span>
          <button type="button" className="btn btn-ghost text-xs px-1.5 py-0.5"
            onClick={() => { pushUndo(); setWidth((w) => Math.max(SEAT * 8, w - SEAT)); setDirty(true); }}>−</button>
          <span className="w-12 text-center tabular-nums">{width}</span>
          <button type="button" className="btn btn-ghost text-xs px-1.5 py-0.5"
            onClick={() => { pushUndo(); setWidth((w) => w + SEAT); setDirty(true); }}>＋</button>
          <span className="mx-1">×</span>
          <button type="button" className="btn btn-ghost text-xs px-1.5 py-0.5"
            onClick={() => { pushUndo(); setHeight((h) => Math.max(SEAT * 8, h - SEAT)); setDirty(true); }}>−</button>
          <span className="w-12 text-center tabular-nums">{height}</span>
          <button type="button" className="btn btn-ghost text-xs px-1.5 py-0.5"
            onClick={() => { pushUndo(); setHeight((h) => h + SEAT); setDirty(true); }}>＋</button>
        </div>
        {dirty && draftSavedAt && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            草稿已儲存 {draftSavedAt.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
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
          <button type="button" className="btn btn-ghost text-xs" onClick={duplicateSelected} title="複製所選（Ctrl/⌘+D）">複製</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignToCanvas("centerX")} title="整組水平置中於畫布">置中X</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignToCanvas("centerY")} title="整組垂直置中於畫布">置中Y</button>
          {selected.size >= 2 && <>
            <button type="button" className="btn btn-ghost text-xs" onClick={packTight} title="貼齊排列，消除座位間空隙">靠攏</button>
            <button type="button" className="btn btn-ghost text-xs" onClick={insertAisle} title="從中間插入走道（後半段向外移一個座位寬）">拆分走道</button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => alignSelectedSeats("left")}>左齊</button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => alignSelectedSeats("centerX")}>垂中</button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => alignSelectedSeats("right")}>右齊</button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => alignSelectedSeats("top")}>上齊</button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => alignSelectedSeats("centerY")}>橫中</button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => alignSelectedSeats("bottom")}>下齊</button>
          </>}
          <select className="input text-xs" value={selectedSeats[0]?.seat_type ?? "normal"}
            onChange={(e) => applyToSelected({ seat_type: e.target.value })}>
            {SEAT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }} title="此座位類型的顏色">
            色
            <input type="color"
              value={seatTypeColors[selectedSeats[0]?.seat_type ?? "normal"] || "#888888"}
              onChange={(e) => {
                pushUndo();
                setSeatTypeColors((prev) => ({ ...prev, [selectedSeats[0]?.seat_type ?? "normal"]: e.target.value }));
                setDirty(true);
              }}
              className="w-8 h-6 rounded cursor-pointer border-0 p-0"
              style={{ background: "none" }} />
          </label>
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
          <input className="input w-16 text-xs" placeholder="排代號" value={selectedSeats[0]?.row_label ?? ""}
            title="排代號：會同步替換各座位代號中的前綴（A→B 使 A1 變 B1）"
            onChange={(e) => {
              const newRow = e.target.value;
              pushUndo();
              mutateSeats((prev) => prev.map((s) => {
                if (!selected.has(s.key)) return s;
                const oldRow = s.row_label ?? "";
                const suffix = oldRow && s.label.startsWith(oldRow) ? s.label.slice(oldRow.length) : s.label;
                return { ...s, row_label: newRow || null, label: newRow + suffix };
              }));
            }} />
          <input className="input w-28 text-xs" placeholder="區塊名稱" value={selectedSeats[0]?.block ?? ""}
            onChange={(e) => applyToSelected({ block: e.target.value || null })} />
          <button type="button" className="btn btn-ghost text-xs" style={{ color: "var(--danger, #c0392b)" }}
            onClick={deleteSelected}>刪除所選</button>
        </div>
      )}

      {hasGroupSelection && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg p-2"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
            群組 {selected.size + selectedDecos.size} 個
          </span>
          <button type="button" className="btn btn-ghost text-xs" onClick={duplicateSelected} title="Ctrl/⌘+D">複製</button>
          <span className="text-xs" style={{ color: "var(--text-muted)", borderLeft: "1px solid var(--border)", paddingLeft: 6 }}>對齊:</span>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignAll("left")}>左齊</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignAll("centerX")}>垂中</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignAll("right")}>右齊</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignAll("top")}>上齊</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignAll("centerY")}>橫中</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignAll("bottom")}>下齊</button>
          <span className="text-xs" style={{ color: "var(--text-muted)", borderLeft: "1px solid var(--border)", paddingLeft: 6 }}>畫布置中:</span>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignToCanvas("centerX")}>水平</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignToCanvas("centerY")}>垂直</button>
          <button type="button" className="btn btn-ghost text-xs" style={{ color: "var(--danger, #c0392b)" }}
            onClick={deleteSelected}>刪除群組</button>
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
              onChange={(e) => patchDeco({ width: snapSize(Number(e.target.value) || 10) })} />
          </label>
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            高
            <input type="number" className="input w-16 text-xs" min={10} step={GRID} value={activeDeco.height}
              onChange={(e) => patchDeco({ height: snapSize(Number(e.target.value) || 10) })} />
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
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }} title="自訂顏色">
            色
            <input type="color"
              value={activeDeco.color || "#888888"}
              onChange={(e) => patchDeco({ color: e.target.value })}
              className="w-8 h-6 rounded cursor-pointer border-0 p-0"
              style={{ background: "none" }} />
            {activeDeco.color && (
              <button type="button" className="text-xs" style={{ color: "var(--text-muted)" }}
                onClick={() => patchDeco({ color: undefined })} title="還原預設色">✕</button>
            )}
          </label>
          <button type="button" className="btn btn-ghost text-xs" onClick={duplicateSelected} title="Ctrl/⌘+D">複製</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignToCanvas("centerX")} title="水平置中於畫布">置中X</button>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => alignToCanvas("centerY")} title="垂直置中於畫布">置中Y</button>
          <button type="button" className="btn btn-ghost text-xs" style={{ color: "var(--danger, #c0392b)" }}
            onClick={deleteDeco}>刪除</button>
        </div>
      )}

      {/* 畫布 */}
      <div className="overflow-auto rounded-lg" style={{ border: "1px solid var(--border)", maxHeight: 560 }}>
        <div
          ref={canvasRef}
          tabIndex={0}
          onKeyDown={onCanvasKeyDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerDown={(e) => {
            const point = canvasPoint(e);
            const additive = e.shiftKey || e.ctrlKey || e.metaKey;
            if (!additive) {
              setSelected(new Set());
              setSelectedDecos(new Set());
            }
            setShowDecoMenu(false);
            dragState.current = { startX: e.clientX, startY: e.clientY, info: { target: "select", ...point, additive } };
            setSelectionBox({ ...point, width: 0, height: 0 });
          }}
          className="relative outline-none"
          style={{
            width,
            height,
            // 180deg = 從頂部往下，線在 y=0,16,32,64... 與 top 定位的元素完全對齊
            // 90deg  = 從左往右，  線在 x=0,16,32,64... 與 left 定位的元素完全對齊
            backgroundImage: [
              "repeating-linear-gradient(180deg, rgba(127,127,127,0.18) 0, rgba(127,127,127,0.18) 1px, transparent 1px, transparent 32px)",
              "repeating-linear-gradient(90deg,  rgba(127,127,127,0.18) 0, rgba(127,127,127,0.18) 1px, transparent 1px, transparent 32px)",
              "repeating-linear-gradient(180deg, rgba(127,127,127,0.06) 0, rgba(127,127,127,0.06) 1px, transparent 1px, transparent 16px)",
              "repeating-linear-gradient(90deg,  rgba(127,127,127,0.06) 0, rgba(127,127,127,0.06) 1px, transparent 1px, transparent 16px)",
            ].join(", "),
            backgroundColor: "var(--bg-base)",
          }}
        >
          {/* 畫布中心線 */}
          <div className="absolute pointer-events-none" style={{
            left: Math.round(width / 2), top: 0, width: 0, height: height,
            borderLeft: "1px dashed rgba(127,127,127,0.35)", zIndex: 0,
          }} />
          <div className="absolute pointer-events-none" style={{
            left: 0, top: Math.round(height / 2), width: width, height: 0,
            borderTop: "1px dashed rgba(127,127,127,0.35)", zIndex: 0,
          }} />

          {/* 裝飾元素（在座位下層，以免遮住點擊） */}
          {decorations.map((d) => (
            <div
              key={d.id}
              onPointerDown={(e) => onDecoPointerDown(e, d.id)}
              style={{ ...decoStyle(d, selectedDecos.has(d.id)), overflow: "visible" }}
              title={`${DECO_TYPES.find((t) => t.value === d.type)?.label}：${d.label}`}
            >
              {d.label}
              {/* 調整大小把手（選取時顯示） */}
              {selectedDecos.has(d.id) && RESIZE_HANDLES.map((h) => (
                <div
                  key={h.pos}
                  style={{
                    position: "absolute", width: 8, height: 8,
                    background: "white", border: "1.5px solid var(--primary)",
                    borderRadius: 2, cursor: h.cursor, zIndex: 10,
                    touchAction: "none",
                    ...h.style,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    pushUndo();
                    dragState.current = {
                      startX: e.clientX, startY: e.clientY,
                      info: { target: "resize", decoId: d.id, handle: h.pos, originX: d.x, originY: d.y, originW: d.width, originH: d.height },
                    };
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                />
              ))}
            </div>
          ))}

          {guideLines.map((line) => (
            <div
              key={`${line.axis}-${line.value}`}
              className="absolute pointer-events-none"
              style={{
                left: line.axis === "x" ? line.value : 0,
                top: line.axis === "y" ? line.value : 0,
                width: line.axis === "x" ? 0 : width,
                height: line.axis === "y" ? 0 : height,
                borderLeft: line.axis === "x" ? "1px solid var(--primary)" : undefined,
                borderTop: line.axis === "y" ? "1px solid var(--primary)" : undefined,
                boxShadow: "0 0 0 1px rgba(212, 175, 55, 0.18)",
                zIndex: 4,
              }}
            />
          ))}

          {selectionBox && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: selectionBox.x,
                top: selectionBox.y,
                width: selectionBox.width,
                height: selectionBox.height,
                border: "1px solid var(--primary)",
                background: "rgba(212, 175, 55, 0.08)",
                zIndex: 3,
              }}
            />
          )}

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
                ...seatColor(s, selected.has(s.key), seatTypeColors),
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        框選或 Shift/Ctrl 多選 → 成組拖曳、對齊；混選座位＋裝飾元素可用群組面板一起對齊。
        走道等裝飾元素選取後，四邊與四角出現調整大小把手（拖角 = 等比例）。
        方向鍵 16px 移動，Shift＋方向鍵 1px 精細移動；Ctrl/⌘+D 複製，Ctrl/⌘+Z 撤銷。
        草稿每 1.5 秒自動存入瀏覽器，下次進入會提示還原。
      </p>
    </div>
  );
}
