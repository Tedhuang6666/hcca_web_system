"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiErrorMessage, petitionsApi } from "@/lib/api";

export type PetitionLinkOption = {
  id: string;
  case_number: string;
  title: string;
  status: string;
};

type PetitionLinkSelectorProps = {
  selected: PetitionLinkOption | null;
  onSelect: (item: PetitionLinkOption | null) => void;
  disabled?: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  submitted: "已收件",
  assigned: "已分案",
  in_progress: "承辦中",
  needs_info: "等待補件",
  transferred: "已轉派",
  resolved: "已回覆",
  closed: "已結案",
  rejected: "不受理",
};

export function PetitionLinkSelector({
  selected,
  onSelect,
  disabled = false,
}: PetitionLinkSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PetitionLinkOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen || hasLoaded || loading) return;
    setLoading(true);
    setHasLoaded(true);
    setError("");
    petitionsApi
      .manage()
      .then((cases) => {
        setItems(
          cases.map((item) => ({
            id: item.id,
            case_number: item.case_number,
            title: item.title,
            status: item.status,
          })),
        );
      })
      .catch((err) => setError(apiErrorMessage(err, "無法載入可關聯的陳情案件")))
      .finally(() => setLoading(false));
  }, [hasLoaded, isOpen, loading]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items.slice(0, 8);
    return items
      .filter((item) => `${item.case_number} ${item.title}`.toLowerCase().includes(normalized))
      .slice(0, 8);
  }, [items, query]);

  return (
    <section
      aria-labelledby="petition-link-title"
      className="border-y py-5"
      style={{ borderColor: "var(--public-border, var(--border))" }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3
            id="petition-link-title"
            className="text-base font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            關聯陳情案件
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
            案件原文會作為正式附件隨公文列印與寄送；發文後也會寫入案件時間軸。
          </p>
        </div>
        {!selected && (
          <button
            type="button"
            onClick={() => setIsOpen((value) => !value)}
            disabled={disabled}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              borderColor: "var(--public-border, var(--border))",
              color: "var(--public-accent, var(--primary-text))",
            }}
            aria-expanded={isOpen}
          >
            {isOpen ? "收合案件清單" : "選擇案件"}
          </button>
        )}
      </div>

      {selected ? (
        <div
          className="mt-5 overflow-hidden rounded-xl border"
          style={{
            borderColor: "var(--public-border, var(--border))",
            background: "var(--public-surface, var(--bg-surface))",
          }}
        >
          <dl
            className="grid gap-3 border-b px-4 py-3 text-sm sm:grid-cols-2"
            style={{
              borderColor: "var(--public-border, var(--border))",
              background: "var(--public-soft, var(--bg-hover))",
            }}
          >
            <div>
              <dt className="text-xs" style={{ color: "var(--text-muted)" }}>案件案號</dt>
              <dd className="mt-1 font-semibold" style={{ color: "var(--text-primary)" }}>
                {selected.case_number}
              </dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: "var(--text-muted)" }}>目前狀態</dt>
              <dd className="mt-1 font-semibold" style={{ color: "var(--text-primary)" }}>
                {STATUS_LABEL[selected.status] ?? selected.status}
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {selected.title}
              </p>
            </div>
            <div className="flex items-center gap-1 text-sm">
              <Link
                href={`/petitions/${selected.id}`}
                className="inline-flex min-h-11 items-center px-3 font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ color: "var(--public-accent, var(--primary-text))" }}
              >
                查看案件
              </Link>
              <button
                type="button"
                onClick={() => onSelect(null)}
                disabled={disabled}
                className="inline-flex min-h-11 items-center px-3 font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ color: "var(--text-secondary)" }}
              >
                解除關聯
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 border-t pt-3" style={{ borderColor: "var(--public-border, var(--border))" }}>
          <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
            尚未關聯案件；公文仍可照常建立與發送。
          </p>
        </div>
      )}

      {isOpen && !selected && (
        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--public-border, var(--border))" }}>
          <label className="block text-sm font-semibold" htmlFor="petition-link-search">
            搜尋可關聯案件
          </label>
          <input
            id="petition-link-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="輸入案號或案件標題"
            className="input mt-2 w-full"
            disabled={loading || disabled}
          />
          <div
            className="mt-3 overflow-hidden rounded-xl border"
            style={{
              borderColor: "var(--public-border, var(--border))",
              background: "var(--public-surface, var(--bg-surface))",
            }}
          >
            {loading && (
              <p className="px-4 py-5 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                載入案件中…
              </p>
            )}
            {error && (
              <p className="px-4 py-5 text-sm" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
            {!loading && !error && filtered.length === 0 && (
              <p className="px-4 py-5 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
                沒有符合的可關聯案件。
              </p>
            )}
            {!loading && !error && filtered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item);
                  setIsOpen(false);
                  setQuery("");
                }}
                className="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                style={{
                  borderTop: index === 0 ? undefined : "1px solid var(--public-border, var(--border))",
                  color: "var(--text-primary)",
                }}
              >
                <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                  案號 {item.case_number}　·　{STATUS_LABEL[item.status] ?? item.status}
                </span>
                <span className="mt-1 block truncate text-sm font-semibold">{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
