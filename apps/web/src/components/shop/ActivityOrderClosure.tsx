"use client";

import { useEffect, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { CatalogCategoryOut, CloseStatusItem } from "@/lib/types";

type OrderBatch = Pick<CatalogCategoryOut, "id" | "name">;

export default function ActivityOrderClosure({ categories, disabled = false, onSaved }: {
  categories: OrderBatch[];
  disabled?: boolean;
  onSaved: () => void;
}) {
  const [statuses, setStatuses] = useState<Record<string, CloseStatusItem>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (categories.length === 0) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    void shopApi.getCloseStatus(categories.map((category) => category.id)).then((result) => {
      if (!active) return;
      if (categories.some((category) => !result.statuses[category.id])) {
        throw new Error("Incomplete closure status");
      }
      setStatuses(Object.fromEntries(Object.entries(result.statuses).map(([id, status]) => [
        id, { ...status, is_closed: status.is_closed && status.is_global === true },
      ])));
    }).catch((cause) => {
      if (active) setLoadError(apiErrorMessage(cause, "無法載入鎖單狀態，請重新載入。"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [categories, attempt]);

  if (categories.length === 0) return null;

  async function toggleClosure(category: OrderBatch) {
    const current = statuses[category.id];
    if (busyId || disabled || loading || loadError || !current) return;
    setBusyId(category.id);
    setMessage("");
    setError("");
    try {
      if (current.is_closed) await shopApi.reopenCategory(category.id);
      else await shopApi.closeCategory(category.id, {});
      setStatuses((rows) => ({ ...rows, [category.id]: { ...current, is_closed: !current.is_closed, is_global: !current.is_closed } }));
      onSaved();
      setMessage(!current.is_closed
        ? `「${category.name}」已由班聯結單，商品已從公開目錄隱藏；既有訂單與收款保留。`
        : `「${category.name}」已重新開放並恢復公開顯示，訂購仍依原期限與商品狀態判定。`);
    } catch (cause) {
      setError(apiErrorMessage(cause, "活動鎖單狀態更新失敗，請再試一次。"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="activity-order-closure-title" className="card min-w-0 p-4">
      <h2 id="activity-order-closure-title" className="flex items-center gap-2 text-base font-semibold"
        style={{ color: "var(--text-primary)" }}>
        <Lock size={18} aria-hidden="true" /> 班聯結單與公開入口
      </h2>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        班級繳款後、班聯結單前，班代可協助加購，追加款由該筆訂購同學自行繳交。結單或到達統一截止時間後，學生與班代停止加購；班聯仍可代訂，但追加款仍由該筆訂購同學付款，班聯確認收款後提供收據並歸回原班級。結單會隱藏公開商品入口，既有訂單仍可收款。
      </p>
      {loadError && <div role="alert" className="mt-2 text-sm" style={{ color: "var(--danger)" }}>
        <p>{loadError}</p>
        <button type="button" className="btn btn-ghost min-h-11" onClick={() => setAttempt((value) => value + 1)}>重新載入鎖單狀態</button>
      </div>}
      <ul className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>
        {categories.map((category) => {
          const status = statuses[category.id];
          const closed = Boolean(status?.is_closed);
          return (
            <li key={category.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
              style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-sm font-medium" style={{ color: "var(--text-primary)" }}>{category.name}</h3>
                <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                  {loading ? "載入狀態中…" : loadError || !status
                    ? "狀態待確認"
                    : closed
                      ? "班聯已結單，公開入口已隱藏"
                      : "尚未結單"}
                </p>
              </div>
              <button type="button" disabled={disabled || loading || Boolean(loadError) || !status || busyId !== null}
                aria-label={`${closed ? "重新開放並顯示" : "結單並隱藏入口"}${category.name}`}
                onClick={() => void toggleClosure(category)}
                className="btn btn-secondary min-h-11 shrink-0">
                {closed ? <LockOpen size={15} aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />}
                {busyId === category.id ? "更新中…" : closed ? "重新開放入口" : "結單並隱藏入口"}
              </button>
            </li>
          );
        })}
      </ul>
      {message && <p role="status" className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p>}
      {error && <p role="alert" className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
    </section>
  );
}
