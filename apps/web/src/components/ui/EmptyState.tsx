"use client";
import Link from "next/link";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  headingLevel?: "h1" | "h2" | "p";
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

export function EmptyState({ icon, title, description, headingLevel = "p", action }: EmptyStateProps) {
  const Heading = headingLevel;
  return (
    <div className="empty-state py-20 text-center flex flex-col items-center gap-3">
      {icon && (
        <div className="empty-state-icon" style={{ color: "var(--text-muted)" }} aria-hidden="true">
          {icon}
        </div>
      )}
      <Heading className="empty-state-title text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </Heading>
      {description && (
        <p className="empty-state-description text-sm max-w-sm" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      )}
      {action && (
        action.href ? (
          <Link href={action.href} className="empty-state-action btn btn-primary mt-1">
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className="empty-state-action btn btn-primary mt-1">
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
