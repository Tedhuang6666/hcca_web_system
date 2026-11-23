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
      className="min-w-0 border-y border-y-[color:var(--public-border,var(--border))] py-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3
            id="petition-link-title"
            className="text-base font-semibold text-fg-primary!"
          >
            關聯陳情案件
          </h3>
          <p className="mt-1 max-w-2xl break-words text-sm leading-6 text-fg-secondary!">
            案件原文會作為正式附件隨公文列印與寄送；發文後也會寫入案件時間軸。
          </p>
        </div>
        {!selected && (
          <button
            type="button"
            onClick={() => setIsOpen((value) => !value)}
            disabled={disabled}
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg border border-[color:var(--public-border,var(--border))] px-4 text-sm font-semibold text-[color:var(--public-accent,var(--primary-text))] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            aria-expanded={isOpen}
          >
            {isOpen ? "收合案件清單" : "選擇案件"}
          </button>
        )}
      </div>

      {selected ? (
        <div
          className="mt-5 min-w-0 overflow-hidden rounded-xl border border-[color:var(--public-border,var(--border))] bg-[var(--public-surface,var(--bg-surface))]"
        >
          <dl
            className="grid grid-cols-1 gap-3 border-b border-b-[color:var(--public-border,var(--border))] bg-[var(--public-soft,var(--bg-hover))] px-4 py-3 text-sm sm:grid-cols-2"
          >
            <div>
              <dt className="text-xs text-fg-muted!">案件案號</dt>
              <dd className="mt-1 break-words font-semibold text-fg-primary!">
                {selected.case_number}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted!">目前狀態</dt>
              <dd className="mt-1 break-words font-semibold text-fg-primary!">
                {STATUS_LABEL[selected.status] ?? selected.status}
              </dd>
            </div>
          </dl>
          <div className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-fg-primary!">
                {selected.title}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-sm sm:flex-nowrap">
              <Link
                href={`/petitions/${selected.id}`}
                className="inline-flex min-h-11 items-center px-3 font-semibold text-[color:var(--public-accent,var(--primary-text))] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                查看案件
              </Link>
              <button
                type="button"
                onClick={() => onSelect(null)}
                disabled={disabled}
                className="inline-flex min-h-11 items-center px-3 font-semibold text-fg-secondary! underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                解除關聯
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 border-t border-t-[color:var(--public-border,var(--border))] pt-3">
          <p className="break-words text-sm leading-6 text-fg-secondary!">
            尚未關聯案件；公文仍可照常建立與發送。
          </p>
        </div>
      )}

      {isOpen && !selected && (
        <div className="mt-5 border-t border-t-[color:var(--public-border,var(--border))] pt-4">
          <label className="block text-sm font-semibold" htmlFor="petition-link-search">
            搜尋可關聯案件
          </label>
          <input
            id="petition-link-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="輸入案號或案件標題"
            className="input mt-2 min-h-11 w-full"
            disabled={loading || disabled}
          />
          <div
            className="mt-3 min-w-0 overflow-hidden rounded-xl border border-[color:var(--public-border,var(--border))] bg-[var(--public-surface,var(--bg-surface))]"
          >
            {loading && (
              <p className="px-4 py-5 text-center text-sm text-fg-secondary!">
                載入案件中…
              </p>
            )}
            {error && (
              <p className="px-4 py-5 text-sm text-danger!">
                {error}
              </p>
            )}
            {!loading && !error && filtered.length === 0 && (
              <p className="px-4 py-5 text-center text-sm text-fg-secondary!">
                沒有符合的可關聯案件。
              </p>
            )}
            {!loading && !error && filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item);
                  setIsOpen(false);
                  setQuery("");
                }}
                className="w-full border-t border-t-[color:var(--public-border,var(--border))] px-4 py-3 text-left text-fg-primary! transition-colors first:border-t-0 hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              >
                <span className="block text-xs text-fg-muted!">
                  案號 {item.case_number}　·　{STATUS_LABEL[item.status] ?? item.status}
                </span>
                <span className="mt-1 block break-words text-sm font-semibold">{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
