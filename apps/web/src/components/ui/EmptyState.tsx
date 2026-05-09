"use client";
import Link from "next/link";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="py-20 text-center flex flex-col items-center gap-3">
      {icon && (
        <div className="opacity-40" style={{ color: "var(--text-muted)" }}>
          {icon}
        </div>
      )}
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{title}</p>
      {description && (
        <p className="text-xs max-w-xs" style={{ color: "var(--text-muted)" }}>{description}</p>
      )}
      {action && (
        action.href ? (
          <Link href={action.href} className="btn btn-primary mt-1">{action.label}</Link>
        ) : (
          <button onClick={action.onClick} className="btn btn-primary mt-1">{action.label}</button>
        )
      )}
    </div>
  );
}

export function EmptyListIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}
