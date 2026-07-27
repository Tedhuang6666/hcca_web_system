"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";

const PUBLIC_BACK_LABELS: Record<string, string> = {
  "/public": "返回公開資料庫",
  "/public/elections": "返回即時開票",
  "/news": "返回最新公告",
};

function getPublicBack(pathname: string): { href: string; label: string } | null {
  let parent: string | null = null;
  if (/^\/news\/[^/]+$/.test(pathname)) {
    parent = "/news";
  } else if (pathname.startsWith("/public/")) {
    parent = "/" + pathname.split("/").filter(Boolean).slice(0, -1).join("/");
  }
  if (!parent) return null;
  return { href: parent, label: PUBLIC_BACK_LABELS[parent] ?? "返回上一頁" };
}

export default function PublicSiteBackLink() {
  const pathname = usePathname();
  const back = getPublicBack(pathname);
  if (!back) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
      <Link href={back.href} className="public-back-link">
        <ArrowLeft size={16} aria-hidden />
        {back.label}
      </Link>
    </div>
  );
}
