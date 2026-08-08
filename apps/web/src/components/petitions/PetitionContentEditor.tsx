"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api-helpers";
import { petitionsApi } from "@/lib/api/petitions";
import type { PetitionCaseOut } from "@/lib/types";

type Props = {
  item: PetitionCaseOut;
  verificationCode?: string;
  onUpdated: (item: PetitionCaseOut) => void;
};

export default function PetitionContentEditor({ item, verificationCode, onUpdated }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setTitle(item.title);
      setContent(item.content);
    }
  }, [editing, item.content, item.title]);

  if (!item.can_edit_content && !editing) {
    return null;
  }

  const cancel = () => {
    setTitle(item.title);
    setContent(item.content);
    setEditing(false);
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("標題與內容不可空白");
      return;
    }
    setSaving(true);
    try {
      const updated = await petitionsApi.updateContent(item.id, {
        title: title.trim(),
        content: content.trim(),
        verification_code: verificationCode || null,
      });
      onUpdated(updated);
      setEditing(false);
      toast.success("陳情內容已更新");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "更新陳情內容失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">編輯陳情內容</h2>
          <p className="text-sm mt-1 text-muted">案件尚未分案前可以修改標題與內容。</p>
        </div>
        {!editing && (
          <button className="btn btn-ghost" onClick={() => setEditing(true)}>編輯</button>
        )}
      </div>
      {editing && (
        <>
          <input
            className="input w-full"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="陳情標題"
          />
          <textarea
            className="input w-full min-h-40"
            maxLength={10000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="陳情內容"
          />
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" disabled={saving} onClick={cancel}>取消</button>
            <button className="btn btn-primary" disabled={saving} onClick={save}>
              {saving ? "儲存中..." : "儲存修改"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
