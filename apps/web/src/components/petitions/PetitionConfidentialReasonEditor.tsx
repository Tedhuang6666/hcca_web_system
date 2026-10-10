"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ApiError, petitionsApi } from "@/lib/api";

export function PetitionConfidentialReasonEditor({
  caseId,
  reason,
  onUpdated,
}: {
  caseId: string;
  reason: string | null | undefined;
  onUpdated: (reason: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(reason ?? "");
  const [busy, setBusy] = useState(false);
  const inputId = `confidential-reason-${caseId}`;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !value.trim()) return;

    setBusy(true);
    try {
      const updated = await petitionsApi.setConfidential(caseId, value.trim());
      onUpdated(updated.confidential_reason);
      setValue(updated.confidential_reason);
      setEditing(false);
      toast.success("密件原因已更新");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "更新密件原因失敗");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setValue(reason ?? "");
            setEditing(true);
          }}
        >
          編輯原因
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={save}>
      <label className="block space-y-1" htmlFor={inputId}>
        <span className="text-sm font-medium">密件原因</span>
        <textarea
          id={inputId}
          className="input w-full min-h-24"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={2000}
          required
          autoFocus
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
          {busy ? "儲存中…" : "儲存密件原因"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          取消
        </button>
      </div>
    </form>
  );
}
