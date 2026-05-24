"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { usersApi, type UserSummary } from "@/lib/api";

/**
 * 學餐管理場景的使用者快選器：輸入 2 字以上以去抖搜尋，結果直接展開為下拉。
 *
 * 與 `RecipientSearch`、`targeting.tsx` 的搜尋同源（`usersApi.listForSearch`），
 * 此處保留獨立元件是因為視覺風格緊密綁定學餐管理頁的卡片配色與圖示（Search icon）。
 */
export function UserPicker({
  placeholder,
  onPick,
}: {
  placeholder: string;
  onPick: (user: UserSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      usersApi
        .listForSearch(query.trim())
        .then((items) => setResults(items.slice(0, 8)))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2 rounded-md px-3 py-2"
        style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}
      >
        <Search size={15} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full bg-transparent text-sm outline-none"
          placeholder={placeholder}
          style={{ color: "var(--text-primary)" }}
          aria-label={placeholder}
        />
      </div>
      {(results.length > 0 || loading) && (
        <div
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-md"
          style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}
          role="listbox"
        >
          {loading && <div className="px-3 py-2 text-xs text-muted">搜尋中...</div>}
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                onPick(user);
                setQuery("");
                setResults([]);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
              style={{ color: "var(--text-primary)" }}
              role="option"
              aria-selected="false"
            >
              <span className="font-medium">{user.display_name}</span>
              <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                {user.email}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
