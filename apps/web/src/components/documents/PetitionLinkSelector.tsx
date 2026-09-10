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
    <section aria-labelledby="petition-link-title" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="petition-link-title" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            關聯陳情
          </h3>
          <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>
            關聯後，陳情原文會作為正式附件，隨列印與寄送 PDF 一起附在公文後方。
          </p>
        </div>
        {!selected && (
          <button
            type="button"
            onClick={() => setIsOpen((value) => !value)}
            disabled={disabled}
            className="btn btn-ghost btn-sm min-h-10 shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            aria-expanded={isOpen}
          >
            {isOpen ? "收合案件清單" : "選擇案件"}
          </button>
        )}
      </div>

      {selected ? (
        <div className="rounded-xl px-4 py-3" style={{ background: "var(--primary-dim)" }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide" style={{ color: "var(--primary-text)" }}>
                案號 {selected.case_number} · {STATUS_LABEL[selected.status] ?? selected.status}
              </p>
              <p className="mt-1 break-words text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {selected.title}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <Link href={`/petitions/${selected.id}`} className="font-medium hover:underline" style={{ color: "var(--primary-text)" }}>
                查看案件
              </Link>
              <button
                type="button"
                onClick={() => onSelect(null)}
                disabled={disabled}
                className="font-medium hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                style={{ color: "var(--text-secondary)" }}
              >
                解除關聯
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs leading-5" style={{ color: "var(--text-muted)" }}>
          未關聯案件時，公文仍可照常建立與發送。
        </p>
      )}

      {isOpen && !selected && (
        <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="以案號或案件標題搜尋"
            className="input w-full"
            disabled={loading || disabled}
            aria-label="搜尋可關聯陳情案件"
          />
          {loading && <p className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>載入案件中…</p>}
          {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              沒有符合的可關聯案件。
            </p>
          )}
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item);
                setIsOpen(false);
                setQuery("");
              }}
              className="w-full rounded-lg px-3 py-3 text-left transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2"
              style={{ background: "var(--bg-hover)", color: "var(--text-primary)" }}
            >
              <span className="block text-xs font-semibold" style={{ color: "var(--primary-text)" }}>
                {item.case_number} · {STATUS_LABEL[item.status] ?? item.status}
              </span>
              <span className="mt-1 block truncate text-sm">{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
