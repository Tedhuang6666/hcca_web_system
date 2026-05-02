import type { DocumentStatus, OrderStatus, ProductStatus } from "@/lib/types";

// ── 公文狀態 ─────────────────────────────────────────────────────────────────

const DOC_STATUS: Record<DocumentStatus, { label: string; color: string; bg: string; border: string }> = {
  draft:    { label: "草稿",   color: "#94a3b8", bg: "rgba(148,163,184,0.1)", border: "rgba(148,163,184,0.3)" },
  pending:  { label: "待審核", color: "#fb923c", bg: "rgba(251,146,60,0.1)",  border: "rgba(251,146,60,0.3)"  },
  approved: { label: "已核准", color: "#22d3ee", bg: "rgba(34,211,238,0.1)",  border: "rgba(34,211,238,0.3)"  },
  rejected: { label: "已退件", color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.3)" },
  archived: { label: "已封存", color: "#475569", bg: "rgba(71,85,105,0.1)",   border: "rgba(71,85,105,0.3)"   },
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const s = DOC_STATUS[status] ?? DOC_STATUS.draft;
  return (
    <span className="text-xs px-2.5 py-1 rounded-full font-medium"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  );
}

// ── 速別標籤 ─────────────────────────────────────────────────────────────────

export function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<string, { label: string; color: string }> = {
    normal:      { label: "普通",   color: "#94a3b8" },
    urgent:      { label: "速件",   color: "#fb923c" },
    most_urgent: { label: "最速件", color: "#f87171" },
    flash:       { label: "閃電件", color: "#a78bfa" },
  };
  const { label, color } = map[urgency] ?? map.normal;
  return <span className="text-xs font-medium" style={{ color }}>{label}</span>;
}

// ── 商品狀態 ─────────────────────────────────────────────────────────────────

const PRODUCT_STATUS: Record<ProductStatus, { label: string; color: string }> = {
  draft:    { label: "草稿",   color: "#94a3b8" },
  active:   { label: "上架中", color: "#22d3ee" },
  sold_out: { label: "售罄",   color: "#f87171" },
  archived: { label: "已下架", color: "#475569" },
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const s = PRODUCT_STATUS[status] ?? PRODUCT_STATUS.draft;
  return <span className="text-xs font-medium" style={{ color: s.color }}>{s.label}</span>;
}

// ── 訂單狀態 ─────────────────────────────────────────────────────────────────

const ORDER_STATUS: Record<OrderStatus, { label: string; color: string; bg: string; border: string }> = {
  pending:  { label: "待付款", color: "#fb923c", bg: "rgba(251,146,60,0.1)",  border: "rgba(251,146,60,0.3)"  },
  paid:     { label: "已付款", color: "#22d3ee", bg: "rgba(34,211,238,0.1)",  border: "rgba(34,211,238,0.3)"  },
  cancelled:{ label: "已取消", color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.3)" },
  refunded: { label: "已退款", color: "#94a3b8", bg: "rgba(148,163,184,0.1)", border: "rgba(148,163,184,0.3)" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status] ?? ORDER_STATUS.pending;
  return (
    <span className="text-xs px-2.5 py-1 rounded-full font-medium"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  );
}

// ── 法規分類 ─────────────────────────────────────────────────────────────────

export function RegulationCategoryBadge({ category }: { category: string }) {
  const map: Record<string, string> = {
    charter:   "章程", bylaw: "細則", procedure: "辦法", policy: "政策", other: "其他",
  };
  return (
    <span className="text-xs px-2 py-0.5 rounded"
      style={{ color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid var(--border-glow)" }}>
      {map[category] ?? category}
    </span>
  );
}
