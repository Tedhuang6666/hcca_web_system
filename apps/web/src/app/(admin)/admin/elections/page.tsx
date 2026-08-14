"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { electionsApi } from "@/lib/api";
import type { ElectionListItem } from "@/lib/types";

const statusLabel = {
  draft: "草稿",
  live: "開票中",
  paused: "已暫停",
  closed: "已完成",
};

export default function ElectionsAdminPage() {
  const [items, setItems] = useState<ElectionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    electionsApi
      .list()
      .then(setItems)
      .catch(() => toast.error("無法載入選舉"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">即時開票</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            建立選舉、控制票匭與查看完整操作紀錄
          </p>
        </div>
        <Link className="btn btn-primary" href="/admin/elections/new">
          建立選舉
        </Link>
      </div>
      {loading ? (
        <div className="card p-8">載入中…</div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/admin/elections/${item.id}/count`}
              className="card card-hover p-5 flex items-center justify-between"
            >
              <div>
                <h2 className="font-semibold text-lg">{item.title}</h2>
                <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                  建立於 {new Date(item.created_at).toLocaleString("zh-TW")}
                </p>
              </div>
              <span className="badge">{statusLabel[item.status]}</span>
            </Link>
          ))}
          {!items.length && <div className="card p-10 text-center">尚未建立選舉</div>}
        </div>
      )}
    </div>
  );
}
