"use client";

import Link from "next/link";
import {
  CheckSquare,
  ChevronRight,
  FileText,
  Landmark,
  ListChecks,
  Megaphone,
  MessageSquare,
  Scale,
} from "lucide-react";

import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import type { DashboardWidget } from "@/lib/api";

type IconProps = { size: number; "aria-hidden": boolean };

function FallbackWidgetIcon(p: IconProps) {
  return <FileText {...p} />;
}

const WIDGET_ICONS: Record<string, React.ComponentType<IconProps>> = {
  doc_draft: (p) => <FileText {...p} />,
  doc_pending_my_approval: (p) => <ListChecks {...p} />,
  meeting_upcoming: (p) => <Landmark {...p} />,
  regulation_review: (p) => <Scale {...p} />,
  regulation_publish: (p) => <Scale {...p} />,
  announcements_recent: (p) => <Megaphone {...p} />,
  petition_assigned: (p) => <MessageSquare {...p} />,
  open_surveys: (p) => <CheckSquare {...p} />,
  today_meal: (p) => <FileText {...p} />,
  class_order_collecting: (p) => <ListChecks {...p} />,
};

const SEVERITY_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  info: {
    color: "var(--primary)",
    bg: "var(--primary-dim)",
    border: "var(--info-border)",
  },
  warning: {
    color: "var(--warning)",
    bg: "var(--warning-dim)",
    border: "var(--warning-border)",
  },
  critical: {
    color: "var(--danger)",
    bg: "var(--danger-dim)",
    border: "var(--danger-border)",
  },
};

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function WidgetCard({ widget, index }: { widget: DashboardWidget; index: number }) {
  const Icon = WIDGET_ICONS[widget.key] ?? FallbackWidgetIcon;
  const severity = SEVERITY_STYLES[widget.severity] ?? SEVERITY_STYLES.info;

  return (
    <section
      aria-labelledby={`widget-${widget.key}`}
      className="dashboard-widget card overflow-hidden flex flex-col"
      style={{ animationDelay: `${Math.min(index * 55, 330)}ms` }}
    >
      <header
        className="px-5 py-4 flex items-center justify-between gap-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: severity.bg,
              color: severity.color,
              border: `1px solid ${severity.border}`,
            }}
            aria-hidden="true"
          >
            <Icon size={16} aria-hidden={true} />
          </div>
          <div className="min-w-0">
            <h2
              id={`widget-${widget.key}`}
              className="text-sm font-semibold truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {widget.title}
            </h2>
            {widget.summary && (
              <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                {widget.summary}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  color: severity.color,
                  background: severity.bg,
                  border: `1px solid ${severity.border}`,
                }}
              >
                優先 {widget.priority_score}
              </span>
              {widget.priority_reasons.slice(0, 1).map((reason) => (
                <span
                  key={reason}
                  className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{ color: "var(--text-secondary)", background: "var(--bg-hover)" }}
                >
                  {reason}
                </span>
              ))}
            </div>
          </div>
        </div>
        {widget.count !== null && widget.count !== undefined && (
          <AnimatedNumber
            value={widget.count}
            cap={99}
            className="dashboard-widget-count text-2xl font-bold leading-none flex-shrink-0"
            style={{ color: severity.color }}
          />
        )}
      </header>

      {widget.items.length > 0 && (
        <ul className="flex-1">
          {widget.items.map((item, itemIndex) => (
            <li
              key={`${widget.key}-${itemIndex}`}
              style={itemIndex < widget.items.length - 1
                ? { borderBottom: "1px solid var(--border)" }
                : {}}
            >
              {item.href ? (
                <Link
                  href={item.href}
                  className="dashboard-widget-row flex items-center gap-3 px-5 py-3"
                  style={{ textDecoration: "none" }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.badge && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{
                            color: severity.color,
                            background: severity.bg,
                            border: `1px solid ${severity.border}`,
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                      {item.subtitle && (
                        <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                          {item.subtitle}
                        </span>
                      )}
                      {item.timestamp && (
                        <span
                          className="text-xs flex-shrink-0 ml-auto"
                          style={{ color: "var(--text-disabled)" }}
                        >
                          {formatDate(item.timestamp)}
                        </span>
                      )}
                    </div>
                    {item.recommended_action && (
                      <p
                        className="mt-1 truncate text-[11px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {item.recommended_action}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={14} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-5 py-3">
                  <p className="text-sm flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                    {item.title}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {widget.href && (
        <Link
          href={widget.href}
          className="dashboard-widget-footer px-5 py-2.5 text-xs font-medium flex items-center justify-end gap-1"
          style={{
            color: "var(--primary-text)",
            borderTop: "1px solid var(--border)",
            textDecoration: "none",
          }}
        >
          查看全部 <ChevronRight size={12} aria-hidden={true} />
        </Link>
      )}
    </section>
  );
}

export default function DashboardWidgets({ widgets }: { widgets: DashboardWidget[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {widgets.map((widget, index) => (
        <WidgetCard key={widget.key} widget={widget} index={index} />
      ))}
    </div>
  );
}
