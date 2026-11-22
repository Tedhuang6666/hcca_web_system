"use client";

import { useId, useState } from "react";
import { apiErrorMessage } from "@/lib/api-helpers";

export function AttachmentNameEditor({ name, onSave }: {
  name: string;
  onSave: (name: string) => Promise<void>;
}) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (saving) return;
    const nextName = value.trim();
    if (!nextName) {
      setError("附件名稱不可為空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(nextName);
      setEditing(false);
    } catch (e) {
      setError(apiErrorMessage(e, "重新命名失敗，請再試一次"));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button type="button" className="min-h-11 px-2 text-xs" onClick={() => {
        setValue(name);
        setError("");
        setEditing(true);
      }} aria-label={`重新命名 ${name}`}>
        重新命名
      </button>
    );
  }

  return (
    <div className="w-full space-y-2">
      <label htmlFor={inputId} className="block text-xs">附件名稱</label>
      <input id={inputId} autoFocus value={value} disabled={saving}
        className="min-h-11 w-full rounded px-3 text-sm"
        style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape" && !saving) {
            setEditing(false);
          }
        }} />
      {error && <p id={`${inputId}-error`} role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary min-h-11" disabled={saving} onClick={() => void save()}>
          {saving ? "儲存中…" : "儲存名稱"}
        </button>
        <button type="button" className="btn btn-secondary min-h-11" disabled={saving} onClick={() => setEditing(false)}>取消</button>
      </div>
    </div>
  );
}
