import type { DocumentStatus, OrderStatus, PetitionStatus, ProductStatus } from "@/lib/types";

/* ── 統一徽章基礎 ─────────────────────────────────────────────────────────── */
interface BadgeDef { label: string; color: string; bg: string; border: string }

function StatusDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
      style={{ background: color }}
      aria-hidden="true"
    />
  );
}

function Badge({ label, color, bg, border }: BadgeDef) {
  return (
    <span
      className="badge"
      style={{ color, background: bg, borderColor: border }}>
      <StatusDot color={color} />
      {label}
    </span>
  );
}

/* ── 公文狀態 ─────────────────────────────────────────────────────────────── */
const DOC_STATUS: Record<DocumentStatus, BadgeDef> = {
  draft: {
    label: "草稿",
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
    border: "var(--border)",
  },
  pending: {
    label: "待審核",
    color: "var(--warning)",
    bg: "var(--warning-dim)",
    border: "var(--warning-border)",
  },
  approved: {
    label: "已核准",
    color: "var(--success)",
    bg: "var(--success-dim)",
    border: "var(--success-border)",
  },
  rejected: {
    label: "已退件",
    color: "var(--danger)",
    bg: "var(--danger-dim)",
    border: "var(--danger-border)",
  },
  archived: {
    label: "已封存",
    color: "var(--info)",
    bg: "var(--info-dim)",
    border: "var(--info-border)",
  },
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return <Badge {...(DOC_STATUS[status] ?? DOC_STATUS.draft)} />;
}

/* ── 速別 ─────────────────────────────────────────────────────────────────── */
export function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<string, BadgeDef> = {
    normal: {
      label: "普通件",
      color: "var(--text-muted)",
      bg: "var(--bg-hover)",
      border: "var(--border)",
    },
    priority: {
      label: "速件",
      color: "var(--warning)",
      bg: "var(--warning-dim)",
      border: "var(--warning-border)",
    },
    express: {
      label: "最速件",
      color: "var(--danger)",
      bg: "var(--danger-dim)",
      border: "var(--danger-border)",
    },
  };
  return <Badge {...(map[urgency] ?? map.normal)} />;
}

/* ── 商品狀態 ─────────────────────────────────────────────────────────────── */
const PRODUCT_STATUS: Record<ProductStatus, BadgeDef> = {
  draft: {
    label: "草稿",
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
    border: "var(--border)",
  },
  active: {
    label: "上架中",
    color: "var(--success)",
    bg: "var(--success-dim)",
    border: "var(--success-border)",
  },
  sold_out: {
    label: "售罄",
    color: "var(--danger)",
    bg: "var(--danger-dim)",
    border: "var(--danger-border)",
  },
  cancelled: {
    label: "已下架",
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
    border: "var(--border)",
  },
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return <Badge {...(PRODUCT_STATUS[status] ?? PRODUCT_STATUS.draft)} />;
}

/* ── 訂單狀態 ─────────────────────────────────────────────────────────────── */
const ORDER_STATUS: Record<OrderStatus, BadgeDef> = {
  pending: {
    label: "待確認",
    color: "var(--warning)",
    bg: "var(--warning-dim)",
    border: "var(--warning-border)",
  },
  confirmed: {
    label: "已確認",
    color: "var(--success)",
    bg: "var(--success-dim)",
    border: "var(--success-border)",
  },
  cancelled: {
    label: "已取消",
    color: "var(--danger)",
    bg: "var(--danger-dim)",
    border: "var(--danger-border)",
  },
  refunded: {
    label: "已退款",
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
    border: "var(--border)",
  },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge {...(ORDER_STATUS[status] ?? ORDER_STATUS.pending)} />;
}

/* ── 陳情狀態 ─────────────────────────────────────────────────────────────── */
const PETITION_STATUS: Record<PetitionStatus, BadgeDef> = {
  submitted: {
    label: "已收件",
    color: "var(--primary)",
    bg: "var(--primary-dim)",
    border: "var(--info-border)",
  },
  assigned: {
    label: "已分案",
    color: "var(--info)",
    bg: "var(--info-dim)",
    border: "var(--info-border)",
  },
  in_progress: {
    label: "承辦中",
    color: "var(--warning)",
    bg: "var(--warning-dim)",
    border: "var(--warning-border)",
  },
  needs_info: {
    label: "等待補件",
    color: "var(--danger)",
    bg: "var(--danger-dim)",
    border: "var(--danger-border)",
  },
  transferred: {
    label: "已轉派",
    color: "var(--info)",
    bg: "var(--info-dim)",
    border: "var(--info-border)",
  },
  resolved: {
    label: "已回覆",
    color: "var(--success)",
    bg: "var(--success-dim)",
    border: "var(--success-border)",
  },
  closed: {
    label: "已結案",
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
    border: "var(--border)",
  },
  rejected: {
    label: "不受理",
    color: "var(--danger)",
    bg: "var(--danger-dim)",
    border: "var(--danger-border)",
  },
};

export function PetitionStatusBadge({ status }: { status: PetitionStatus }) {
  return <Badge {...(PETITION_STATUS[status] ?? PETITION_STATUS.submitted)} />;
}

/* ── 法規分類 ─────────────────────────────────────────────────────────────── */
const REG_CATEGORY_MAP: Record<string, { label: string; color: string }> = {
  constitution:       { label: "憲章",       color: "#D97706" },
  ordinance:          { label: "條例",       color: "#059669" },
  procedure:          { label: "辦法",       color: "#2563EB" },
};

export function RegulationCategoryBadge({ category }: { category: string }) {
  const { label, color } = REG_CATEGORY_MAP[category] ?? { label: category, color: "#64748B" };
  return (
    <span
      className="badge"
      style={{
        color,
        background: `${color}18`,
        borderColor: `${color}40`,
      }}>
      {label}
    </span>
  );
}

export const REGULATION_CATEGORY_LABELS = Object.fromEntries(
  Object.entries(REG_CATEGORY_MAP).map(([k, v]) => [k, v.label])
) as Record<string, string>;
