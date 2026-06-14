"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { seatingApi, apiErrorMessage } from "@/lib/api";
import type { LayoutDecoration, SeatMapOut, SeatState, SeatStateKind } from "@/lib/types";

const SEAT = 34;

const STATE_STYLE: Record<SeatStateKind, React.CSSProperties> = {
  available: { background: "var(--bg-elevated)", color: "var(--text-primary)", borderColor: "var(--border)", cursor: "pointer" },
  mine: { background: "var(--primary)", color: "#1a1a2e", borderColor: "var(--primary)", cursor: "pointer" },
  held: { background: "var(--bg-base)", color: "var(--text-muted)", borderColor: "var(--border)", cursor: "not-allowed", opacity: 0.5 },
  taken: { background: "var(--bg-base)", color: "var(--text-muted)", borderColor: "var(--border)", cursor: "not-allowed", opacity: 0.4 },
  disabled: { background: "transparent", color: "transparent", borderColor: "transparent", cursor: "default" },
  blocked: { background: "var(--bg-base)", color: "var(--text-muted)", borderColor: "var(--danger,#c0392b)", cursor: "not-allowed", opacity: 0.5 },
};

function Countdown({ expiresAt, onExpire }: { expiresAt: string | null; onExpire: () => void }) {
  const [left, setLeft] = useState<number>(0);
  useEffect(() => {
    if (!expiresAt) { setLeft(0); return; }
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setLeft(Math.max(0, Math.floor(ms / 1000)));
      if (ms <= 0) onExpire();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);
  if (!expiresAt || left <= 0) return null;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return (
    <span className="font-mono text-sm" style={{ color: left < 60 ? "var(--danger,#c0392b)" : "var(--primary)" }}>
      保留剩餘 {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

export default function SeatSelectionPage() {
  const { zoneId } = useParams<{ zoneId: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get("order_id") || undefined;

  const [map, setMap] = useState<SeatMapOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [holding, setHolding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await seatingApi.seatMap(zoneId, orderId);
      setMap(m);
      // 同步本人已保留的座位為已選
      setPicked((prev) => {
        const mine = new Set(m.seats.filter((s) => s.state === "mine").map((s) => s.id));
        return mine.size ? mine : prev;
      });
    } catch (e) {
      toast.error(apiErrorMessage(e, "讀取座位圖失敗"));
    } finally {
      setLoading(false);
    }
  }, [zoneId, orderId]);

  useEffect(() => { load(); }, [load]);
  // 每 10 秒刷新，反映他人保留 / 劃位
  useEffect(() => {
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const seatById = useMemo(() => {
    const m = new Map<string, SeatState>();
    map?.seats.forEach((s) => m.set(s.id, s));
    return m;
  }, [map]);

  // 變動選取後 debounce 送出 hold
  const scheduleHold = useCallback((ids: string[]) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(async () => {
      setHolding(true);
      try {
        const res = await seatingApi.hold(zoneId, ids);
        if (res.rejected_seat_ids.length) {
          toast.error("部分座位已被搶走，已自動取消");
          setPicked(new Set(res.seat_ids));
        }
        setMap((prev) => (prev ? { ...prev, hold_expires_at: res.expires_at } : prev));
        load();
      } catch (e) {
        toast.error(apiErrorMessage(e, "保留座位失敗"));
      } finally {
        setHolding(false);
      }
    }, 350);
  }, [zoneId, load]);

  const toggle = (s: SeatState) => {
    if (!map?.can_select_now) return;
    if (s.state === "taken" || s.state === "held" || s.state === "disabled" || s.state === "blocked") return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(s.id)) next.delete(s.id);
      else {
        if (map.remaining_quota > 0 && next.size >= map.remaining_quota) {
          toast.error(`最多可選 ${map.remaining_quota} 個座位`);
          return prev;
        }
        next.add(s.id);
      }
      scheduleHold([...next]);
      return next;
    });
  };

  const confirm = async () => {
    if (!orderId) { toast.error("缺少訂單資訊"); return; }
    if (!picked.size) { toast.error("請先選擇座位"); return; }
    setConfirming(true);
    try {
      await seatingApi.select({ order_id: orderId, seat_ids: [...picked] });
      toast.success("劃位完成！");
      router.push(`/shop/orders/${orderId}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "劃位失敗"));
      load();
    } finally {
      setConfirming(false);
    }
  };

  if (loading) return <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>載入座位圖…</div>;
  if (!map) return <div className="p-6">找不到座位圖。<Link href="/shop" className="btn btn-ghost text-sm ml-2">返回商店</Link></div>;

  const layout = (map.layout || {}) as { width?: number; height?: number; decorations?: LayoutDecoration[] };
  const decorations: LayoutDecoration[] = Array.isArray(layout.decorations) ? layout.decorations : [];
  const pickedSeats = [...picked].map((id) => seatById.get(id)).filter(Boolean) as SeatState[];
  const extraTotal = pickedSeats.reduce((sum, s) => sum + (s.price_delta || 0), 0);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3">
        {orderId
          ? <Link href={`/shop/orders/${orderId}`} className="btn btn-ghost text-sm">← 返回訂單</Link>
          : <Link href="/shop" className="btn btn-ghost text-sm">← 返回商店</Link>}
        <div>
          <h1 className="text-lg font-bold">選擇座位</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {map.name}
            {map.starts_at && `｜${new Date(map.starts_at).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })}`}
          </p>
        </div>
      </div>

      {!map.can_select_now && (
        <div className="rounded-lg p-3 text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
          尚未輪到您劃位
          {map.next_open_at && `，將於 ${new Date(map.next_open_at).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })} 開放`}
          。
        </div>
      )}

      {/* 圖例 */}
      <div className="flex flex-wrap gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
        <Legend label="可選" style={STATE_STYLE.available} />
        <Legend label="已選" style={STATE_STYLE.mine} />
        <Legend label="他人保留" style={STATE_STYLE.held} />
        <Legend label="已售出" style={STATE_STYLE.taken} />
      </div>

      {/* 座位圖 */}
      <div className="overflow-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
        <div className="relative mx-auto" style={{ width: layout.width || 760, height: layout.height || 460, background: "var(--bg-base)" }}>
          {decorations.map((d) => (
            <DecorationView key={d.id} d={d} />
          ))}
          {decorations.length === 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 rounded text-center text-xs"
              style={{ top: 6, width: Math.min((layout.width || 760) - 40, 260), padding: "4px 0", background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
              舞台 / 螢幕
            </div>
          )}
          {map.seats.map((s) => {
            const isPicked = picked.has(s.id);
            const kind: SeatStateKind = isPicked && s.state !== "taken" ? "mine" : s.state;
            if (s.state === "disabled") return null;
            return (
              <button key={s.id} type="button" onClick={() => toggle(s)} title={`${s.label}${s.price_delta ? ` (+$${s.price_delta})` : ""}`}
                className="absolute flex items-center justify-center rounded text-[10px] font-medium"
                style={{ left: s.x, top: s.y, width: SEAT, height: SEAT, border: "1px solid", ...STATE_STYLE[kind] }}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 底部結算列 */}
      <div className="sticky bottom-0 rounded-xl p-3 flex flex-wrap items-center gap-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="text-sm">
          已選 <span className="font-semibold">{picked.size}</span>
          {map.remaining_quota > 0 && <span style={{ color: "var(--text-muted)" }}> / {map.remaining_quota}</span>}
          {pickedSeats.length > 0 && (
            <span className="ml-2" style={{ color: "var(--text-muted)" }}>
              {pickedSeats.map((s) => s.label).join(", ")}
            </span>
          )}
          {extraTotal > 0 && <span className="ml-2" style={{ color: "var(--primary)" }}>加價 +${extraTotal}</span>}
        </div>
        <div className="flex-1" />
        {holding && <span className="text-xs" style={{ color: "var(--text-muted)" }}>保留中…</span>}
        <Countdown expiresAt={map.hold_expires_at} onExpire={load} />
        <button className="btn btn-primary text-sm" onClick={confirm} disabled={confirming || !picked.size || !map.can_select_now}>
          {confirming ? "處理中…" : "確認劃位"}
        </button>
      </div>
    </div>
  );
}

function Legend({ label, style }: { label: string; style: React.CSSProperties }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block rounded" style={{ width: 14, height: 14, border: "1px solid", background: style.background, borderColor: style.borderColor, opacity: style.opacity }} />
      {label}
    </span>
  );
}

function DecorationView({ d }: { d: LayoutDecoration }) {
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
    pointerEvents: "none",
    boxSizing: "border-box",
    zIndex: 1,
  };
  let style: React.CSSProperties;
  switch (d.type) {
    case "screen":
      style = { ...base, background: "var(--bg-elevated)", border: "2px solid var(--border)", color: "var(--text-secondary)", borderRadius: 4 };
      break;
    case "door":
      style = { ...base, background: "rgba(39,174,96,0.12)", border: "1px dashed #27ae60", color: "#27ae60", borderRadius: 4 };
      break;
    case "aisle_h":
      style = { ...base, background: "rgba(127,127,127,0.08)", borderTop: "1px dashed var(--border)", borderBottom: "1px dashed var(--border)", color: "var(--text-muted)" };
      break;
    case "aisle_v":
      style = { ...base, background: "rgba(127,127,127,0.08)", borderLeft: "1px dashed var(--border)", borderRight: "1px dashed var(--border)", color: "var(--text-muted)", fontSize: 10, writingMode: "vertical-rl" };
      break;
    case "label":
      style = { ...base, background: "transparent", color: "var(--text-muted)", fontWeight: 600 };
      break;
    case "box":
    default:
      style = { ...base, background: "rgba(127,127,127,0.06)", border: "1px dashed var(--border)", color: "var(--text-secondary)", borderRadius: 6, alignItems: "flex-start", justifyContent: "flex-start", padding: "4px 6px" };
  }
  return <div style={style}>{d.label}</div>;
}
