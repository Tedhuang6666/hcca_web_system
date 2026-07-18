"use client";

import Link from "next/link";

export default function PetitionSharePage() {
  return (
    <div className="max-w-2xl mx-auto card p-5 space-y-3">
      <p style={{ color: "var(--text-muted)" }}>舊版分享連結已停用，以避免驗證碼出現在 URL 與存取紀錄中。</p>
      <Link className="btn btn-primary" href="/petitions">回案件查詢</Link>
    </div>
  );
}
