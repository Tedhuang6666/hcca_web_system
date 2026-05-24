export default function RootLoading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      role="status"
      aria-live="polite"
      aria-label="頁面載入中"
    >
      <div className="flex flex-col items-center gap-3">
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-spin"
          style={{ color: "var(--primary)" }}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>
          載入中…
        </span>
      </div>
    </div>
  );
}
