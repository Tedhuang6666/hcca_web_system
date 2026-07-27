"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { petitionsApi } from "@/lib/api";
import type { PetitionPublicListItem } from "@/lib/types";

export default function PublicPetitionsPage() {
  const [items, setItems] = useState<PetitionPublicListItem[]>([]);

  useEffect(() => {
    petitionsApi.publicList().then(setItems).catch(() => setItems([]));
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>公開陳情</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          以下案件已經陳情人同意公開，內容不包含姓名、Email、學號或其他聯絡資料。
        </p>
      </div>
      {items.length === 0 ? (
        <div className="card p-5 text-sm" style={{ color: "var(--text-muted)" }}>目前尚無已公開陳情。</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {items.map((item) => (
            <Link key={item.id} href={`/petitions/public/${item.id}`} className="card card-hover p-5 space-y-2" style={{ textDecoration: "none" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>#{item.case_number} · {item.current_org_name} · {item.type_name}</p>
              <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>{item.title}</h2>
              <p className="text-sm line-clamp-3" style={{ color: "var(--text-muted)" }}>{item.reply || "已結案"}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
