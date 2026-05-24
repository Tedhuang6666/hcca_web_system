"use client";

import { useEffect, useMemo, useState } from "react";

import type { OrgRead, UserSummary } from "@/lib/api";
import { usersApi } from "@/lib/api";
import type { RecipientType } from "@/lib/types";

/**
 * 公文收件人快選器。
 *
 * 與 `targeting.tsx` 的職位/組織模式 picker 互補：本元件是「公文受文者快搜列」，
 * 允許三類輸入混合（使用者搜尋下拉、組織單位快選、自由輸入名稱+Email），每次按
 * 新增即把一筆 recipient 推進外層 state。共用 `usersApi.listForSearch` 並重現
 * `useUserSearch` 的去抖節奏，未抽出共用 hook 是因為本元件還需要與本地 query
 * 共用同一 input、且要同時驅動組織模糊比對。
 */
function useDebouncedUserSuggestions(query: string, limit = 8, delayMs = 250): UserSummary[] {
  const [results, setResults] = useState<UserSummary[]>([]);
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const rs = await usersApi.listForSearch(trimmed);
        setResults(rs.slice(0, limit));
      } catch {
        setResults([]);
      }
    }, delayMs);
    return () => clearTimeout(handle);
  }, [query, limit, delayMs]);
  return results;
}

export type RecipientDraft = {
  recipient_type: RecipientType;
  name: string;
  email: string;
};

export function RecipientSearch({
  onAdd,
  inputStyle,
  selectStyle,
  isMeetingNotice,
  isRecord,
  orgs,
}: {
  onAdd: (r: RecipientDraft) => void;
  inputStyle: React.CSSProperties;
  selectStyle: React.CSSProperties;
  isMeetingNotice: boolean;
  isRecord: boolean;
  orgs: OrgRead[];
}) {
  const [type, setType] = useState<RecipientType>(isMeetingNotice ? "primary" : "main");
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const suggestions = useDebouncedUserSuggestions(query);

  const selectUser = (u: UserSummary) => {
    setQuery(u.display_name);
    setEmail(u.email);
    setShowDropdown(false);
  };

  const add = () => {
    if (!query.trim()) return;
    onAdd({ recipient_type: type, name: query.trim(), email: email.trim() });
    setQuery("");
    setEmail("");
  };

  // 過濾並排序：query 為空時，依名稱排序顯示前 8 個組織；有 query 時做名稱/前綴 fuzzy match
  const orgSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? orgs.filter(
          (o) => o.name.toLowerCase().includes(q) || (o.prefix ?? "").toLowerCase().includes(q),
        )
      : orgs;
    return filtered.slice(0, 8);
  }, [orgs, query]);

  const selectOrg = (o: OrgRead) => {
    onAdd({ recipient_type: type, name: o.name, email: "" });
    setQuery("");
    setEmail("");
    setShowDropdown(false);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={type}
        onChange={(e) => setType(e.target.value as RecipientType)}
        style={{ ...selectStyle, width: "7rem", flexShrink: 0 }}
        aria-label="收件人類型"
      >
        {isMeetingNotice ? (
          <>
            <option value="main">受文者</option>
            <option value="primary">正本（出席）</option>
            <option value="copy">副本（列席）</option>
          </>
        ) : isRecord ? (
          <>
            <option value="main">出席者</option>
            <option value="primary">出席者</option>
            <option value="copy">列席者</option>
          </>
        ) : (
          <>
            <option value="main">受文者</option>
            <option value="primary">正本</option>
            <option value="copy">副本</option>
          </>
        )}
      </select>
      <div className="relative flex-1" style={{ minWidth: "8rem" }}>
        <input
          placeholder="輸入單位 / 姓名 / 學號搜尋，或點此選組織"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            if (e.key === "Escape") setShowDropdown(false);
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          style={{ ...inputStyle, width: "100%" }}
          aria-label="收件人姓名或單位"
          aria-autocomplete="list"
        />
        {showDropdown && (suggestions.length > 0 || orgSuggestions.length > 0) && (
          <div
            className="absolute z-20 left-0 right-0 top-full mt-1 rounded-xl overflow-hidden shadow-lg max-h-72 overflow-y-auto"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            role="listbox"
          >
            {suggestions.length > 0 && (
              <>
                <p
                  className="px-3 py-1 text-[10px] font-semibold"
                  style={{ color: "var(--text-muted)", background: "var(--bg-surface)" }}
                >
                  使用者
                </p>
                {suggestions.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onMouseDown={() => selectUser(u)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:opacity-80"
                    role="option"
                    aria-selected="false"
                  >
                    <div
                      className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                      style={{ background: "var(--primary-dim)", color: "var(--primary)" }}
                    >
                      {u.display_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p style={{ color: "var(--text-primary)" }}>{u.display_name}</p>
                      <p
                        className="truncate text-[10px]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {u.email}
                      </p>
                    </div>
                  </button>
                ))}
              </>
            )}
            {orgSuggestions.length > 0 && (
              <>
                <p
                  className="px-3 py-1 text-[10px] font-semibold"
                  style={{ color: "var(--text-muted)", background: "var(--bg-surface)" }}
                >
                  組織單位（點選快速新增）
                </p>
                {orgSuggestions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onMouseDown={() => selectOrg(o)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:opacity-80"
                    role="option"
                    aria-selected="false"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p style={{ color: "var(--text-primary)" }}>{o.name}</p>
                      {o.prefix && (
                        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          前綴：{o.prefix}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <input
        placeholder="Email（選填）"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        type="email"
        style={{ ...inputStyle, flex: "1", minWidth: "8rem" }}
        aria-label="收件人 Email"
      />
      <button onClick={add} type="button" className="btn btn-ghost flex-shrink-0">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新增
      </button>
    </div>
  );
}
