"use client";

/**
 * 政策同意 Banner，對應 ADR-003。
 *
 * 行為：
 * - 掛在 root layout 之內
 * - 已登入時呼叫 GET /policies/me/pending 取尚未同意的政策
 * - 有 pending → 顯示 modal、必須勾選同意才能繼續操作
 * - 點同意 → POST /policies/me/consents 一次一筆
 *
 * 注意：API base URL 沿用既有 fetch wrapper（lib/api 之類）。
 * 使用相對路徑 fetch，依靠 Next.js rewrite 或同源代理。
 */

import { useCallback, useEffect, useState } from "react";
import { ApiError, policiesApi } from "@/lib/api";
import { normalizeCouncilName } from "@/lib/copy";
import { prefersReducedNetworkUsage } from "@/lib/data-saver";
import type { PendingConsentItem, PolicyKind } from "@/lib/types";

const KIND_LABEL: Record<PolicyKind, string> = {
  privacy: "隱私政策",
  terms_of_service: "服務條款",
  accessibility: "無障礙聲明",
  cookie: "Cookie 政策",
  security: "安全政策",
};

const NO_PENDING_CACHE_PREFIX = "hcca-policy-no-pending";
const NO_PENDING_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function noPendingCacheKey(): string | null {
  if (typeof window === "undefined") return null;
  const userId = localStorage.getItem("user_id");
  return userId ? `${NO_PENDING_CACHE_PREFIX}:${userId}` : null;
}

function hasFreshNoPendingCache(): boolean {
  const key = noPendingCacheKey();
  if (!key) return false;
  const checkedAt = Number(localStorage.getItem(key));
  return Number.isFinite(checkedAt) && Date.now() - checkedAt < NO_PENDING_CACHE_TTL_MS;
}

function writeNoPendingCache() {
  const key = noPendingCacheKey();
  if (key) localStorage.setItem(key, String(Date.now()));
}

function clearNoPendingCache() {
  const key = noPendingCacheKey();
  if (key) localStorage.removeItem(key);
}

export function PolicyConsentBanner({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const [items, setItems] = useState<PendingConsentItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPending = useCallback((force = false) => {
    if (!isAuthenticated) {
      setItems([]);
      return () => {};
    }
    if (!force && hasFreshNoPendingCache()) {
      setItems([]);
      setError(null);
      return () => {};
    }
    if (!force && prefersReducedNetworkUsage()) {
      setItems([]);
      setError(null);
      return () => {};
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await policiesApi.pendingConsents();
        if (cancelled) return;
        setItems(data);
        if (data.length === 0) {
          writeNoPendingCache();
          setError(null);
        } else {
          clearNoPendingCache();
        }
      } catch (e) {
        if (!cancelled && e instanceof ApiError && e.status !== 401) {
          setError(e.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    return loadPending();
  }, [loadPending]);

  useEffect(() => {
    const handler = () => {
      clearNoPendingCache();
      loadPending(true);
    };
    window.addEventListener("hcca:policy-consent-required", handler);
    return () => window.removeEventListener("hcca:policy-consent-required", handler);
  }, [loadPending]);

  const allChecked =
    items.length > 0 && items.every((it) => checked[it.policy_document_id]);

  const submit = useCallback(async () => {
    if (!allChecked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      for (const it of items) {
        try {
          await policiesApi.consent(it.policy_document_id);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409) throw e;
        }
      }
      setItems([]);
      writeNoPendingCache();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [allChecked, items, submitting]);

  // 只有「真的有待同意的政策」時才顯示彈窗。
  // 早期版本在 loading 期間也會 render，導致每次切換頁面、重新查 pending 時
  // 都會閃一次彈窗（即使使用者早已同意）。改為僅依 items 是否非空判斷。
  if (items.length === 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-consent-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        className="w-full max-w-2xl rounded-lg p-6 shadow-xl"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-primary)",
        }}>
        <h2
          id="policy-consent-title"
          className="text-lg font-semibold"
        >
          政策更新通知
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          下列政策已更新或為新增、請閱讀後勾選同意，方能繼續使用本平台。
        </p>

        <ul className="mt-4 space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {items.map((it) => (
              <li
                key={it.policy_document_id}
                className="rounded border p-3"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
              >
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!checked[it.policy_document_id]}
                    onChange={(e) =>
                      setChecked((c) => ({
                        ...c,
                        [it.policy_document_id]: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <span className="block font-medium">
                      {KIND_LABEL[it.kind] ?? it.kind} v{it.version}
                    </span>
                    <span className="block text-sm" style={{ color: "var(--text-secondary)" }}>
                      {normalizeCouncilName(it.title)}
                    </span>
                    {it.summary_md && (
                      <span
                        className="mt-1 block whitespace-pre-line text-xs"
                        style={{ color: "var(--text-muted)" }}>
                        {normalizeCouncilName(it.summary_md)}
                      </span>
                    )}
                    <a
                      href={`/legal/${it.kind}?v=${encodeURIComponent(it.version)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs underline"
                      style={{ color: "var(--primary)" }}
                    >
                      查看完整內容
                    </a>
                  </span>
                </label>
              </li>
            ))}
          </ul>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200"
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={!allChecked || submitting}
            className="btn btn-primary disabled:cursor-not-allowed"
          >
            {submitting ? "提交中…" : "我同意以上政策"}
          </button>
        </div>
      </div>
    </div>
  );
}
