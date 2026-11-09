"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { ShopTeacherProfileOut } from "@/lib/types";
import styles from "./TeacherPurchaseProfile.module.css";

export default function TeacherPurchaseProfile() {
  const id = useId();
  const [profile, setProfile] = useState<ShopTeacherProfileOut | null>(null);
  const [name, setName] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await shopApi.teacherProfile();
      setProfile(data);
      setName(data?.name ?? "");
      setOfficeId(data?.office_id ?? "");
    } catch (error) {
      setLoadError(apiErrorMessage(error, "無法載入訂購資料，請重試。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className={styles.status} role="status">正在載入訂購資料…</p>;
  if (loadError) return <div className={styles.panel} role="alert">
    <p>{loadError}</p><button type="button" className={styles.button} onClick={() => void load()}>重新載入訂購資料</button>
  </div>;
  if (!profile) return null;

  const available = profile.offices.some((office) => office.id === officeId);
  const dirty = name !== (profile.name ?? "") || officeId !== (profile.office_id ?? "");
  const change = () => { setSaved(false); setSaveError(""); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !name.trim() || !available) return;
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const data = await shopApi.saveTeacherProfile({ name: name.trim(), office_id: officeId });
      setProfile(data);
      setName(data.name ?? "");
      setOfficeId(data.office_id ?? "");
      setSaved(true);
    } catch (error) {
      setSaveError(apiErrorMessage(error, "訂購資料未儲存，請重試。"));
    } finally { setSaving(false); }
  };

  return <section className={styles.panel} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>教師訂購資料</h2>
    <p id={`${id}-help`}>設定商品發放時使用的姓名與辦公室／處室。儲存後套用至新訂單，既有訂單保留原資料。</p>
    <form className={styles.form} onSubmit={submit} aria-describedby={`${id}-help`}>
      <label htmlFor={`${id}-name`}>姓名
        <input id={`${id}-name`} autoComplete="name" required maxLength={100} value={name} disabled={saving}
          onChange={(event) => { setName(event.target.value); change(); }} />
      </label>
      <label htmlFor={`${id}-office`}>辦公室／處室
        <select id={`${id}-office`} required value={officeId} disabled={saving || profile.offices.length === 0}
          onChange={(event) => { setOfficeId(event.target.value); change(); }}>
          <option value="">請選擇處室</option>
          {!available && officeId && <option value={officeId} disabled>{profile.office_name}（已停用，請重新選擇）</option>}
          {profile.offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
        </select>
      </label>
      <button className={styles.button} type="submit" disabled={saving || !dirty || !name.trim() || !available}>
        {saving ? "儲存中…" : "儲存訂購資料"}
      </button>
    </form>
    {profile.offices.length === 0 && <p role="status">目前沒有可選處室，請聯絡商品管理員新增選項。</p>}
    {saveError && <p className={styles.error} role="alert">{saveError}</p>}
    {saved && <p className={styles.success} role="status">訂購資料已儲存。</p>}
  </section>;
}
