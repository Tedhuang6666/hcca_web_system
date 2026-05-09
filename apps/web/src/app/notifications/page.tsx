"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { notificationsApi, ApiError } from "@/lib/api";
import type { NotificationItem } from "@/lib/api";
import { useWS } from "@/hooks/useWS";

// ── 通知類型設定 ──────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  document_pending: {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    color: "var(--warning)", label: "待審核",
  },
  document_approved: {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>,
    color: "var(--success)", label: "已核准",
  },
  document_rejected: {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
    color: "var(--danger)", label: "已退件",
  },
  document_recalled: {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.12"/></svg>,
    color: "var(--text-muted)", label: "已撤回",
  },
  petition_assigned: {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>,
    color: "var(--primary)", label: "陳情分案",
  },
  petition_replied: {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>,
    color: "var(--success)", label: "陳情回覆",
  },
  petition_needs_info: {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>,
    color: "var(--warning)", label: "陳情補件",
  },
  petition_closed: {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
    color: "var(--text-muted)", label: "陳情結案",
  },
  system: {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3zm-8.27 4a2 2 0 0 1-3.46 0"/></svg>,
    color: "var(--primary)", label: "系統公告",
  },
};

function getMeta(type: string) {
  return TYPE_META[type] ?? {
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    color: "var(--text-muted)", label: type,
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-TW");
}

// ── 單則通知卡片 ──────────────────────────────────────────────────────────────

function NotificationCard({
  n, onRead,
}: {
  n: NotificationItem;
  onRead: (id: string) => void;
}) {
  const meta = getMeta(n.type);
  const safeInternalLink = typeof n.link === "string" && n.link.startsWith("/") ? n.link : null;

  const card = (
    <div
      className="flex items-start gap-3 px-4 py-3.5 transition-colors rounded-lg cursor-pointer"
      style={{
        background: n.is_read ? "transparent" : "var(--primary-dim)",
        border: "1px solid var(--border)",
        opacity: n.is_read ? 0.7 : 1,
      }}
      onClick={() => { if (!n.is_read) onRead(n.id); }}>

      {/* 圖示 */}
      <div
        className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center"
        style={{
          background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)`,
          color: meta.color,
        }}>
        {meta.icon}
      </div>

      {/* 內容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className="text-sm leading-snug"
            style={{ color: n.is_read ? "var(--text-muted)" : "var(--text-primary)", fontWeight: n.is_read ? 400 : 500 }}>
            {n.title}
          </p>
          {!n.is_read && (
            <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
              style={{ background: "var(--primary)" }} aria-label="未讀" />
          )}
        </div>
        {n.body && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{n.body}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: meta.color, background: `${meta.color}18` }}>
            {meta.label}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-disabled)" }}>
            {timeAgo(n.created_at)}
          </span>
        </div>
      </div>
    </div>
  );

  if (safeInternalLink) {
    return (
      <Link href={safeInternalLink} className="block" style={{ textDecoration: "none" }}>
        {card}
      </Link>
    );
  }
  return card;
}

// ── 主頁面 ────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [wsRoom, setWsRoom] = useState<string | null>(null);

  // 取得使用者 ID 以訂閱專屬 WS 房間
  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    if (userId) setWsRoom(`user:${userId}`);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [list, counts] = await Promise.all([
        notificationsApi.list(unreadOnly, 80),
        notificationsApi.count(),
      ]);
      setItems(list);
      setUnreadCount(counts.unread);
    } catch (e) {
      setLoadError(true);
      toast.error(e instanceof ApiError ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 定期輪詢（30 秒）確保通知即時性
  useEffect(() => {
    const timer = setInterval(fetchAll, 30_000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  // 訂閱 WebSocket：收到 document_* 事件時重新載入通知列表
  useWS(wsRoom, useCallback((msg) => {
    if (typeof msg.type === "string" && msg.type.startsWith("document")) {
      fetchAll();
    }
  }, [fetchAll]));

  const handleRead = async (id: string) => {
    try {
      await notificationsApi.markRead(id);
      setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount(c => Math.max(0, c - 1));
    } catch { /* ignore */ }
  };

  const handleReadAll = async () => {
    try {
      const r = await notificationsApi.markAllRead();
      if (r.marked_read === 0) { toast.info("沒有未讀通知"); return; }
      setItems(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
      toast.success(`已將 ${r.marked_read} 則通知標記為已讀`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失敗");
    }
  };

  const displayed = unreadOnly ? items.filter(n => !n.is_read) : items;

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* 頁首 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            通知中心
            {unreadCount > 0 && (
              <span
                className="ml-2 text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--info-border)" }}>
                {unreadCount} 未讀
              </span>
            )}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            公文審核、系統通知與重要提醒
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleReadAll}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
            全部標為已讀
          </button>
        )}
      </div>

      {/* 篩選 */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        {[
          { key: false, label: `全部${items.length > 0 ? ` (${items.length})` : ""}` },
          { key: true,  label: `未讀${unreadCount > 0 ? ` (${unreadCount})` : ""}` },
        ].map(({ key, label }) => (
          <button
            key={String(key)}
            onClick={() => setUnreadOnly(key)}
            className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
            style={unreadOnly === key
              ? { background: "var(--primary-dim)", border: "1px solid var(--border-strong)", color: "var(--primary)" }
              : { color: "#475569" }}>
            {label}
          </button>
        ))}
      </div>

      {/* 通知列表 */}
      {loading ? (
        <div className="flex flex-col items-center py-20 gap-3" style={{ color: "var(--text-muted)" }}
          role="status" aria-live="polite" aria-label="載入中">
          <div className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }}
            aria-hidden="true" />
          <p className="text-sm">載入中…</p>
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center py-20 gap-4" style={{ color: "var(--text-muted)" }}
          role="alert" aria-live="assertive">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="opacity-40" style={{ color: "var(--danger)" }} aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm">載入通知失敗，請稍後再試</p>
          <button
            onClick={fetchAll}
            className="btn btn-ghost text-sm px-5"
            style={{ border: "1px solid var(--border-strong)" }}>
            重新載入
          </button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3" style={{ color: "var(--text-muted)" }}
          aria-live="polite">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="opacity-30" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <p className="text-sm">
            {unreadOnly ? "目前沒有未讀通知" : "還沒有任何通知"}
          </p>
        </div>
      ) : (
        <ol className="space-y-2 list-none" aria-label="通知列表" aria-live="polite">
          {displayed.map(n => (
            <li key={n.id}>
              <NotificationCard n={n} onRead={handleRead} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
