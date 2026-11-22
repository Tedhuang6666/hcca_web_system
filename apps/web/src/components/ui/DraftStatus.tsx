"use client";

type DraftStatusProps = {
  lastSavedAt: string | null;
  className?: string;
};

export default function DraftStatus({ lastSavedAt, className }: DraftStatusProps) {
  const message = lastSavedAt
    ? `草稿已於 ${new Date(lastSavedAt).toLocaleTimeString("zh-TW", {
        hour: "2-digit",
        minute: "2-digit",
      })} 自動儲存於此裝置`
    : "變更會自動儲存於此裝置";

  return (
    <p
      className={`text-xs ${className ?? ""}`}
      role="status"
      aria-live="polite"
      style={{ color: "var(--text-muted)" }}
    >
      {message}
    </p>
  );
}
