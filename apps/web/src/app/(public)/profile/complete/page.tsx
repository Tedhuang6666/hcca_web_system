"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { ApiError, apiErrorMessage, authApi, classApi } from "@/lib/api";
import { cacheCurrentUser } from "@/lib/auth-cache";
import { confirmationReturnPath } from "@/lib/login-destination";
import type { ClassConfirmationOut } from "@/lib/types";
import styles from "./page.module.css";

export default function CompleteProfilePage() {
  const router = useRouter();
  const [data, setData] = useState<ClassConfirmationOut | null>(null);
  const [classId, setClassId] = useState("");
  const [seatNumber, setSeatNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const returnPath = useCallback(() => confirmationReturnPath(
    new URLSearchParams(window.location.search).get("next"),
  ), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await classApi.myConfirmation();
      if (!result.required) {
        router.replace(returnPath());
        return;
      }
      setData(result);
      setClassId(result.current_class?.id ?? "");
      setSeatNumber(result.current_class?.seat_number?.toString() ?? "");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.replace(`/login?${new URLSearchParams({
          next: returnPath(),
        })}`);
      } else {
        setError(apiErrorMessage(cause, "無法載入班級資料，請重試。"));
      }
    } finally {
      setLoading(false);
    }
  }, [returnPath, router]);

  useEffect(() => { void load(); }, [load]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await classApi.confirmClass({
        class_id: classId, seat_number: Number(seatNumber),
      });
      if (result.required) {
        setError("班級資料已變動，請重新載入後確認。");
        return;
      }
      setSaved(true);
      // 更新 auth/me 短期快取；資料已儲存時，網路失敗仍可繼續。
      try { cacheCurrentUser(await authApi.refresh()); } catch { /* 下頁會重新驗證 session。 */ }
      router.replace(returnPath());
    } catch (cause) {
      setError(apiErrorMessage(cause, "儲存失敗，請確認班級座號後重試。"));
    } finally {
      setSaving(false);
    }
  }

  const hasOptions = Boolean(data?.class_options.length);

  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <h1>確認班級與座號</h1>
        <p className={styles.intro}>
          {data?.current_class
            ? "已找到你的班級資料，請覆核班級與座號；若有誤，可直接修改後儲存。"
            : "首次登入請設定目前的班級與座號，供班級服務與訂購歸戶使用。"}
        </p>

        {loading ? (
          <p role="status" className={styles.status}>
            <Loader2 size={20} className="animate-spin" aria-hidden="true" /> 載入班級資料中…
          </p>
        ) : saved ? (
          <div role="status" className={styles.panel}>
            <p>班級與座號已確認。</p>
            <Link href={returnPath()} className={styles.primary}>繼續前往原頁面</Link>
          </div>
        ) : data ? (
          <form onSubmit={handleSubmit} className={styles.panel} aria-busy={saving}>
            <p className={styles.identity}>學號 <strong>{data.student_id}</strong></p>
            {error && <p role="alert" className={styles.error}>{error}</p>}
            {hasOptions ? (
              <>
                <div className={styles.group}>
                  <label htmlFor="confirmation-class">班級</label>
                  <select
                    id="confirmation-class" value={classId} required disabled={saving}
                    onChange={(event) => { setClassId(event.target.value); setSeatNumber(""); }}
                    aria-describedby="class-hint"
                  >
                    <option value="" disabled>請選擇目前的班級</option>
                    {data.class_options.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.academic_year} 學年度 · {item.label || `${item.class_code} 班`}
                      </option>
                    ))}
                  </select>
                  <p id="class-hint">只顯示目前啟用的班級。</p>
                </div>
                <div className={styles.group}>
                  <label htmlFor="confirmation-seat">座號</label>
                  <input
                    id="confirmation-seat" type="number" inputMode="numeric"
                    min={1} max={999} step={1} required value={seatNumber} disabled={saving}
                    onChange={(event) => setSeatNumber(event.target.value)}
                    aria-describedby="seat-hint"
                  />
                  <p id="seat-hint">請填寫你在班上的座號。</p>
                </div>
                <button type="submit" className={styles.primary} disabled={saving || !classId || !seatNumber}>
                  {saving ? "儲存中…" : data.current_class ? "確認資料並繼續" : "儲存班級座號並繼續"}
                </button>
              </>
            ) : (
              <div role="status">
                <p>目前尚未開放班級設定，請聯絡管理員建立班級後再確認。</p>
                <Link href="/contact">聯絡管理員</Link>
                <button type="button" className={styles.secondary} onClick={() => void load()}>重新載入</button>
              </div>
            )}
          </form>
        ) : (
          <div className={styles.panel}>
            <p role="alert" className={styles.error}>{error}</p>
            <button type="button" className={styles.primary} onClick={() => void load()}>重新載入</button>
          </div>
        )}
        <Link href="/" className={styles.home}>回到首頁</Link>
      </div>
    </main>
  );
}
