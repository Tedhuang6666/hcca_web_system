"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { petitionsApi } from "@/lib/api";
import type { PetitionPublicOut } from "@/lib/types";

export default function PublicPetitionDetailPage() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<PetitionPublicOut | null>(null);

  useEffect(() => {
    petitionsApi.publicGet(params.id).then(setItem).catch(() => setItem(null));
  }, [params.id]);

  if (!item) return <div className="max-w-3xl mx-auto card p-5">找不到已公開的陳情。</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <Link href="/petitions/public" className="text-sm" style={{ color: "var(--text-muted)" }}>← 返回公開陳情</Link>
      <header>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>#{item.case_number} · {item.current_org_name} · {item.type_name}</p>
        <h1 className="text-2xl font-semibold mt-2" style={{ color: "var(--text-primary)" }}>{item.title}</h1>
      </header>
      <section className="card p-5 space-y-4">
        <h2 className="font-semibold">陳情內容</h2>
        <p className="whitespace-pre-wrap text-sm leading-7" style={{ color: "var(--text-primary)" }}>{item.content}</p>
      </section>
      <section className="card p-5 space-y-4" style={{ background: "var(--success-dim)", borderColor: "var(--success-border)" }}>
        <h2 className="font-semibold" style={{ color: "var(--success)" }}>承辦回覆</h2>
        <p className="whitespace-pre-wrap text-sm">{item.reply || "本案已結案，暫無公開回覆。"}</p>
      </section>
    </div>
  );
}
